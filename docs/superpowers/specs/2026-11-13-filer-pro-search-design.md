# Filer Pro search design

Search features for the `my-filer-pro` mod:

1. A quick-open finder that ranks files like VS Code's Cmd+P.
2. A popup to use it, opened with `cmd-k` or a header button.
3. Reveal in tree: the picked file opens, and the tree expands to it and scrolls to it.
4. A find row that matches names in the visible tree.
5. A move-terminal row that types `cd <folder>` into a terminal and shows that folder in Files, also opened from the pane menu.

Content search (text inside files) is not part of this design.

## Units

```
 ⌘K / ⌕ button                    ⌘F (tree focused)     📁→ button / pane menu
 (mod.open:my-filer-pro)                │                      │
      │                                 ▼                      ▼
      ▼                        ┌──────────────────┐   ┌──────────────────┐
┌──────────────────┐           │ find row          │   │ move-terminal row │
│ ui/quickopen.js  │           │ (one row slot under the header)          │
│ popup copy       │           └────────┬─────────┘   └────────┬─────────┘
└───┬─────────▲────┘                    │ scrollToRow          │ navigate(path)
    │ search  │ {recent, files}         ▼                      ▼
    ▼         │                ┌──────────────────────────────────────────┐
┌──────────────────┐  pick     │ main.js panel                             │
│ lib/finder.js    │ ────────► │ pollPick → openPicked → revealInTree      │
│ list file + fzf  │ setShared │ treeScroll (one ScrollHandle)             │
│ lib/fuzzy.js     │ "filer-   └──────────────────────────────────────────┘
└──────────────────┘  pro.pick"
```

| Unit | Job | Depends on |
|---|---|---|
| `lib/fuzzy.js` | VS Code's quick-open scorer: score and compare one file | nothing |
| `lib/finder.js` | Writes a root's file list to a file on its machine, filters it per query with `fzf` (or `grep`), ranks the hits with `lib/fuzzy.js`, keeps the recent list | `exec` and file functions passed in |
| `lib/treefind.js` | Find-row matching and stepping, a path's parent folders, move-row path resolution and folder completion | nothing |
| `ui/quickopen.js` | The popup: input, virtual list, two groups, keyboard | a finder |
| `ui/treerow.js` | The find row and the move-terminal row | nothing |
| `revealInTree`, `scrollToRow` (main.js) | Expand parent folders, load them, scroll to a row | `refresh`, `visible()`, `treeScroll` |
| `pollPick`, `openPicked` (main.js) | Take a pick from the popup and open the file | `expandPath`, `show`, `openInNvim` |
| Pane-menu item (`my-menu`) | Ask Files to open its move-terminal row for the pane's terminal and folder | `setShared`, `run` |

## Finder engine: `lib/finder.js`

Mods run in QuickJS, which has no JIT, and Herdr interrupts a job after about 0.5 s. Measured on `~/Repo` (47,000 files), QuickJS scores about 220 paths per 60 ms with the full scorer. Ranking a whole repository in JavaScript is therefore out; native tools filter, and JavaScript ranks at most 200 hits.

```js
const finder = createFinder({ exec, readTextFile, writeTextFile, recentPath, localDir, now });
const entry = finder.files({ root, on, hide });   // { state, file, count, truncated, error, ready }
const result = await finder.search(entry, "msg/index:40", { on, recent, hide });
// → { recent: Item[], files: Item[], line: 40, column: null }
// Item: { path: "src/msg/index.vue", label: "index.vue", dir: "src/msg", score,
//         labelHits: [[0, 5]], dirHits: [[4, 7]] }
finder.invalidate({ root, on });                  // a watch batch or Refresh: list again next time
finder.recordOpen({ on, path });                  // absolute path, into recent.json
```

The finder lives in module scope. Herdr shares module code between every copy of a mod, so the panel and the popup use one cache.

### Listing

`FILES_SCRIPT` runs once per root through `exec("sh", …, { on, timeout: 15000 })`, on the machine of the root. It writes one relative path per line to a list file and prints the line count, the byte count and `1` when the list was cut, else `0`. It uses the first tool that exists:

1. `rg --files --hidden -g '!.git' -g '!node_modules'` (without `--hidden` when `hide_dotfiles` is on)
2. `git -c core.quotepath=off ls-files -z -co --exclude-standard`, inside a repository
3. `find . -name .git -prune -o -name node_modules -prune -o -type f -print`

With `hide_dotfiles` on, paths with a dot part are dropped. The list stops at 7 MiB (`head -c`); the partial last line is dropped and `truncated` is set. List files live in `~/.config/herdr-app/data/filer-pro/finder/` on this computer and in `~/.cache/filer-pro/finder/` on a machine (a leading `~/` in the file argument is that machine's `$HOME`).

An LRU keeps 4 entries. A local entry goes stale on a watch batch under the root or on Refresh, and after 60 s; a machine's entry after 30 s. An entry the LRU drops has its list file removed (`rm -f`, on its machine); a failed removal is ignored. An entry also records the `hide_dotfiles` value it was listed with, and a call with the other value lists again. A failed entry is listed again after 2 s. A stale entry keeps its old list file while the new one is written. Windows has no listing: `sh` is required.

### Ranking

Each query runs `SEARCH_SCRIPT` on the list file: `fzf --filter <query> --scheme=path | head -n 200` (without `--scheme` where fzf does not know it), or `grep -a -i -E <pattern> | head -n 200` where `fzf` is missing. The fzf query has fzf's operators, `*` and `…` stripped. A missing list file exits 4; `search` then marks the entry stale and rejects with "The file list is gone; list again". The grep pattern is the longest word's characters with `.*` between them.

The hits are ranked with `lib/fuzzy.js`, a port of VS Code's `fuzzyScorer.ts` (MIT, commit `f6c56f75d0f9ff0774c14303046f43acfde240f3`). `THIRD_PARTY_NOTICES.md` carries its license.

- A file-name match scores above a path match.
- A query that contains `/` scores against the whole path.
- A query with spaces needs every word to match.
- A trailing `:120` or `:120:5` becomes `line` and `column` and is removed from the query.
- System files are dropped from the hits (`hiddenPath`).

Measured in QuickJS, ranking 200 hits takes 11 to 156 ms. fzf filters 47,000 paths in 30 to 40 ms, process start included.

### Recently opened

`~/.config/herdr-app/filer-pro/recent.json` holds `{ v: 1, items: [{ on, path, at }] }` with absolute paths, newest first, at most 100. Writes use `writeTextFile` with the `expected` text; on a conflict the file is read again and the write retried once, then dropped. An opened pick and an opening tree click record an entry; a reveal-only pick (cmd-enter) does not.

An empty query shows the recent files under the root. A typed query ranks the recent files with the same scorer, shows up to 10 in their own group and removes them from the file results.

## Quick-open popup: `ui/quickopen.js`

### Opening

- `mod.json` of `my-filer-pro` has `"overlay": { "kind": "popup", "at": "top", "offset": 40, "width": 640, "height": 0.6 }`. `mod.open:my-filer-pro` opens it there and toggles it.
- `keys.json`: `"global": { "cmd-k": "mod.open:my-filer-pro" }`. The binding is global, so it works from a terminal, nvim or another mod, and it replaces `cmd-k` everywhere.
- The ⌕ button in the Files header runs `mod.open` with the same name.
- A popup copy has `props().overlay` and no `props().view`.
- While Files is hidden, the popup searches the terminal's folder; a pick outside the root the panel shows gives the toast "Outside <root>".
- The panel publishes its shown root as `shared("filer-pro.root") = { root, on, hide, editor }` (`editor`: the name of the GUI code editor) whenever its context changes. The popup searches that root while the Files panel is on screen, else the focused terminal's folder.
- Focus: `input.focus()`, then once more after 600 ms, as the `picker` mod does.

### Layout

```
┌ Go to file  ~/Repo                                     [Esc] ┐
│ ⌕ [vue▍                                                    ] │
│ recently opened                                              │
│ ▌📄 vue-legacy-patterns.md   app/.claude/rules               │
│ file results                                                 │
│  V index.vue                 src/app/modules/messages        │
│ ⏎ Open  ⌘⏎ Reveal in Files  ⇧⏎ Open in VS Code  Esc Close    │
└──────────────────────────────────────────────────────────────┘
```

- `v_virtual_list` with 30 px rows and 24 px group headers, `track_scroll` and a vertical `Scrollbar`.
- Icons from `lib/icons.js`. Matched characters in `t.accent`, semibold. The folder path in `t.foreground` at 11.5 px.
- The selected row is drawn with `card()` from `boxy.js`.
- A key hint footer under the list, shown whenever a folder is set: `⏎ Open   ⌘⏎ Reveal in Files   ⇧⏎ Open in <editor name>   Esc Close`, 11 px in `t.foreground`, keys semibold. The editor name comes from `quickTarget()` (default "VS Code").
- States: "Listing files…"; the error in `t.ansi1` with a Retry button; "No matching files"; "Type to find a file"; "Listed the first N files" when the list was cut.
- On a machine, a query waits 120 ms for more typing before it runs.

### Keys

| Key | Action |
|---|---|
| ↑ ↓, ctrl-p, ctrl-n | Move, wrapping |
| PageUp, PageDown | Move 10 rows |
| ⏎, click | Reveal and open |
| ⌘⏎ | Reveal only |
| ⇧⏎ | Reveal in the tree and open in the GUI code editor (`openInEditor`); a failure shows "Open in <editor> failed" |
| Esc, click outside | Close |

### Handoff

The popup shows the Files panel when it is hidden (`showSteps` in `lib/panels.js`), then:

```js
setShared("filer-pro.pick", { id, machine, path /* absolute */, open, line, column });
closeOverlay(props().overlay);
```

## Reveal in tree (main.js)

```
pollPick (render) ── expandPath(abs) ──► null: toast "Outside <root>", stop
                          │ rel
                          ▼
                  openPicked(rel), inside requestLeave
                          │ revealInTree(rel)
                          │ open (skipped when open is false)
```

The panel that takes a pick writes it back with `applied: true` (same id), and a panel copy that starts later skips applied picks. `filer-pro.goto-row` works the same way. A deferred Enter in the popup is dropped when the query changes.

`revealInTree(rel, cx)` adds each missing parent folder to `this.folders`, sets `this.revealWanted = rel`, and calls `this.refresh(cx)` when a parent has no entries yet.

The tree (`files-tree`) gets `.track_scroll(this.treeScroll)`. Its children follow the order of `visible()`, so a row's index there is its scroll index. In `render`, when `revealWanted` is set, nothing is loading and no file viewer is shown, `scrollToRow` runs and clears it. While the viewer is shown, the scroll waits until Back. A row that is not in the tree after loading (beyond `list_per_folder`, `list_total` or `tree_depth`) gives the toast "Beyond the list limit, not shown in the tree".

| Picked | Action |
|---|---|
| Local text or Markdown | `openInNvim(rel, cx, ":line:column")` |
| Anything else | `show(rel)`: the viewer, or the binary message with its Open button |

A file inside a macOS package has no row: the reveal scrolls to and selects the deepest ancestor that has one, the package row. The toast appears only when no ancestor has a row either.

## Header and row slot

```
Files  Repo   [/] [⌂] [↰] [📁→] [⌕] [⟳] [⚙]
```

`>_` (`square-terminal.svg`, tooltip "Move the terminal to a folder…", id `files-move-terminal`) opens the move-terminal row; it needs a focused terminal. `⌕` (`search.svg`) opens the popup. The find row has no button.

One slot under the header shows `this.row`: `null`, `"find"` or `"goto"` (the move-terminal row). Opening one closes the other. The slot is hidden while the file viewer is shown.

### Find row

```
⌕ [front▍]  1/2  [↑] [↓] [✕]
```

- Opens with `cmd-f` while the panel has focus. A zero-size child in the header (`files-keys`) has `track_focus(this.treeFocus)`; key events bubble from it to the panel root, whose `on_key_down` catches `cmd-f` (`e.keystroke === "cmd-f"`) and `escape` (closes an open row while no file is shown, so Esc in the editor goes to nvim). A folder click takes focus, so `cmd-f` works after it; a file click leaves the keyboard where it was, so nvim keeps it. With the row already open, `cmd-f` focuses its input and leaves the selection.
- Matches: case-insensitive substring of the row name, over `this.visible()`, skipping note rows. Collapsed folders have no entries, so visible rows are all loaded rows.
- The cursor is `lastOpened`. A query change jumps to the first match. ⏎ and ↓ go to the next match, ⇧⏎ and ↑ to the previous one, wrapping. Each jump calls `scrollToRow`.
- The counter is the cursor's place among the matches, `0/m` when the cursor is not a match, in `t.ansi1` when there is none.
- Other matches: matched text on `t.selection`. Current match: matched text on `t.accent` in `t.accent_foreground`.
- ⏎ selects and scrolls; it does not open. Esc closes the row and keeps the selection. The query stays for the next `cmd-f`.

### Move-terminal row

```
>_ Move terminal t3g to                              [✕]
[/Users/danish/Repo/▍                  ] [Move terminal]
┌───────────────────────────────────────┐
│ 📁 Faah                               │   floats over the tree
│ 📁 TongTong                           │
└───────────────────────────────────────┘
t3g is running Claude Code: nothing will be typed        (t.ansi1)
```

- Acts on one terminal, `this.gotoTarget = { terminal, on, name, shell, program }`: the focused terminal when the row opens from the header button, the right-clicked pane's terminal when it opens from the pane menu. `shell` and `program` come from that terminal's `program` (`program.shell`, `program.name`, else the first word of its `argv` from `terminals()`, else "another program") and are read again on every render.
- Line 1: the `square-terminal` icon, "Move terminal <terminal name or address> to" (the name semibold) and ✕ at the right. Line 2: the input at full width, then the primary button "Move terminal". Line 3, when needed: the message in `t.ansi1`.
- The input opens with focus, filled with the shown root (from the pane menu: that pane's folder) and a trailing "/", so the dropdown lists that folder's subfolders at once.
- A terminal that is not at a shell prompt disables the button, and line 3 says `<name> is running <program>: nothing will be typed`.
- Accepts an absolute path, `~/…` (this computer's home), or a path relative to the shown root. ⏎ or the button runs `exec("test", ["-d", abs], { on })` on the terminal's machine (10 s timeout), then checks that the terminal is still at a shell prompt, then runs `hc send <terminal> "cd '<abs>'"` (the path single-quoted, a `'` inside as `'\''`).
- Success: `navigate(abs, cx)` shows the folder in Files at once, and `closeRow` gives focus back to the panel. The terminal's own folder reaches it a moment later, which ends the override.
- Failure: the message on line 3, and the row stays open: "Not a folder: <path>", "Cannot reach <machine or this computer>" when `exec` rejects, `hc`'s stderr when `send` fails, or the not-a-shell line.
- A reply is dropped when the open row, its terminal or the input text changed since Enter.

Folder dropdown:

- `completionBase(text, root, home)` gives `{ dir, prefix }`: for text ending in "/" the resolved text and an empty prefix, else the resolved parent and the last segment. `filterFolders(names, prefix, max = 8)` keeps names that start with the prefix, then names that contain it, ignoring case; dot names only when the prefix starts with ".". `applyCompletion(text, name)` replaces the last segment with `name + "/"`.
- `suggest(cx)` runs 80 ms after the last input change (`this.gotoSeq` drops older waits and stale replies). It lists `dir` with `sh -c` on the terminal's machine (5 s timeout) and stores `this.gotoSuggest = { items, at, moved, prefix }`. Listings are cached per machine and folder in `this.gotoCache` while the row is open. An empty list or a failed listing shows no dropdown.
- The dropdown is the content of a `Popup` whose trigger is the input, anchored `top_left`: it paints in the window's top layer, under the input and over the tree, at the input's measured width. It covers line 3 while it shows. Rows are 28 px: a folder icon and the name with the typed part semibold; the highlighted row is drawn with `card()`.
- Keys while it shows: Tab takes the highlighted folder; ↓ ↑ (also ctrl-n, ctrl-p) move the highlight, wrapping; Esc hides the dropdown, a second Esc closes the row; ⏎ takes the highlighted folder after ↓ or ↑, else runs the move on the typed text. A click on a folder takes it. Taking a folder keeps focus in the input and lists the folders inside it.

### Pane menu (`my-menu`)

`items()` case `"pane"` gets "Move Terminal to Folder…" for terminal panes with a known folder. It writes `setShared("filer-pro.goto-row", { id, machine, cwd, terminal, at })` (`terminal` is the pane's terminal address; `at` is `Date.now()`; a request older than 5 s is a leftover that a starting panel ignores) and runs `my-filer-pro.show`. Mod commands carry no arguments, so the terminal and folder travel in the shared key. The always-shown button copy of `my-filer-pro` answers `show` by showing the Files panel (`showSteps`). The panel picks the shared key up in `render` (`pollGotoRow`) and opens the move-terminal row for `terminal`, filled with `cwd`, leaving an open file first (`requestLeave`). A request for another machine than the panel shows gives the toast "Files shows another machine" and is not marked applied.

## Errors

| Failure | Result |
|---|---|
| Listing fails (cannot enter the root, timeout) | The popup shows the error with Retry |
| Listing cut at 7 MiB | "Listed the first N files"; search works on what was listed |
| Search fails | The popup shows the error with Retry |
| Pick outside the root or on another machine | Toast "Outside <root>"; nothing opens |
| Pick beyond the list limits | File opens; toast "Beyond the list limit, not shown in the tree" |
| Unsaved edits in the viewer | `requestLeave` asks first |
| `recent.json` write conflict | Read again, retry once, then drop the entry |
| Move path is not a folder | Message in the row; the row stays open |
| Terminal is not at a shell prompt | Button disabled; the row says what the terminal runs |
| `hc send` fails | `hc`'s stderr in the row; the row stays open |
| Folder listing for completion fails | No suggestions |

## Testing

Pure code is checked with `node` assert scripts in `mods/my-filer-pro/test/`, run as `node test/<name>.test.mjs`:

- `fuzzy.test.mjs`: ranking order, path queries, multi-word queries, highlight ranges.
- `finder.test.mjs`: the line suffix, the fzf query and grep pattern, ranking with groups and hidden files, the recent list, both shell scripts on a real temporary folder, the cache, `stepRow`.
- `treefind.test.mjs`: `findMatches`, `stepMatch`, `matchCount`, `ancestorsOf`, `matchRange`, `resolveGoto`, `completionBase`, `filterFolders`, `applyCompletion`.
- `panels.test.mjs`: `showSteps` for a stack and a column.

`herdr-app check ~/.config/herdr-app/mods/my-filer-pro` and `herdr-app check ~/.config/herdr-app/mods/my-menu` must pass. Checks in a running Herdr:

1. `mod.open:my-filer-pro` opens the popup at the top with `props().overlay` set.
2. ↑ and ↓ reach the popup's `on_key_down` through `Input`.
3. `cmd-f` reaches the panel's `on_key_down`.
4. `run("my-filer-pro.show")` reaches the button copy.
5. Typing in the popup over `~/Repo` feels immediate.
6. The pane menu still fits its popup with one more item.

## Docs

The README's Keys line lists `mod.open:my-filer-pro` (for example `cmd-k`) and `fzf` as recommended. The repository ships no `keys.json`.
