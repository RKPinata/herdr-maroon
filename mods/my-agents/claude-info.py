#!/usr/bin/env python3
# Every Claude Code agent running in a Herdr terminal, from Claude Code's own files:
#   ~/.claude/sessions/<pid>.json       a running Claude Code: its session and folder
#   HC_TERMINAL_ID in its environment   the Herdr terminal it runs in
#   ~/.claude/projects/<folder>/<session>.jsonl   its conversation: model and effort
#                                       (the last API request), context (the last
#                                       reply's input tokens), when it last replied and
#                                       when the prompt cache runs out, ultracode, and
#                                       its background shells, monitors and schedules
#   ~/.claude/projects/<folder>/<session>/subagents/   its subagents
# Writes ~/.cache/herdr-mods/agents/<terminal>.json (model, id, effort, ultracode,
# lastAt, context, cacheUntil, transcript) when it changes, and prints one JSON object
# keyed by terminal: those fields plus "subagents" and "tasks", the ones still going.
# A conversation only grows, up to hundreds of MB: each file is read on from where
# the last run stopped (~/.cache/herdr-mods/agents.state.json), and one unchanged
# since is not opened. Python 3, standard library.
import glob, json, os, re, subprocess, sys, time, zlib
from datetime import datetime

HOME = os.path.expanduser("~")
CACHE = os.path.join(HOME, ".cache", "herdr-mods")
OUT = os.path.join(CACHE, "agents")
STATE = os.path.join(CACHE, "agents.state.json")
V = 1  # what the state holds: a state from another version is read again from the top
SLICE = 64 << 20  # bytes read from one file in one run; the rest waits for the next run
FIELDS = ("model", "id", "effort", "ultracode", "lastAt", "context", "cacheUntil", "transcript")
TOOLS = ("Bash", "Monitor", "CronCreate", "CronDelete", "ScheduleWakeup")
# A task notification: its id, then what follows it (status, summary).
NOTICE = re.compile(rb"<task-id>([a-z0-9]+)</task-id>(?=(.{0,600}))", re.S)
STOPPED = re.compile(rb"Successfully stopped task: ([a-z0-9]+)")
MESSAGE = re.compile(rb'agent-message from=\\"([a-z0-9]+)')


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except PermissionError:
        return True
    except (OSError, ValueError):
        return False


def transcript_of(session, cwd):
    if not session:
        return None
    if cwd:
        p = os.path.join(HOME, ".claude", "projects", re.sub(r"[^A-Za-z0-9]", "-", cwd), f"{session}.jsonl")
        if os.path.isfile(p):
            return p
    found = glob.glob(os.path.join(HOME, ".claude", "projects", "*", f"{session}.jsonl"))
    if found:
        return found[0]
    # A new conversation (just after /clear) has no file until its first message:
    # its path still says which one it is.
    return os.path.join(HOME, ".claude", "projects", re.sub(r"[^A-Za-z0-9]", "-", cwd), f"{session}.jsonl") if cwd else None


def seconds(ts):
    try:
        return int(datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp())
    except Exception:
        return None


def model_name(mid):
    # "claude-opus-5-5" -> "Opus 5.5"; Bedrock's "us.anthropic.claude-opus-5-5-v1:0" too.
    if not mid:
        return None
    m = re.search(r"claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?![\d])", mid)
    if not m:
        return mid
    return f"{m.group(1).capitalize()} {m.group(2)}{'.' + m.group(3) if m.group(3) else ''}"


def window(mid, used):
    # The context window: 1M for [1m] models and the 5 family on; 200k before.
    if mid and "[1m]" in mid:
        return 1_000_000
    m = re.search(r"claude-[a-z]+-(\d+)", mid or "")
    w = 1_000_000 if m and int(m.group(1)) >= 5 else 200_000
    return 1_000_000 if used > w else w


def tokens(u):
    return (u.get("input_tokens") or 0) + (u.get("cache_creation_input_tokens") or 0) + (u.get("cache_read_input_tokens") or 0)


def load(raw):
    try:
        j = json.loads(raw)
    except ValueError:
        return {}
    return j if isinstance(j, dict) else {}


def grow(path, st, line):
    # Calls line(raw) for each whole line written to path since st last saw it, and
    # returns the file's stat (None when it is missing). A file that got shorter or
    # starts differently was written anew: st starts over.
    try:
        s = os.stat(path)
    except OSError:
        return None
    stamp = [s.st_mtime_ns, s.st_size]
    if st.get("stamp") == stamp:
        return s
    with open(path, "rb") as f:
        n, crc = st.get("head", [0, 0])
        if st.get("v") != V or s.st_size < st.get("off", 0) or zlib.crc32(f.read(n)) != crc:
            st.clear()
            st.update(v=V, off=0, head=[0, 0])
        f.seek(st["off"])
        data = f.read(SLICE)
        end = data.rfind(b"\n") + 1
        for raw in data[:end].split(b"\n"):
            if raw.strip():
                line(raw)
        st["off"] += end
        if st["head"][0] < 4096 and st["off"] > st["head"][0]:
            f.seek(0)
            head = f.read(min(st["off"], 4096))
            st["head"] = [len(head), zlib.crc32(head)]
    # A line still being written comes with the file's next change.
    st["stamp"] = stamp if len(data) < SLICE else None
    return s


def conversation(path, st):
    # The last main-thread request and reply, ultracode, the background tasks
    # (st["tasks"], by task id) and when each subagent was said to be done
    # (st["said"]: id -> seconds). Tool uses wait in st["uses"] for their result.
    last = {}

    def line(raw):
        if b'"type":"api-request"' in raw:
            if b'"querySource"' not in raw or b'"querySource":"repl_main_thread"' in raw:
                last["request"] = raw
            return
        if b'"type":"assistant"' in raw:
            if b'"usage"' in raw and b'"isSidechain":true' not in raw:
                last["reply"] = raw
            if b'"type":"tool_use"' in raw and any(b'"name":"%s"' % n.encode() in raw for n in TOOLS):
                uses(load(raw))
        if b"Ultracode o" in raw and b'"content":"<local-command-stdout>' in raw:
            # Only /effort's own output counts: a user entry whose content is the
            # command's stdout as a plain string, not the words quoted elsewhere.
            j = load(raw)
            text = (j.get("message") or {}).get("content") if j.get("type") == "user" and not j.get("isSidechain") else None
            if isinstance(text, str) and text.startswith("<local-command-stdout>"):
                hit = re.findall(r"Ultracode o(n|ff)", text)
                if hit:
                    st["ultra"] = hit[-1] == "n"
        if b'"toolUseResult":{' in raw and any(k in raw for k in (b'"backgroundTaskId"', b'"taskId":"', b'"scheduledFor"', b'"humanSchedule"')):
            result(load(raw))
        if b"<task-id>" in raw or b"Successfully stopped task: " in raw or b"agent-message from=" in raw:
            ended(raw)

    def uses(j):
        if j.get("type") != "assistant":
            return
        tasks, pending = st.setdefault("tasks", {}), st.setdefault("uses", {})
        for c in (j.get("message") or {}).get("content") or []:
            if not isinstance(c, dict) or c.get("type") != "tool_use" or c.get("name") not in TOOLS:
                continue
            i = c.get("input") or {}
            if c["name"] == "CronDelete":
                tasks.pop(str(i.get("id")), None)
                continue
            if c["name"] == "Bash" and not i.get("run_in_background"):
                continue
            if c["name"] == "ScheduleWakeup":
                # Only the latest wakeup counts.
                for k in [k for k, x in tasks.items() if x["kind"] == "wakeup"]:
                    del tasks[k]
            pending[c.get("id")] = {"n": c["name"], "i": {k: i[k] for k in ("description", "command", "prompt", "reason") if isinstance(i.get(k), str)}}

    def result(j):
        r, content = j.get("toolUseResult"), (j.get("message") or {}).get("content")
        if j.get("type") != "user" or not isinstance(r, dict) or not isinstance(content, list) or not content or not isinstance(content[0], dict):
            return
        k = content[0].get("tool_use_id")
        use = st.setdefault("uses", {}).pop(k, None) or {"n": None, "i": {}}
        i, at, tasks = use["i"], seconds(j.get("timestamp") or ""), st.setdefault("tasks", {})
        if r.get("backgroundTaskId"):
            tasks[str(r["backgroundTaskId"])] = {"kind": "shell", "desc": i.get("description") or i.get("command") or "Background command", "start": at}
        elif r.get("taskId") and use["n"] == "Monitor":
            tasks[str(r["taskId"])] = {"kind": "monitor", "desc": i.get("description") or "Monitor", "start": at,
                                       "until": (at or 0) + int(r.get("timeoutMs") or 300000) // 1000}
        elif r.get("scheduledFor") and use["n"] == "ScheduleWakeup":
            tasks[k] = {"kind": "wakeup", "desc": i.get("reason") or "Wakeup", "start": at, "schedule": int(r["scheduledFor"]) // 1000}
        elif r.get("humanSchedule") and r.get("id"):
            tasks[str(r["id"])] = {"kind": "cron", "desc": i.get("prompt") or "", "start": at, "schedule": r["humanSchedule"],
                                   "recurring": bool(r.get("recurring")), "next": int(r.get("nextFireAt") or 0) // 1000}

    def ended(raw):
        at = seconds(load(raw).get("timestamp") or "") or 0
        tasks, said = st.setdefault("tasks", {}), st.setdefault("said", {})
        for m in NOTICE.finditer(raw):
            i, rest = m.group(1).decode(), m.group(2)
            if b"<status>" in rest or b"Monitor expired" in rest:
                tasks.pop(i, None)
            if b"finished</summary>" in rest or re.search(rb"<status>(killed|failed|stopped)</status>", rest):
                said[i] = max(said.get(i, 0), at)
        for m in STOPPED.finditer(raw):
            i = m.group(1).decode()
            tasks.pop(i, None)
            said[i] = max(said.get(i, 0), at)
        for m in MESSAGE.finditer(raw):
            i = m.group(1).decode()
            said[i] = max(said.get(i, 0), at)

    grow(path, st, line)
    if "request" in last:
        j = load(last["request"])
        p = j.get("params") or {}
        effort = (p.get("output_config") or {}).get("effort") or (p.get("effort") or {}).get("effort")
        # A 1h TTL on the messages keeps the conversation's cache for an hour.
        hour = any((c.get("path") or [None])[0] == "messages" and (c.get("value") or {}).get("ttl") == "1h"
                   for c in j.get("cacheControl") or [] if isinstance(c, dict))
        st["request"] = {"model": p.get("model"), "effort": effort if isinstance(effort, str) else None, "hour": hour}
    if "reply" in last:
        j = load(last["reply"])
        m = j.get("message") or {}
        if j.get("type") == "assistant" and isinstance(m.get("usage"), dict) and not j.get("isSidechain"):
            st["reply"] = {"model": m.get("model"), "usage": m["usage"], "at": seconds(j.get("timestamp") or "")}


def facts(st, path):
    req, rep = st.get("request") or {}, st.get("reply") or {}
    mid = req.get("model") or rep.get("model")
    info = {"model": model_name(mid), "id": mid, "effort": req.get("effort"), "ultracode": bool(st.get("ultra")),
            "lastAt": None, "context": None, "cacheUntil": None, "transcript": path}
    u = rep.get("usage")
    if u:
        used = tokens(u)
        info["context"] = round(used * 100 / window(mid, used))
        info["lastAt"] = at = rep.get("at")
        hour = req.get("hour") or ((u.get("cache_creation") or {}).get("ephemeral_1h_input_tokens") or 0) > 0
        info["cacheUntil"] = at + (3600 if hour else 300) if at else None
    return info


def live_tasks(st, now):
    # Those past their time leave the state too: they never come back.
    tasks = st.get("tasks") or {}
    for k, x in list(tasks.items()):
        if (x["kind"] == "monitor" and x["until"] <= now) or (x["kind"] == "wakeup" and x["schedule"] <= now) or (
                x["kind"] == "cron" and (now - (x["start"] or 0) >= 7 * 86400 or (not x["recurring"] and x["next"] <= now - 120))):
            del tasks[k]
    return [{"kind": x["kind"], "id": k, "desc": x["desc"], "start": x["start"], "schedule": x.get("schedule")} for k, x in tasks.items()]


def subagent(path, st):
    def line(raw):
        j = load(raw)
        at = seconds(j.get("timestamp") or "")
        if at:
            st.setdefault("start", at)
            st["last"] = at
        if j.get("type") == "api-request":
            p = j.get("params") or {}
            effort = (p.get("output_config") or {}).get("effort")
            st["model"] = p.get("model") or st.get("model")
            st["effort"] = effort if isinstance(effort, str) else st.get("effort")
        elif j.get("type") == "assistant" and isinstance((j.get("message") or {}).get("usage"), dict):
            st["tokens"] = tokens(j["message"]["usage"])
            st["model"] = st.get("model") or j["message"].get("model")
            st["replied"] = True

    return grow(path, st, line)


def meta(path, st):
    try:
        s = os.stat(path)
        if st.get("stamp") != [s.st_mtime_ns, s.st_size]:
            with open(path) as f:
                m = json.load(f)
            st.clear()
            st.update(stamp=[s.st_mtime_ns, s.st_size], desc=m.get("description") or "", type=m.get("agentType") or "", finished=bool(m.get("finished")))
    except (OSError, ValueError, AttributeError):
        pass


def subagents(transcript, said, files, seen, now):
    # The ones still going. Done: marked finished in its meta file (unmarked on a
    # resume), said to be done with nothing written since, or never replied two
    # minutes on. One quiet for a day is a leftover.
    folder = os.path.join(transcript[:-len(".jsonl")], "subagents")
    try:
        names = sorted(n[:-len(".meta.json")] for n in os.listdir(folder) if n.endswith(".meta.json"))
    except OSError:
        return []
    out = []
    for n in names:
        base = os.path.join(folder, n)
        seen.update((base + ".jsonl", base + ".meta.json"))
        mt = files.setdefault(base + ".meta.json", {})
        meta(base + ".meta.json", mt)
        if mt.get("finished"):
            continue
        st = files.setdefault(base + ".jsonl", {})
        s = subagent(base + ".jsonl", st)
        if not s:
            continue
        at, sid = int(s.st_mtime), n[len("agent-"):] if n.startswith("agent-") else n
        if (sid in said and (st.get("last") or 0) <= said[sid] + 5) or (now - at > 120 and not st.get("replied")) or now - at >= 86400:
            continue
        out.append({"id": n, "at": at, "desc": mt.get("desc", ""), "type": mt.get("type", ""), "model": model_name(st.get("model")),
                    "effort": st.get("effort"), "start": st.get("start"), "tokens": st.get("tokens", 0)})
    return sorted(out, key=lambda x: x["start"] or 0)


def put(path, text):
    try:
        with open(path) as f:
            if f.read() == text:
                return
    except OSError:
        pass
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w") as f:
        f.write(text)
    os.replace(tmp, path)


def main():
    now = time.time()
    try:
        with open(STATE) as f:
            state = json.load(f)
        if state.get("v") != V:
            raise ValueError
    except (OSError, ValueError):
        state = {"v": V}
    pids, files = state.get("pids") or {}, state.get("files") or {}
    sessions = {}
    for f in glob.glob(os.path.join(HOME, ".claude", "sessions", "*.json")):
        try:
            with open(f) as fh:
                s = json.load(fh)
            pid = int(s.get("pid"))
        except Exception:
            continue
        if s.get("kind", "interactive") == "interactive" and alive(pid):
            sessions[str(pid)] = s
    # Which terminal each runs in: ps is asked once, for the processes not known yet
    # (macOS's ps shows the environment of your own processes).
    ask = [p for p, s in sessions.items() if (pids.get(p) or {}).get("start") != s.get("startedAt")]
    if ask:
        try:
            out = subprocess.run(["ps", "-wwE", "-o", "pid=,command=", "-p", ",".join(ask)], capture_output=True, text=True, timeout=5).stdout
        except Exception:
            out = ""
        envs = {l.split(None, 1)[0]: l for l in out.splitlines() if l.strip()}
        for p in ask:
            m = re.search(r"\sHC_TERMINAL_ID=([A-Za-z0-9_.-]+)(?:\s|$)", envs.get(p, ""))
            pids[p] = {"start": sessions[p].get("startedAt"), "term": m.group(1) if m else None}
    found, seen = {}, set()
    for p, s in sessions.items():
        term, path = pids[p]["term"], transcript_of(s.get("sessionId"), s.get("cwd"))
        if not term or not path:
            continue
        seen.add(path)
        st = files.setdefault(path, {})
        try:
            conversation(path, st)
            info = facts(st, path)
            info["subagents"] = subagents(path, st.get("said") or {}, files, seen, now)
            info["tasks"] = live_tasks(st, now)
        except Exception:
            continue
        found[term] = info
    os.makedirs(OUT, exist_ok=True)
    for term, info in found.items():
        put(os.path.join(OUT, f"{term}.json"), json.dumps({k: info[k] for k in FIELDS}, separators=(",", ":")))
    # Terminals no Claude Code runs in any more: their file goes, a minute on.
    for dest in glob.glob(os.path.join(OUT, "*.json")):
        try:
            if os.path.basename(dest)[:-5] not in found and now - os.path.getmtime(dest) > 60:
                os.remove(dest)
        except OSError:
            pass
    state["pids"] = {p: pids[p] for p in sessions}
    state["files"] = {k: v for k, v in files.items() if k in seen}
    put(STATE, json.dumps(state, separators=(",", ":")))
    json.dump(found, sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main()
