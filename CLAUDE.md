# Herdr work

Make every change in this repo and try it in the sandbox: a second Herdr window with its
own herdr-core. The live window (`~/.config/herdr-app`) runs the person's agents. It gets a
change only when they ask; then follow Install in `README.md`.

## The loop

```sh
scripts/sandbox.sh start
eval "$(scripts/sandbox.sh env)"
# edit mods/, layouts/, themes/ or settings.json here, then:
scripts/sandbox.sh reload                      # copies them in, restarts mods, prints errors
herdr-app check "$HERDR_APP_HOME/mods/<name>"
herdr-app shot /tmp/sandbox.png                # look at it
scripts/sandbox.sh stop                        # when the work is done
```

A change is done when `check` passes, `reload` prints no errors, and the shot shows it.

- **Sandbox shell.** Run `herdr-app` and `hc` only in a shell that ran the `eval` line.
  Without it they drive the live window and its terminals.
- **Source of truth.** Edit files here. `reload` overwrites the sandbox's copies.
  `settings.json` is copied at `start` only, so restart the sandbox after editing it.
- **New mods.** A new mod shows where `layouts/maroon.json` places it. Add its block there.
- **Parallel agents.** Give each one a name: `scripts/sandbox.sh start <name>`, and the same
  name to `env`, `reload` and `stop`.
- **Shared outside world.** Sandbox mods read and write the same `~/.claude`,
  `~/.cache/herdr-mods`, `gh` login and keychain as the live ones. A mod that writes there
  changes the person's real files.
