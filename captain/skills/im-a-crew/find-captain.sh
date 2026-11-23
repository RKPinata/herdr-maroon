#!/bin/bash
# Prints the ListAgents name of the captain in this terminal's Herdr space.
# The captain is the terminal in the same space with the Herdr label captain=1.
set -euo pipefail
space=$(hc get "$HC_TERMINAL_ID" --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["labels"]["herdr.space"])')
for t in $(hc ls --json | python3 -c 'import json,sys; [print(t["address"]) for t in json.load(sys.stdin)["terminals"]]'); do
  hc get "$t" --json | python3 -c '
import json, os, sys
t = json.load(sys.stdin); l = t.get("labels", {})
if l.get("herdr.space") == sys.argv[1] and l.get("captain") == "1":
    pid = (t.get("foreground") or {}).get("pid")
    print(json.load(open(os.path.expanduser(f"~/.claude/sessions/{pid}.json")))["name"])
' "$space" && true
done | head -1 | grep . || { echo "no captain in this space" >&2; exit 1; }
