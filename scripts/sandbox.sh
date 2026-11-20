#!/usr/bin/env bash
# Runs this package in a second Herdr window with its own herdr-core. The live window
# (~/.config/herdr-app) and its terminals never see the sandbox, and the sandbox never
# writes into this repo.
#
#   scripts/sandbox.sh start [name]    open the window on the maroon layout
#   scripts/sandbox.sh reload [name]   copy the package in again and restart its mods
#   scripts/sandbox.sh env [name]      print the exports that point herdr-app and hc at it
#   scripts/sandbox.sh stop [name]     close the window, stop its core, delete its files
set -euo pipefail

usage() { sed -n '6,9p' "$0" | sed 's/^# *//' >&2; exit 2; }
die() { echo "error: $*" >&2; exit 1; }

[ $# -ge 1 ] && [ $# -le 2 ] || usage
cmd=$1 name=${2:-default}
case $name in ''|*[!A-Za-z0-9_-]*) die "name '$name' must use only letters, digits, '_' and '-'";; esac

root=$(cd "$(dirname "$0")/.." && pwd)
live=$HOME/.config/herdr-app
home=$HOME/.cache/herdr-sandbox/$name
session=sandbox-$name
export HERDR_APP_HOME=$home HC_SESSION=$session

running() { herdr-app status >/dev/null 2>&1; }

# Copies, not links: Herdr writes generated files into a mod's folder and does not
# hot-reload a linked mod.
sync() {
  mkdir -p "$home/mods" "$home/layouts" "$home/themes"
  cp "$root"/layouts/*.json "$home/layouts/"
  cp "$root"/themes/*.json "$home/themes/"
  for m in "$root"/mods/*/; do
    rsync -a --delete --exclude gpui-kit.d.ts --exclude herdr.d.ts --exclude jsconfig.json \
      "$m" "$home/mods/$(basename "$m")/"
  done
}

# A layout switch starts the shown mods again from what is on disk.
restart_mods() {
  herdr-app do layout.switch '{"name":"main"}' >/dev/null
  herdr-app do layout.switch '{"name":"maroon"}' >/dev/null
}

case $cmd in
  start)
    if running; then sync; restart_mods; echo "already running; reloaded"; exit 0; fi
    rm -rf "$home"
    mkdir -p "$home"
    cp "$root/settings.json" "$home/"
    # Your keys, the mods Herdr has already docked once (so none docks again), and the
    # last version run (so no update toast).
    for f in keys.json seen.json update-notes.json; do [ -f "$live/$f" ] && cp "$live/$f" "$home/"; done
    echo '{"frame.welcomed": "finished"}' >"$home/shared.json"
    sync
    HERDR_TELEMETRY=0 nohup /Applications/Herdr.app/Contents/MacOS/Herdr >"$home/app.log" 2>&1 &
    for _ in $(seq 40); do running && break; sleep 0.5; done
    running || die "the window did not start; see $home/app.log"
    herdr-app do layout.switch '{"name":"maroon"}' >/dev/null
    echo "sandbox '$name' is up. Point herdr-app and hc at it with:"
    echo "  eval \"\$($0 env $name)\""
    ;;
  reload)
    running || die "sandbox '$name' is not running; run: $0 start $name"
    sync
    restart_mods
    herdr-app status | jq -c '{layout, errors}'
    ;;
  env)
    echo "export HERDR_APP_HOME=$home HC_SESSION=$session"
    ;;
  stop)
    running && herdr-app do app.quit >/dev/null || true
    hc server stop >/dev/null 2>&1 || true
    rm -rf "$home" "$HOME/.local/state/herdr-core/$session"
    echo "sandbox '$name' stopped"
    ;;
  *) usage ;;
esac
