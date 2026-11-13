#!/bin/sh
# Claude Code's status line: claude-hud's line, plus the limits for the usage mod.
# Claude Code passes .rate_limits only to this command, as JSON on stdin. When present,
# they go to ~/.cache/herdr-mods/usage/claude.json as {at, five_hour, seven_day}.
# Prints only claude-hud's output, which gets the same stdin.

# stdin byte for byte: the x keeps the trailing newlines $(...) would drop.
in=$(cat; echo x); in=${in%x}

u="$HOME/.cache/herdr-mods/usage"
{ mkdir -p "$u" &&
  printf '%s' "$in" | jq -ce 'select(.rate_limits != null) | {at: (now | floor), five_hour: .rate_limits.five_hour, seven_day: .rate_limits.seven_day}' > "$u/claude.json.$$" &&
  mv -f "$u/claude.json.$$" "$u/claude.json"; } >/dev/null 2>&1 || rm -f "$u/claude.json.$$" 2>/dev/null

printf '%s' "$in" | bash -c 'plugin_dir=$(ls -d "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/claude-hud/claude-hud/*/ 2>/dev/null | awk -F/ '"'"'{ print $(NF-1) "\t" $(0) }'"'"' | sort -t. -k1,1n -k2,2n -k3,3n -k4,4n | tail -1 | cut -f2-); exec "$(command -v bun || echo "$HOME/.bun/bin/bun")" --env-file /dev/null "${plugin_dir}src/index.ts"'
