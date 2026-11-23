#!/usr/bin/env bash
# Installs the whiteboard mod into the live Herdr home and the herdr plugin from this repo's marketplace. Run again after editing either.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)

# Herdr resolves a symlinked mod to its real path and does not hot-reload it, so the mod is copied.
mods="$HOME/.config/herdr-app/mods/claude-whiteboard"
[[ -L $mods ]] && rm "$mods"
rsync -a --delete --exclude gpui-kit.d.ts --exclude jsconfig.json "$root/mods/claude-whiteboard/" "$mods/"
herdr-app check "$mods"

if claude plugin marketplace list 2>/dev/null | grep -q '\bmaroon\b'; then
  claude plugin marketplace update maroon
else
  claude plugin marketplace add "$root"
fi
claude plugin install herdr@maroon
