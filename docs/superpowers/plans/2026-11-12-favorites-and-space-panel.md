# Favorites and a Panel per Space Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The `linear` side panel keeps a context per Herdr space, Home gets a Favorites tab that mirrors Linear's favorites, and the Ticket screen gets a ☆ that adds or removes the ticket there.

**Architecture:** `model.js` gets two pure functions (`favoriteTree`, `keepSpaces`) with Node tests. `queries.js` gets four documents, checked against Linear's schema. `main.js` swaps its `stack`/`tab`/`search` fields per space and saves them in `localStorage`; `home.js` draws the Favorites rows and the View screen's list; `ticket.js` draws the star.

**Tech Stack:** Herdr app mod runtime (`gpui-kit`, `gpui-base`, `herdr`), Linear GraphQL API, Node `node:test`, `graphql` (dev only).

**Spec:** `docs/superpowers/specs/2026-11-12-favorites-and-space-panel-design.md`. Read it before any task. The rest of the mod is in `docs/superpowers/specs/2026-11-12-linear-panel-design.md`.

---

## Rules for every task

- **Herdr docs.** Read `~/.config/herdr-app/AGENTS.md` lines 798–1037 before writing UI code. The full API is in `~/.config/herdr-app/herdr.d.ts` and `mods/linear/gpui-kit.d.ts` (22,000 lines: grep it, never read it whole).
- **Mod rules.** Never keep a `cx` for later: every callback gets its own. Async work goes in `cx.spawn(async (cx) => …)`. `InputState.new`, `TextareaState.new` and `set_value` are host calls: never from `render`. Every interactive element needs a unique `.id(...)`.
- **Comments.** A comment says what the expression produces, or which outside condition it handles. Match the style nearby. No changelog comments.
- **Checks.** From the repo root: `npm test` and `npm run check` must both pass before a commit. Do not run `herdr-app do`, `layout.*` commands or `herdr-app shot`: the person is working in that window. The controller does visual checks (Task 7).
- **Commits.** Local only, never push. Conventional message, ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Branch.** `feature/favorites-and-space-panel`, already checked out.

## File map

| File | Change |
|---|---|
| `mods/linear/model.js` | `favoriteTree`, `keepSpaces` |
| `mods/linear/queries.js` | `FAVORITES`, `VIEW_ISSUES`, `FAVORITE_CREATE`, `FAVORITE_DELETE`; `favorite { id }` in `TICKET` |
| `mods/linear/main.js` | Per-space context (`enter`, `restore`, `remember`), `loadStored`/`store`, `openView`, `toggleFolder`, `star` |
| `mods/linear/home.js` | Favorites tab and rows, View screen list |
| `mods/linear/ticket.js` | ☆ in the bar |
| `tests/model.test.mjs` | Tests for the two new functions |
| `tests/queries.test.mjs` | Export list |
| `README.md`, `docs/superpowers/specs/2026-11-12-linear-panel-design.md` | Describe the new behavior |

---

### Task 1: `favoriteTree` and `keepSpaces`

**Files:**
- Modify: `mods/linear/model.js` (append at the end)
- Test: `tests/model.test.mjs`

- [ ] **Step 1: Write the failing tests**

In `tests/model.test.mjs`, add `favoriteTree, keepSpaces` to the import list:

```js
import {
  parseSearch, groupIssues, statusOptions, buildThreads, relationsOf,
  ticketLine, commentText, startText, pushRecent, isPanelShown, isTicketTabShown, ticketTab, targetAgent, relativeTime, imagesAsLinks,
  favoriteTree, keepSpaces,
} from "../mods/linear/model.js";
```

Append at the end of the file:

```js
const fav = (id, type, sortOrder, parent) => ({ id, type, sortOrder, parent: parent ? { id: parent } : null });
const shape = (nodes) => nodes.map((n) => (n.children.length ? [n.id, shape(n.children)] : n.id));

test("favoriteTree: top level and folder children in sortOrder, folders inside folders", () => {
  const tree = favoriteTree([
    fav("b", "issue", 2), fav("f", "folder", 1), fav("c", "project", 2, "f"), fav("a", "issue", 1, "f"),
    fav("g", "folder", 3, "f"), fav("d", "issue", 1, "g"),
  ]);
  assert.deepEqual(shape(tree), [["f", ["a", "c", ["g", ["d"]]]], "b"]);
});
test("favoriteTree: a node whose parent is missing is top-level", () => {
  assert.deepEqual(favoriteTree([fav("a", "issue", 2, "gone"), fav("b", "issue", 1)]).map((n) => n.id), ["b", "a"]);
});
test("keepSpaces: drops spaces that are gone", () => {
  assert.deepEqual(keepSpaces({ s1: { tab: "mine" }, s2: { tab: "recent" } }, ["s2", "s3"]), { s2: { tab: "recent" } });
});
test("keepSpaces: keeps all while no space ids are known", () => {
  const saved = { s1: { tab: "mine" } };
  assert.deepEqual(keepSpaces(saved, []), saved);
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `npm test`
Expected: FAIL. The new tests report `favoriteTree is not a function` / `keepSpaces is not a function`.

- [ ] **Step 3: Add the functions**

Append to `mods/linear/model.js`:

```js
// Favorites as a tree: top-level nodes in sortOrder, each with `children` in sortOrder. A node whose parent is not
// in the list is top-level.
export function favoriteTree(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, { ...n, children: [] }]));
  const top = [];
  for (const n of byId.values()) {
    const parent = n.parent && byId.get(n.parent.id);
    (parent ? parent.children : top).push(n);
  }
  const sort = (list) => list.sort((a, b) => a.sortOrder - b.sortOrder).forEach((n) => sort(n.children));
  sort(top);
  return top;
}

// The saved per-space contexts whose space still exists. With no space ids known yet, all of them.
export const keepSpaces = (saved, ids) =>
  ids.length ? Object.fromEntries(Object.entries(saved).filter(([id]) => ids.includes(id))) : saved;
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `npm test`
Expected: PASS, no failures.

- [ ] **Step 5: Commit**

```bash
git add mods/linear/model.js tests/model.test.mjs
git commit -m "feat: add favoriteTree and keepSpaces

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Favorites queries and mutations

**Files:**
- Modify: `mods/linear/queries.js`
- Test: `tests/queries.test.mjs`

- [ ] **Step 1: Update the export list test**

In `tests/queries.test.mjs`, replace the expected list:

```js
test("queries.js exports every document the mod uses", () => {
  assert.deepEqual(Object.keys(Q).sort(), [
    "BRANCH", "BY_NUMBER", "COMMENT_CREATE", "FAVORITES", "FAVORITE_CREATE", "FAVORITE_DELETE", "ISSUE_UPDATE",
    "MY_ISSUES", "PROJECTS", "PROJECT_ISSUES", "SEARCH", "TICKET", "VIEW_ISSUES",
  ]);
});
```

- [ ] **Step 2: Run the tests and see the export test fail**

Run: `npm test`
Expected: FAIL in "queries.js exports every document the mod uses" (missing `FAVORITES`, `FAVORITE_CREATE`, `FAVORITE_DELETE`, `VIEW_ISSUES`).

- [ ] **Step 3: Add the documents**

In `mods/linear/queries.js`, after `PROJECT_ISSUES`, add:

```js
export const FAVORITES = `query Favorites {
  favorites(first: 250) {
    nodes {
      id type sortOrder folderName url parent { id }
      issue { ${ROW} }
      project { id name color }
      customView { id name color modelName }
      cycle { name number }
      document { title }
    }
  }
}`;

export const VIEW_ISSUES = `query ViewIssues($id: String!) {
  customView(id: $id) { id name issues(first: 100) { nodes { ${ROW} } } }
}`;
```

In `TICKET`, after the line `    project { name }`, add:

```
    favorite { id }
```

After `COMMENT_CREATE` at the end of the file, add:

```js
export const FAVORITE_CREATE = `mutation FavoriteCreate($input: FavoriteCreateInput!) {
  favoriteCreate(input: $input) { success }
}`;

export const FAVORITE_DELETE = `mutation FavoriteDelete($id: String!) {
  favoriteDelete(id: $id) { success }
}`;
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `npm test`
Expected: PASS. Each new document has its own passing "validates against Linear's schema" test.

- [ ] **Step 5: Commit**

```bash
git add mods/linear/queries.js tests/queries.test.mjs
git commit -m "feat: add favorites and view queries

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: A panel context per space

**Files:**
- Modify: `mods/linear/main.js`

The panel keeps `stack`, `tab` and `search.{kind,value}` as its live fields. `enter(space)` swaps them for that space's saved copy and changes only fields, so `render` may call it. `restore()` does the host side: the search box text and a comment box for each ticket on the stack. `remember()` saves the shown space's context to `this.spaces` and `localStorage` key `spaces`.

`set_value` on the search box may fire its `change` handler. The handler runs a search only when the box is blank and `search.kind` is not `"empty"`. `enter` sets `kind` before `restore` sets the text, so the two always agree and no search runs.

- [ ] **Step 1: Import `keepSpaces`**

```js
import { isPanelShown, isTicketTabShown, keepSpaces, parseSearch, pushRecent, startText, targetAgent, ticketTab } from "./model.js";
```

- [ ] **Step 2: Replace `loadRecent` with `loadStored` and `store`**

Replace the whole `loadRecent` function and its comment with:

```js
// The JSON value stored under `key`, or `fallback` when it is missing, unreadable or of another shape.
function loadStored(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value && typeof value === "object" && Array.isArray(value) === Array.isArray(fallback) ? value : fallback;
  } catch {
    return fallback;
  }
}

function store(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

// The id of the shown space, or null before Herdr reports one.
const shownSpace = () => spaces().find((s) => s.active)?.id ?? null;
```

In `init`, replace:

```js
    this.recent = this.ticket ? [] : loadRecent(); // only the side panel keeps Recent
```

with:

```js
    this.recent = this.ticket ? [] : loadStored("recent", []); // tickets opened in the panel, newest first: [{ identifier, title }]
    this.spaces = this.ticket ? {} : keepSpaces(loadStored("spaces", {}), spaces().map((s) => s.id)); // space id → { stack, tab, search: { kind, value } }
    this.space = null; // the space whose context the panel shows; null in a ticket tab
```

Replace the body of `saveRecent()`:

```js
  saveRecent() {
    store("recent", this.recent);
  }
```

- [ ] **Step 3: Enter the shown space in `init`**

In `init`, replace:

```js
    if (this.ticket) this.draft(this.ticket);
```

with:

```js
    if (!this.ticket) this.enter(shownSpace());
    this.restore();
```

- [ ] **Step 4: Add `enter`, `restore` and `remember`**

After `saveRecent()`, add:

```js
  // Shows the context saved for `space`, after saving the one shown so far. A space seen for the first time starts on
  // Home → My issues. It changes only fields, so render can call it; restore() does the host side.
  enter(space) {
    this.remember();
    const saved = this.spaces[space];
    this.space = space;
    this.stack = saved?.stack ?? [{ screen: "home" }];
    this.tab = saved?.tab ?? "mine";
    Object.assign(this.search, saved?.search ?? { kind: "empty", value: "" }, { notFound: null });
    this.lookup = null;
    this.menu = null;
  }

  // Puts the shown context into host state: the search box text, and a comment box for each ticket on the stack.
  restore() {
    const { kind, value } = this.search;
    this.search.input.set_value(kind === "empty" ? "" : String(value));
    for (const e of this.stack) if (e.screen === "ticket") this.draft(e.key);
  }

  // Saves the shown space's context. A ticket tab keeps none.
  remember() {
    if (this.ticket || !this.space) return;
    const { kind, value } = this.search;
    this.spaces[this.space] = { stack: this.stack, tab: this.tab, search: { kind, value } };
    store("spaces", this.spaces);
  }
```

- [ ] **Step 5: Save after every move**

`setTab`:

```js
  setTab(tab, cx) {
    this.tab = tab;
    this.remember();
    this.load(cx);
  }
```

`runSearch`, after `this.search.value = value;`:

```js
    this.remember();
```

`openProject`:

```js
  openProject(project, cx) {
    this.stack.push({ screen: "project", id: project.id, name: project.name });
    this.remember();
    this.load(cx);
  }
```

`open`, right after `this.stack.push({ screen: "ticket", key: identifier });`:

```js
    this.remember();
```

`back`, right after `const gone = this.stack.pop();`:

```js
    this.remember();
```

- [ ] **Step 6: Keep a comment box while any space holds its ticket**

Replace `dropDraft` and its comment with:

```js
  // Frees the comment box of a ticket that no stack holds any more, unless it holds text or is sending.
  dropDraft(key) {
    const d = this.drafts[key];
    const held = [this.stack, ...Object.values(this.spaces).map((c) => c.stack)].some((s) => s.some((e) => e.key === key));
    if (!d || d.sending || d.input.value() || held) return;
    d.input.release();
    delete this.drafts[key];
  }
```

- [ ] **Step 7: Follow the shown space in `render`**

In `render`, replace:

```js
    if (!this.ticket) {
      this.watchBranch(cx);
```

with:

```js
    if (!this.ticket) {
      const space = shownSpace();
      if (space && space !== this.space) {
        this.enter(space);
        // restore() and load() are host calls, so they run from a task.
        cx.spawn(async (cx) => {
          this.restore();
          this.load(cx);
        });
      }
      this.watchBranch(cx);
```

- [ ] **Step 8: Run the checks**

Run: `npm test && npm run check`
Expected: tests PASS; `herdr-app check` reports no errors.

- [ ] **Step 9: Commit**

```bash
git add mods/linear/main.js
git commit -m "feat: keep a panel context per space

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Favorites tab and View screen

**Files:**
- Modify: `mods/linear/main.js`
- Modify: `mods/linear/home.js`

- [ ] **Step 1: State, slots and requests in `main.js`**

In `init`, update the two comments and add `closedFolders` after the `this.spaces` line:

```js
    this.stack = [this.ticket ? { screen: "ticket", key: this.ticket } : { screen: "home" }]; // also { screen: "project", id, name }, { screen: "view", id, name } and { screen: "ticket", key }
    this.tab = "mine"; // "mine" | "favorites" | "projects" | "recent"
```

```js
    this.closedFolders = this.ticket ? [] : loadStored("closedFolders", []); // ids of the Favorites folders shown closed
```

Replace `key(entry)`'s last line:

```js
    return this.searchSlot() ?? (entry.screen === "home" ? this.tab : `${entry.screen}:${entry.id}`);
```

In `request(entry)`, replace the lines from the project line to the end:

```js
    if (entry.screen === "project") return [Q.PROJECT_ISSUES, { id: entry.id }];
    if (entry.screen === "view") return [Q.VIEW_ISSUES, { id: entry.id }];
    if (this.tab === "mine") return [Q.MY_ISSUES, {}];
    if (this.tab === "favorites") return [Q.FAVORITES, {}];
    if (this.tab === "projects") return [Q.PROJECTS, {}];
    return null;
```

After `openProject`, add:

```js
  openView(customView, cx) {
    this.stack.push({ screen: "view", id: customView.id, name: customView.name });
    this.remember();
    this.load(cx);
  }

  toggleFolder(id, cx) {
    this.closedFolders = this.closedFolders.includes(id) ? this.closedFolders.filter((x) => x !== id) : [...this.closedFolders, id];
    store("closedFolders", this.closedFolders);
    cx.notify();
  }
```

- [ ] **Step 2: Rows in `home.js`**

First line comment:

```js
// The Home, Project and View screens: search, tabs, the branch row and a ticket list. Also the setup and error cards,
```

Import:

```js
import { favoriteTree, groupIssues, relativeTime } from "./model.js";
```

Tabs:

```js
const TABS = [["mine", "My issues"], ["favorites", "Favorites"], ["projects", "Projects"], ["recent", "Recent"]];
```

`issuesOf`:

```js
// Issue rows from any list query's data: My issues, a project, a view, a number search or a text search.
const issuesOf = (d) =>
  d.viewer?.assignedIssues?.nodes ?? d.project?.issues?.nodes ?? d.customView?.issues?.nodes ?? d.issues?.nodes ?? d.searchIssues?.nodes ?? [];
```

Replace `projectRows` with:

```js
const named = (el, t, color, name) => el.child(dot(color, t)).child(div().flex_1().min_w(0).truncate().child(name));

const projectRows = (view, t, projects) =>
  projects.map((p) => named(row(`p-${p.id}`, t, (_e, cx) => view.openProject(p, cx)), t, p.color, p.name));

// A favorite's row, or null for one the panel cannot open. A folder opens or closes; a kind with no screen here
// opens in Linear.
function favoriteRow(view, t, f) {
  const id = `f-${f.id}`;
  if (f.type === "folder") {
    return row(id, t, (_e, cx) => view.toggleFolder(f.id, cx))
      .child(div().flex_none().w(10).text_color(t.dim).child(view.closedFolders.includes(f.id) ? "▸" : "▾"))
      .child(div().flex_1().min_w(0).truncate().child(f.folderName ?? "Folder"));
  }
  if (f.issue) return issueRow(view, t, id, f.issue);
  if (f.project) return named(row(id, t, (_e, cx) => view.openProject(f.project, cx)), t, f.project.color, f.project.name);
  const v = f.customView;
  if (v?.modelName === "Issue") return named(row(id, t, (_e, cx) => view.openView(v, cx)), t, v.color, v.name);
  if (!f.url) return null;
  const name = v?.name ?? f.document?.title ?? (f.cycle && (f.cycle.name || `Cycle ${f.cycle.number}`)) ?? f.type;
  return named(row(id, t, (_e, cx) => cx.open_url(f.url)), t, null, name);
}

// Rows for favorites in order. An open folder's children follow it, one step further in.
const favoriteRows = (view, t, nodes, depth = 0) =>
  nodes.flatMap((f) => {
    const r = favoriteRow(view, t, f);
    if (!r) return [];
    const el = r.when(depth > 0, (e) => e.pl(8 + depth * 16));
    const open = f.type === "folder" && !view.closedFolders.includes(f.id);
    return open ? [el, ...favoriteRows(view, t, f.children, depth + 1)] : [el];
  });

// The rows of a list query's data: favorites, projects or issues.
const listRows = (view, t, d) =>
  d.favorites ? favoriteRows(view, t, favoriteTree(d.favorites.nodes))
  : d.projects ? projectRows(view, t, d.projects.nodes)
  : issueRows(view, t, issuesOf(d));
```

In `body`, replace the last `.when(Boolean(d), …)` line:

```js
    .when(Boolean(d), (e) => e.child(list(`list-${slot}`, t, listRows(view, t, d))));
```

- [ ] **Step 3: Run the checks**

Run: `npm test && npm run check`
Expected: tests PASS; `herdr-app check` reports no errors.

- [ ] **Step 4: Commit**

```bash
git add mods/linear/main.js mods/linear/home.js
git commit -m "feat: add the Favorites tab and the View screen

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The star

**Files:**
- Modify: `mods/linear/main.js`
- Modify: `mods/linear/ticket.js`

- [ ] **Step 1: `star` in `main.js`**

After `update(issue, input, cx)`, add:

```js
  // Adds the open ticket to the viewer's Linear favorites, or removes it, then refetches Favorites.
  // A click while another change is in flight is ignored.
  star(issue, cx) {
    if (this.updating) return;
    this.updating = true;
    const [doc, vars] = issue.favorite
      ? [Q.FAVORITE_DELETE, { id: issue.favorite.id }]
      : [Q.FAVORITE_CREATE, { input: { issueId: issue.id } }];
    this.mutate(doc, vars, cx, (ok) => {
      this.updating = false;
      if (ok) this.client.query(Q.FAVORITES, {}, { ttl: 0 });
    });
  }
```

`client.query` never rejects: every failure comes back as `{ error }`.

- [ ] **Step 2: ☆ in the Ticket bar**

In `ticket.js` `bar()`, between the `ticket-refresh` line and the `ticket-tab` line, add:

```js
    .when(Boolean(issue), (e) => e.child(icon("ticket-star", (_e, cx) => view.star(issue, cx), issue.favorite ? "★" : "☆")
      .when(Boolean(issue.favorite), (s) => s.text_color(t.accent))
      .tooltip(issue.favorite ? "Remove from favorites" : "Add to favorites")))
```

- [ ] **Step 3: Run the checks**

Run: `npm test && npm run check`
Expected: tests PASS; `herdr-app check` reports no errors.

- [ ] **Step 4: Commit**

```bash
git add mods/linear/main.js mods/linear/ticket.js
git commit -m "feat: star a ticket into Linear favorites

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: README and panel spec

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-11-12-linear-panel-design.md`

- [ ] **Step 1: README "Use"**

Make the start of the list read:

```markdown
- **Spaces**: each Herdr space has its own panel. Its screens, tab and search come back when you return to the space, also after a restart.
- **Home**
  - The search box takes a key, a bare number, a Linear URL or text. Press Enter.
  - The tabs are My issues, Favorites, Projects and Recent.
  - Favorites shows your Linear favorites with their folders. An issue view opens its issues. A kind the panel has no screen for, such as a cycle, opens in Linear.
  - A "This branch" row shows the ticket for the git branch of the focused pane.
```

Under **Ticket**, after the "You can change the status…" line, add:

```markdown
  - **☆** adds the ticket to your Linear favorites. **★** removes it.
```

- [ ] **Step 2: Panel spec**

In `docs/superpowers/specs/2026-11-12-linear-panel-design.md`:

1. Screens diagram:

   ```
   Home ──row──▶ Ticket ──sub-issue / parent / relation──▶ Ticket ...
     ├──project──▶ Project issues ──row──▶ Ticket
     └──favorite view──▶ View issues ──row──▶ Ticket
   ```

   After "A back button returns along the stack." add: "Each space has its own stack; see `2026-11-12-favorites-and-space-panel-design.md`."
2. Home mock-up, tab row: `│ [My issues] Favorites Projects Recent  │`
3. Home bullets, after **My issues**: "- **Favorites** mirrors the viewer's Linear favorites, folders included. See `2026-11-12-favorites-and-space-panel-design.md`."
4. **This branch** bullet: "one row on Home, Project, View and search screens".
5. Ticket actions table, before the ⧉ row: "| ☆ / ★ | Adds the ticket to the viewer's Linear favorites with `favoriteCreate`, or removes it with `favoriteDelete`. |". The sentence under the table becomes "A status, assignee or star click while another is in flight is ignored."
6. Data diagram, the storage lines:

   ```
                                            ├──▶ localStorage "cache:<query>:<vars>" ──▶ screens (stale first, then fresh)
                                            ├──▶ localStorage "recent" (20 tickets, side panel only)
                                            ├──▶ localStorage "spaces" (each space's screens, side panel only)
                                            └──▶ localStorage "closedFolders" (Favorites folders shown closed)
   ```

7. Ticket query block: add `favorite { id }` after `project { name }`, as in `queries.js`.
8. Code layout: `model.js` row ends "…panel and ticket tab visibility, the favorites tree, saved spaces." `home.js` row starts "The Home, Project and View screens".
9. Not included: "List and board views beyond the four Home tabs, cycles, saved views outside Favorites, the inbox, creating issues, and editing the title, description, labels, priority or estimate."

- [ ] **Step 3: Commit**

```bash
git add README.md docs/superpowers/specs/2026-11-12-linear-panel-design.md
git commit -m "docs: describe favorites and the panel per space

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Install and look (controller only)

- [ ] **Step 1: Install**

Run: `npm run install:local`
Expected: `herdr-app check` passes and the mod copies to `~/.config/herdr-app/mods/linear/`.

- [ ] **Step 2: Look**

With `herdr-app shot`, check:

- The Favorites tab shows the folders open, with their items under them, indented. A folder click closes it, and it stays closed after a tab change.
- An issue favorite opens the Ticket screen. A project opens its issues. A custom view opens a View screen with ← back, or opens in Linear when it is not an issue view.
- ☆ on a ticket turns to ★ after the click, and the issue shows in Favorites.
- Space A on a ticket and space B on Home: switching shows each space's own screen. A search in A does not show in B.

- [ ] **Step 3: Report**

Tell the person what each check showed, with the shots. Ask them to restart Herdr once and confirm each space's panel comes back.
