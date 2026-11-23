---
name: mods
description: Use before changing Herdr itself — a mod, layout, theme, keys or settings in ~/.config/herdr-app, or a `herdr-app do` that changes the window.
---

# Herdr mods

The live Herdr window (`~/.config/herdr-app`) runs the person's agents. Each mod has a
source repo. Edit it there, try it in a sandbox window, and copy it into the live home only
when the person asks.

| Source | Mods | Try it with |
|---|---|---|
| `~/Repo/Tooling/Herdr/maroon` | `my-*`, `linear`, `agent-switcher`, `agent-resume`, `claude-whiteboard`, the maroon layout and theme | `scripts/sandbox.sh`; its `CLAUDE.md` has the loop. `scripts/install-whiteboard.sh` writes the live home, so ask first |

For a mod with no source repo, ask the person where it should live.

## What Herdr does that you cannot see

- **The window a command reaches.** `herdr-app` drives the window at `$HERDR_APP_HOME`, by
  default the live one. `hc` drives the core named by `$HC_SESSION`, by default the one that
  runs the person's terminals. Point both at the sandbox with
  `eval "$(scripts/sandbox.sh env)"` before any `herdr-app do` or `hc` call.
- **Copy mods; never link them.** Herdr writes `gpui-kit.d.ts` and `jsconfig.json` into
  every mod folder it loads, through a symlink into the repo. It does not hot-reload a
  linked mod.
- **Reload.** Restart mods with a layout switch (`scripts/sandbox.sh reload`). A saved file
  in a second window does not always reload on its own.
