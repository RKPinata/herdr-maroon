# Crew tabs

## Open a crew tab

Open one only for a job in the confirmed scope.

1. **Open it.** Pass your own `herdr.space`, so the tab lands in your space, and the job's folder:

   ```sh
   herdr-app do tab.new --space <your herdr.space> --folder <job folder> --argv '["claude"]' --focus false
   ```

   It prints `{"space", "tab", "terminal"}`, or `{"error"}` and exits 1.
2. **Wait for Claude.** The new terminal's foreground is a shell until Claude starts. Run `hc get <terminal> --json` until `foreground.pid` has a file at `~/.claude/sessions/<pid>.json`. Its `name` is the session name. An `{error}` from step 1, or no session file within a minute, becomes a needs-you item.
3. **Record it.** Add the crew line to Scope: session name, terminal, `opened by captain`, job.
4. **Onboard it.** Send the session a SendMessage that tells it to load `/captain:im-a-crew`, then give it the job.

The tab is open when the session's first report arrives.

## Close a crew tab

Close a tab only when all three hold: you opened it (`opened by captain`), its job is done, and the job line says `briefed`.

1. Read the tab id from `hc get <terminal> --json` → `labels["herdr.tab"]`.
2. Run `herdr-app do tab.close --id <tab id>`.
3. Remove the job from Scope, its line from Jobs, and the crew line from Scope.

The user can still resume the session with `claude --resume`.
