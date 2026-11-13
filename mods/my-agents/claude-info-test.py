#!/usr/bin/env python3
# Self-check for claude-info.py's transcript reading: python3 -I claude-info-test.py
import importlib.util, json, os, sys, tempfile, time

sys.dont_write_bytecode = True

# Claude Code writes compact JSON, and the reader matches it byte for byte.
dumps = lambda o: json.dumps(o, separators=(",", ":"))

spec = importlib.util.spec_from_file_location("ci", os.path.join(os.path.dirname(os.path.abspath(__file__)), "claude-info.py"))
ci = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ci)

T = int(time.time()) - 30
ts = lambda s: time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(s))
use = lambda i, name, inp: {"type": "assistant", "timestamp": ts(T), "message": {"content": [{"type": "tool_use", "id": i, "name": name, "input": inp}]}}
res = lambda i, r: {"type": "user", "timestamp": ts(T), "message": {"content": [{"type": "tool_result", "tool_use_id": i}]}, "toolUseResult": r}
lines = [
    {"type": "api-request", "querySource": "repl_main_thread", "params": {"model": "claude-opus-5-5", "output_config": {"effort": "high"}},
     "cacheControl": [{"path": ["messages", 3], "value": {"type": "ephemeral", "ttl": "1h"}}]},
    {"type": "assistant", "timestamp": ts(T), "isSidechain": False, "message": {"model": "claude-opus-5-5", "usage": {"input_tokens": 1000, "cache_read_input_tokens": 99000}}},
    use("u1", "Bash", {"command": "npm run dev", "description": "dev server", "run_in_background": True}), res("u1", {"backgroundTaskId": "b1"}),
    use("u2", "Monitor", {"description": "watch logs"}), res("u2", {"taskId": "m1", "timeoutMs": 600000}),
    use("u3", "Bash", {"command": "make", "run_in_background": True}), res("u3", {"backgroundTaskId": "b2"}),
    {"type": "user", "timestamp": ts(T), "message": {"content": "<task-notification><task-id>b2</task-id><status>completed</status></task-notification>"}},
    use("u4", "CronCreate", {"prompt": "check deploy"}), res("u4", {"humanSchedule": "Every 2 hours", "id": "c1", "recurring": True}),
    {"type": "user", "timestamp": ts(T + 10), "message": {"content": "<task-id>ax3</task-id><summary>Agent \"x3\" finished</summary>"}},
]

with tempfile.TemporaryDirectory() as d:
    path = os.path.join(d, "s.jsonl")
    with open(path, "w") as f:
        f.write("".join(dumps(l) + "\n" for l in lines))
    sub = os.path.join(d, "s", "subagents")
    os.makedirs(sub)
    for n, meta, body in [("agent-ax1", {"description": "live one"}, [{"type": "assistant", "timestamp": ts(T), "message": {"model": "claude-haiku-5-5", "usage": {"input_tokens": 42000}}}]),
                          ("agent-ax2", {"description": "done", "finished": True}, []),
                          ("agent-ax3", {"description": "told done"}, [{"type": "assistant", "timestamp": ts(T), "message": {"usage": {"input_tokens": 1}}}])]:
        json.dump(meta, open(os.path.join(sub, n + ".meta.json"), "w"))
        open(os.path.join(sub, n + ".jsonl"), "w").write("".join(dumps(l) + "\n" for l in body))

    st, files, seen = {}, {}, set()
    ci.conversation(path, st)
    info = ci.facts(st, path)
    assert (info["model"], info["effort"], info["context"], info["lastAt"], info["cacheUntil"]) == ("Opus 5.5", "high", 10, T, T + 3600), info
    tasks = {x["id"]: x for x in ci.live_tasks(st, time.time())}
    assert set(tasks) == {"b1", "m1", "c1"} and tasks["b1"]["desc"] == "dev server" and tasks["c1"]["schedule"] == "Every 2 hours", tasks
    subs = ci.subagents(path, st["said"], files, seen, time.time())
    assert [(x["id"], x["model"], x["tokens"]) for x in subs] == [("agent-ax1", "Haiku 5.5", 42000)], subs

    # Read on from where it stopped: an unchanged file is not read, an added line is.
    off = st["off"]
    ci.conversation(path, st)
    assert st["off"] == off
    with open(path, "a") as f:
        f.write(dumps({"type": "user", "timestamp": ts(T), "message": {"content": "Successfully stopped task: b1"}}) + "\n")
    ci.conversation(path, st)
    assert st["off"] > off and "b1" not in st["tasks"]
print("ok")
