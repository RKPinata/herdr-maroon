#!/usr/bin/env python3
# The prompts in a Claude Code transcript, for the timeline mod:
#   prompts.py <transcript.jsonl | folder> [last]
# A folder (~/.claude/projects/<slug>) means its newest conversation.
# last ("<path>\t<size>", what was read before): when that is still the file and its
# size, prints {"same": true} and reads nothing.
# Prints {prompts, context, size, path}. prompts, oldest first:
#   at, text  a message the person typed (not a tool result, command output or system note)
#   also      messages queued while the agent worked on it: [{at, text}]
#   reply     the agent's last text before the next prompt
#   edits     files it changed; cmds: shell commands it ran
#   done      when its last step was (time worked is done - at)
#   tokens    output tokens, each message once (its blocks repeat its usage; the largest is final)
# context: the last reply's input tokens, cached and not, as % of the model's window.
import json, os, re, sys

SKIP = ("<command-", "<local-command", "<system-reminder", "<task-notification", "<bash-", "Caveat:", "[Request interrupted")
EMPTY = '{"prompts": [], "context": null, "size": 0, "path": null}'


def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        if any(isinstance(b, dict) and b.get("type") == "tool_result" for b in content):
            return None
        return "\n".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text")
    return None


def window(mid, used):
    # 1M for [1m] models and the 5 family on, 200k before.
    if mid and "[1m]" in mid:
        return 1_000_000
    m = re.search(r"claude-[a-z]+-(\d+)", mid or "")
    w = 1_000_000 if m and int(m.group(1)) >= 5 else 200_000
    return 1_000_000 if used > w else w


def main():
    path = sys.argv[1]
    if os.path.isdir(path):
        files = [os.path.join(path, f) for f in os.listdir(path) if f.endswith(".jsonl")]
        path = max(files, key=os.path.getmtime) if files else None
    if not path or not os.path.isfile(path):
        print(EMPTY)
        return
    size = os.path.getsize(path)
    if len(sys.argv) > 2 and sys.argv[2] == f"{path}\t{size}":
        print('{"same": true}')
        return
    out, cur, context = [], None, None
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            try:
                e = json.loads(line)
            except ValueError:
                continue
            said, queued = None, False
            if e.get("type") == "user" and not e.get("isMeta") and not e.get("isSidechain"):
                said = text_of((e.get("message") or {}).get("content"))
            elif e.get("type") == "attachment":
                a = e.get("attachment") or {}
                if a.get("type") == "queued_command" and (a.get("origin") or {}).get("kind", "human") == "human" and isinstance(a.get("prompt"), str):
                    said, queued = a["prompt"], True
            if said is not None:
                said = said.strip()
                if said and not said.startswith(SKIP) and queued and cur is not None:
                    cur["also"].append({"at": e.get("timestamp"), "text": said})
                elif said and not said.startswith(SKIP):
                    cur = {"at": e.get("timestamp"), "done": None, "text": said, "also": [], "reply": "", "edits": [], "cmds": 0, "tokens": 0, "_tok": {}}
                    out.append(cur)
                continue
            if cur is None or e.get("isSidechain") or e.get("type") not in ("assistant", "user"):
                continue
            if e.get("timestamp"):
                cur["done"] = e["timestamp"]
            if e.get("type") != "assistant":
                continue
            m = e.get("message") or {}
            u = m.get("usage") or {}
            if u:
                used = (u.get("input_tokens") or 0) + (u.get("cache_read_input_tokens") or 0) + (u.get("cache_creation_input_tokens") or 0)
                context = round(used * 100 / window(m.get("model"), used))
            cur["_tok"][m.get("id")] = max(u.get("output_tokens") or 0, cur["_tok"].get(m.get("id"), 0))
            for b in m.get("content") or []:
                if not isinstance(b, dict):
                    continue
                if b.get("type") == "text" and b.get("text", "").strip():
                    cur["reply"] = b["text"].strip()
                elif b.get("type") == "tool_use":
                    i = b.get("input") or {}
                    if b.get("name") in ("Edit", "Write", "NotebookEdit", "MultiEdit"):
                        p = i.get("file_path") or i.get("notebook_path")
                        if p and p not in cur["edits"]:
                            cur["edits"].append(p)
                    elif b.get("name") == "Bash":
                        cur["cmds"] += 1
    for p in out:
        p["tokens"] = sum(p.pop("_tok").values())
    json.dump({"prompts": out, "context": context, "size": size, "path": path}, sys.stdout)


main()
