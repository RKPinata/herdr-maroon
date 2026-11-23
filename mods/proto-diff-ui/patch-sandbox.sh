#!/usr/bin/env bash
# PROTOTYPE: after a sandbox sync, add the Diff panel block and its segment to the sandbox's copies only.
set -euo pipefail
cd /Users/danish/Repo/Tooling/Herdr/maroon
scripts/sandbox.sh reload diff-ui >/dev/null
eval "$(scripts/sandbox.sh env diff-ui)"
L=$HERDR_APP_HOME/layouts/maroon.json T=$HERDR_APP_HOME/mods/my-annotator-tabs/main.js
jq '(.. | objects | select(.id=="panel-body") | .children) |= [{"id":"diff","type":"block","content":{"mod":"proto-diff-ui","props":{"variant":"panel"}}}] + .' "$L" > "$L.tmp" && mv "$L.tmp" "$L"
perl -0pi -e 's|(      find\(body, "whiteboard"\))|      find(body, "diff") && ["diff", "Diff", "mods/my-pr-flow/branch.svg"],\n$1|' "$T"
herdr-app do layout.switch '{"name":"main"}' >/dev/null; herdr-app do layout.switch '{"name":"maroon"}' >/dev/null
herdr-app check "$HERDR_APP_HOME/mods/proto-diff-ui"
herdr-app status | jq -c '{layout, errors}'
