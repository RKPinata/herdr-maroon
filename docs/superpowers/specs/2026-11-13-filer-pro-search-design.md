# Filer Pro search design

Search features for the `my-filer-pro` mod:

1. A quick-open finder that ranks files like VS Code's Cmd+P.
2. A floating modal to use it, opened with `cmd-k` or a header button.
3. Reveal in tree: the picked file opens, and the tree expands to it and scrolls to it.
4. A find row that matches names in the visible tree.
5. A go-to row that moves the Files root to a typed path, also opened from the pane menu.

Content search (text inside files) is not part of this design.

## Units

```
 ⌘K / ⌕ button                    ⌘F (tree focused)     📁→ button / pane menu
      │                                 │                      │
      ▼                                 ▼                      ▼
┌──────────────────┐           ┌──────────────────┐   ┌──────────────────┐
│ ui/quickopen.js  │           │ find row          │   │ go-to row         │
│ overlay view     │           │ (one row slot under the header)          │
│ "find"           │           └────────┬─────────┘   └────────┬─────────┘
└───┬─────────▲────┘                    │ scrollToRow          │ navigate(path)
    │ query   │ {recent, files}         ▼                      ▼
    ▼         │                ┌──────────────────────────────────────────┐
┌──────────────────┐  pick     │ main.js panel                             │
│ lib/finder.js    │ ────────► │ pollPick → openPicked → revealInTree      │
│ list + rank      │ setShared │ treeScroll (one ScrollHandle)             │
│ recent.json      │ "filer-   └──────────────────────────────────────────┘
└──────────────────┘  pro.pick"
```

| Unit | Job | Depends on |
|---|---|---|
| `lib/finder.js` | Lists files, caches the list per root and machine, ranks matches, keeps the recent list | `exec` and file functions passed in |
| `ui/quickopen.js` | The modal: input, virtual list, two groups, keyboard | a finder session |
| `revealInTree`, `scrollToRow` (main.js) | Expand parent folders, load them, scroll to a row | `refresh`, `visible()`, `treeScroll` |
| `pollPick`, `openPicked` (main.js) | Take a pick from the modal and open the file by kind | `expandPath`, `show`, `openInNvim` |
| Find row (main.js, helpers in `lib/tree.js`) | Substring match on visible rows, `n/m` counter, step between matches | `scrollToRow`, `lastOpened` |
| Go-to row (main.js) | Resolve a typed path and move the root there | `navigate`, `exec test -d` |
| Pane-menu item (`my-menu`) | Show Files and open its go-to row with the pane's folder | `run`, `layout.show` |

## Finder engine: `lib/finder.js`

The module is pure apart from the functions passed into it, like `lib/requests.js`.

```js
const finder = createFinder({ exec, readTextFile, writeTextFile, appHome, platform });
const s = finder.session({ root, on, hide });   // one per modal open
s.query("msg/index:40");
// → { recent: Item[], files: Item[], total, truncated, loading, line: 40, column: null }
// Item: { path: "src/msg/index.vue", label: "index.vue", dir: "src/msg", score,
//         labelHits: [[0, 5]], dirHits: [[4, 7]] }
s.onChange(fn);                                  // the list arrived or was replaced
finder.invalidate({ root, on });                 // a watch batch: the list is stale
finder.recordOpen({ root, on, path });
```

### Listing

One `exec("sh", ["-c", FIND_SCRIPT, root], { on, timeout: 15000 })` runs the first tool that exists on the machine:

1. `rg --files --hidden -g '!.git' -g '!node_modules'` (without `--hidden` when `hide_dotfiles` is on)
2. `git ls-files -co --exclude-standard`, inside a repository
3. `find . -name .git -prune -o -name node_modules -prune -o -type f -print`

The output passes through `head -c 7340032` and the last partial line is dropped, because `exec` returns at most 8 MiB. A cut list sets `truncated`. Windows uses `rg` when installed, else `Get-ChildItem -Recurse -File`, following the PowerShell branch in `main.js`. System files are filtered from the final results with `isSystemFile`.

Listing starts when the modal opens. An LRU keeps 4 lists keyed by `${on}\0${root}`. A local list goes stale on a watch batch; a remote list after 30 s. A stale list is served while a new one loads.

### Ranking

`fuzzyScorer.ts` from VS Code (MIT) is ported: `prepareQuery`, `computeCharScore`, `doScoreFuzzy`, label-then-path scoring and the tie-breakers of `compareItemsByFuzzyScore`. `THIRD_PARTY_NOTICES.md` carries its license.

- A file-name match scores above a path match.
- A query that contains `/` scores against the whole path.
- A query with spaces needs every piece to match.
- A trailing `:120` or `:120:5` becomes `line` and `column` and is removed from the query.

### Speed

Mods run in QuickJS, which has no JIT.

- The list is lowercased and split once with native calls.
- A prefilter checks each query character with `indexOf` and rejects most paths before scoring.
- When the new query extends the last one, only the last survivors (an `Int32Array` of indexes) are scanned.
- At most 5,000 survivors get the full score; above that, only file names are scored. Results stop at 200.
- No debounce while a query takes under 30 ms; above that, 60 ms. A sequence id drops stale replies.

A `finder-bench` command, gated on the `perf` config flag, lists `~/Repo` and times fresh queries (`m`, `ma`, `main`, `mainjs`, `msg/index`, `lib fin`, `zzzz`) and the narrowing run `m`, `ma`, `mai`, `main`, five times each, into `perf.jsonl`. When a fresh query's median is over 80 ms, or a 1-character query's max is over 150 ms, ranking for lists over 20,000 files on this Mac goes to `fzf --filter "$q" < <list file> | head -n 1000`, and the JS scorer reranks those 1,000. fzf's special characters are stripped from the query first.

### Recently opened

`data/filer-pro/recent.json` holds `{ v: 1, items: [{ on, path, at }] }` with absolute paths, newest first, at most 100. Writes use `writeTextFile` with the `expected` text; on a conflict the file is read again and the write retried once, then dropped. Every open from the panel and every pick records an entry.

An empty query returns the recent files under the root. A typed query scores the recent files with the same scorer, puts up to 10 in `recent` and removes them from `files`.

## Quick-open modal: `ui/quickopen.js`

### Opening

- `keys.json`: `"global": { "cmd-k": "my-filer-pro.find" }`. The binding is global so it works from a terminal, nvim or another mod, and it replaces `cmd-k` everywhere.
- The ⌕ button in the Files header calls the same `openFinder(cx)`.
- With Files shown, the panel copy opens the modal with its own `root` and `on`. With Files hidden, the button copy uses `location()`, the focused terminal's folder.
- `openFinder` closes the open modal first (`this.finderId`), so modals never stack.

```js
openOverlay({ mod: "my-filer-pro", kind: "popup", at: "top", offset: 40, width: 640, height: 0.6,
              props: { view: "find", root, machine } });
```

When `at: "top"` is ignored, the modal is placed with `at: { x, y }`: centered on x, 40 px from the top. Focus: `input.focus()`, then once more after 600 ms, as the `picker` mod does.

### Layout

```
┌ Go to file · ~/Repo · on <machine>                    [Esc] ┐
│ ⌕ [vue▍                                                   ] │
│ recently opened                                             │
│ ▌📄 vue-legacy-patterns.md   app/.claude/rules              │
│ file results                                                │
│  V index.vue                 src/app/modules/messages       │
└─────────────────────────────────────────────────────────────┘
```

- `v_virtual_list` with 30 px rows and 24 px group headers, `track_scroll` and a vertical `Scrollbar`.
- Icons from `lib/icons.js`. Matched characters in `t.accent`, semibold. The folder path in `t.foreground` at 11.5 px.
- The selected row is drawn with `card()` from `boxy.js`.
- States: a spinner while loading; the error in `t.ansi1` with a Retry button; "No matching files"; "Listed first N files" when truncated.

### Keys

| Key | Action |
|---|---|
| ↑ ↓, ctrl-p, ctrl-n | Move, wrapping |
| PageUp, PageDown | Move 10 rows |
| ⏎, click | Reveal and open |
| ⌘⏎ | Reveal only |
| Esc, click outside | Close |

### Handoff

```js
setShared("filer-pro.pick", { id, machine, path /* absolute */, open: true });
closeOverlay(overlay);
```

When Files is hidden, the modal shows it with `layout.show` before the handoff.

## Reveal in tree (main.js)

```
pollPick (render) ── expandPath(abs) ──► null: toast "Outside <root>", stop
                          │ rel
                          ▼
                  openPicked(rel), inside requestLeave
                          │ revealInTree(rel)
                          │ open by kind (skipped when open is false)
```

`revealInTree(rel, cx)`:

1. Add each missing parent folder (`a`, `a/b`, …) to `this.folders`, parents first. A package parent also goes into `this.packages`.
2. Set `this.revealWanted = rel`.
3. When a parent has no entries yet, call `this.refresh(cx)`.

The tree (`files-tree`) gets `.track_scroll(this.treeScroll)`, a `ScrollHandle` made in `init`. Its children follow the order of `visible()`, so a row's index there is its scroll index. In `render`, when `revealWanted` is set, nothing is loading and no file viewer is shown, `scrollToRow(revealWanted)` runs and clears it. While the viewer is shown, the scroll waits until Back.

```js
scrollToRow(path) { const i = this.visible().findIndex((r) => r.path === path); if (i >= 0) this.treeScroll.scroll_to_item(i); }
```

| Picked | Action |
|---|---|
| Local text or Markdown | `openInNvim(rel)` |
| Other text, image, PDF, any remote file | `show(rel)` |
| Local binary | `show(rel)`: the message view with its Open button |
| Package or folder | `lastOpened = rel`; a folder is also expanded |

A file beyond `list_per_folder`, `list_total` or `tree_depth` opens with the toast "Beyond the list limit, not shown in the tree". A file hidden by settings opens without a row.

## Header and row slot

```
Files  Repo   [ / ⌂ ↰ 📁→ ] [⌕] ⟳ ⚙
```

`📁→` (`folder-input.svg`, lucide) opens the go-to row. `⌕` (`search.svg`) opens the modal. The find row has no button.

One slot under the header shows `this.row`: `null`, `"find"` or `"goto"`. Opening one closes the other. The slot is hidden while the file viewer is shown.

### Find row

```
⌕ [front▍]  1/2  [↑] [↓] [✕]
```

- Opens with `cmd-f` while the panel has focus. The panel root has `track_focus(this.treeFocus)`, the tree takes focus on mouse-down, and the root's `on_key_down` catches `cmd-f`. Clicking the tree therefore takes the keyboard from the terminal until the terminal is clicked again.
- Matches: case-insensitive substring of the row name, over `this.visible()`, skipping note rows. Collapsed folders have no entries, so visible rows are all loaded rows.
- The cursor is `lastOpened`. A query change jumps to the first match. ⏎ and ↓ go to the next match, ⇧⏎ and ↑ to the previous one, wrapping. Each jump calls `scrollToRow`.
- The counter is the cursor's place among the matches, `0/m` when the cursor is not a match, in `t.ansi1` when there is none. A refresh recomputes the matches.
- Other matches: matched text on `t.selection`. Current match: matched text in `t.accent` on `t.accent_foreground`.
- ⏎ selects and scrolls; it does not open. Esc closes the row and keeps the selection. The query stays for the next `cmd-f`.
- `findMatches(rows, q)` and `stepMatch(matches, current, dir)` live in `lib/tree.js`.

### Go-to row

```
📁 [~/Repo/claude-obsidian▍]  [Go] [✕]
```

- Opens from `📁→`, filled with the shown root, or from the pane menu, filled with that pane's folder. The input has focus.
- Accepts an absolute path, `~/…`, or a path relative to the shown root. ⏎ runs `exec("test", ["-d", abs], { on })` on the panel's machine.
- Success: `navigate(abs, cx)` and the row closes. ⌂ becomes active, because the root is no longer the terminal's folder.
- Failure: "Not a folder: <path>" in `t.ansi1` inside the row; the row stays open.

### Pane menu (`my-menu`)

`items()` case `"pane"` gets "Go to Folder in Files…" for terminal panes, before "Close pane". It runs `layout.show` for the Files panel, then `run("my-filer-pro.goto-row", { machine, cwd })`. The panel's `nextCommand` opens the go-to row filled with `cwd`. When `run` cannot pass arguments to a mod command, the item writes `setShared("filer-pro.goto-row", { id, machine, cwd })` and the panel polls it, as it does for `filer-pro.goto`.

## Errors

| Failure | Result |
|---|---|
| Listing fails (no tool, timeout, permission) | The modal shows the error with Retry; a cached list stays |
| Listing cut at 7 MiB | "Listed first N files"; ranking works on what was listed |
| Pick outside the root or on another machine | Toast "Outside <root>"; nothing opens |
| Pick beyond the list limits | File opens; toast "Beyond the list limit, not shown in the tree" |
| Unsaved edits in the viewer | `requestLeave` asks first |
| `recent.json` write conflict | Read again, retry once, then drop the entry |
| Go-to path is not a folder | Message in the row; the row stays open |

## Testing

Pure code is checked with `node` assert scripts in `mods/my-filer-pro/test/`, run as `node test/<name>.mjs`:

- `finder.test.mjs`: `index.vue` ranks above `src/vue/index.js` for `vue`; a file-name prefix ranks above a path hit; `msg/index` matches through the path; highlight ranges; the `:120:5` suffix; a narrowed query returns the same results as a fresh one.
- `findrow.test.mjs`: `findMatches`; `stepMatch` forward, backward, wrapping, and from no current match.
- `gotopath.test.mjs`: `~/x`, `../x`, `/abs` and a path relative to the root.

Checks in a running Herdr:

1. Whether module state is shared between the overlay copy and the panel copy. If not, the panel owns the list cache and the modal asks it through a shared key.
2. `openOverlay` with `at: "top"`.
3. `run("my-filer-pro.goto-row", args)` delivering its arguments.
4. ↑ and ↓ reaching the modal's `on_key_down` through `Input`.
5. `cmd-f` reaching the panel's `on_key_down`.
6. `finder-bench` on `~/Repo` against the 80 ms threshold.

## Docs

The README's Keys line lists `my-filer-pro.find` (for example `cmd-k`). The repository ships no `keys.json`.
