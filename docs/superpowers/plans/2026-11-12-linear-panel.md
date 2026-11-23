# Linear Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Herdr app mod, `linear`, that shows Linear tickets in the right-side panel and hands a ticket or a comment to a coding agent.

**Architecture:** Plain ES modules under `mods/linear/`. `model.js` (pure functions) and `linear.js` (API client with injected `fetch`, key reader and storage) import nothing from Herdr, so `node --test` covers them. `main.js` is the Herdr `View`; `home.js` and `ticket.js` render its two screens.

**Tech Stack:** Herdr app mod runtime (GPUI builders from `gpui-kit` / `gpui-base`, host API from `herdr`), Linear GraphQL API, Node 24 `node:test`, `graphql` (dev only, schema validation).

**Spec:** `docs/superpowers/specs/2026-11-12-linear-panel-design.md`. Read it before any task.

---

## Rules for every task

- **Herdr docs.** Read `~/.config/herdr-app/AGENTS.md` lines 798–1037 (mods, UI, the `herdr` module) before writing UI code. The full API is in `~/.config/herdr-app/herdr.d.ts` and `~/.config/herdr-app/gpui-kit.d.ts` (22,000 lines: grep it, never read it whole).
- **Herdr examples.** `~/.config/herdr-app/mods/pr-flow/main.js` is a panel with a list that opens a detail view, a back button, `TextView`, `TextareaState`/`Textarea`. `~/.config/herdr-app/mods/prompt/main.js` shows `InputState`/`Input`. Read them for patterns. Never edit anything under `~/.config/herdr-app/` unless the task says so.
- **Mod rules.** Never keep a `cx` for later: every callback gets its own. Async work goes in `cx.spawn(async (cx) => …)`, timers in `cx.timer`. No `setTimeout`. Use `theme()` colors. Every interactive element needs a unique `.id(...)`. Animate with `.frames`, `.spin` or `.loop`, never with a redraw timer.
- **Comments.** A comment says what the expression produces, or which outside condition it handles. Match the style nearby. No changelog comments.
- **Checks.** From the repo root: `npm test` and `npm run check` (`herdr-app check mods/linear`) must both pass before a commit. Do not run `herdr-app do`, `layout.*` commands or `herdr-app shot`: the person is working in that window. The controller does visual checks.
- **Commits.** Local only, never push. Conventional message, ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File map

| File | Responsibility |
|---|---|
| `package.json` | Scripts and the `graphql` dev dependency |
| `scripts/install.sh` | `herdr-app check`, then copy `mods/linear/` into Herdr's mods folder |
| `scripts/fetch-schema.sh` | Download Linear's SDL to `.cache/linear-schema.graphql` |
| `mods/linear/mod.json` | `{ "place": "none", "title": "Linear" }` |
| `mods/linear/linear.svg` | Panel button icon |
| `mods/linear/queries.js` | Every GraphQL document, as exported strings |
| `mods/linear/model.js` | Pure functions: search parsing, grouping, state order, threads, relations, agent texts, recent list, panel visibility, target agent, relative time |
| `mods/linear/linear.js` | `createClient`: requests, key read, cache, error kinds |
| `mods/linear/main.js` | The `View`: screen stack, data loading, actions, agent bridge, timers |
| `mods/linear/home.js` | `renderHome(view, cx)` |
| `mods/linear/ticket.js` | `renderTicket(view, cx)` |
| `tests/queries.test.mjs` | Validates every document in `queries.js` against the schema |
| `tests/model.test.mjs` | `model.js` |
| `tests/linear.test.mjs` | `linear.js` with a fake `fetch` and in-memory storage |

---

### Task 1: Repo scaffold

**Files:**
- Create: `package.json`, `LICENSE`, `.gitignore`, `scripts/install.sh`, `scripts/fetch-schema.sh`, `mods/linear/mod.json`, `mods/linear/linear.svg`, `mods/linear/main.js`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "herdr-linear",
  "version": "0.1.0",
  "description": "Linear tickets in the Herdr app's side panel, handed to coding agents",
  "license": "MIT",
  "author": "Danish",
  "private": true,
  "type": "module",
  "keywords": ["herdr", "herdr-mod", "linear"],
  "scripts": {
    "pretest": "test -f .cache/linear-schema.graphql || bash scripts/fetch-schema.sh",
    "test": "node --test 'tests/*.test.mjs'",
    "check": "herdr-app check mods/linear",
    "install:local": "bash scripts/install.sh",
    "schema": "bash scripts/fetch-schema.sh"
  },
  "devDependencies": { "graphql": "^16.9.0" }
}
```

- [ ] **Step 2: Write `LICENSE`** — the standard MIT text with `Copyright (c) 2026 Danish`.

- [ ] **Step 3: Write `.gitignore`**

```
node_modules/
.cache/
mods/linear/jsconfig.json
mods/linear/*.d.ts
```

- [ ] **Step 4: Write `scripts/fetch-schema.sh`**

```bash
#!/usr/bin/env bash
# Writes Linear's GraphQL SDL to .cache/linear-schema.graphql.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .cache
gh api repos/linear/linear/contents/packages/sdk/src/schema.graphql \
  -H "Accept: application/vnd.github.raw" > .cache/linear-schema.graphql
echo "schema: $(wc -c < .cache/linear-schema.graphql) bytes"
```

- [ ] **Step 5: Write `scripts/install.sh`**

```bash
#!/usr/bin/env bash
# Checks the mod, then copies it into Herdr's mods folder.
set -euo pipefail
cd "$(dirname "$0")/.."
herdr-app check mods/linear
dest="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/linear"
mkdir -p "$dest"
# Herdr writes jsconfig.json and the .d.ts files into the installed folder itself.
rsync -a --delete --exclude jsconfig.json --exclude '*.d.ts' mods/linear/ "$dest/"
echo "installed: $dest"
```

- [ ] **Step 6: Write `mods/linear/mod.json`**

```json
{ "place": "none", "title": "Linear" }
```

- [ ] **Step 7: Write `mods/linear/linear.svg`** — a 16×16 single-path monochrome icon (a circle with three diagonal stripes, Linear-like but not Linear's logo), `fill="currentColor"` so `svg()` can tint it.

- [ ] **Step 8: Write a placeholder `mods/linear/main.js`**

```js
// Linear: tickets in the side panel.
import { View } from "gpui-kit";
import { v_flex } from "gpui-base";
import { theme } from "herdr";

export default class Linear extends View {
  render() {
    const t = theme();
    return v_flex().id("linear-root").size_full().bg(t.surface).p(12).text_size(13).text_color(t.muted).child("Linear");
  }
}
```

- [ ] **Step 9: Install and check**

Run: `chmod +x scripts/*.sh && npm install && npm run check`
Expected: `npm install` adds `graphql` and writes `package-lock.json`; `herdr-app check` exits 0.

- [ ] **Step 10: Commit** — `package.json`, `package-lock.json`, `LICENSE`, `.gitignore`, `scripts/`, `mods/linear/`, and both files under `docs/superpowers/`. Message: `chore: scaffold the herdr-linear mod`.

---

### Task 2: Panel integration (controller does this, not a subagent)

**Files (personal Herdr config, outside the repo):**
- Modify: `~/.config/herdr-app/layouts/danish.json` — the `panel-body` stack's `children`
- Modify: `~/.config/herdr-app/mods/my-annotator-tabs/main.js` — the `segments` list

- [ ] **Step 1:** Copy both files to `~/.config/herdr-app/backups/herdr-linear/` with a timestamp suffix.
- [ ] **Step 2:** Append to the `panel-body` stack's `children`: `{ "id": "linear", "type": "block", "content": { "mod": "linear" } }`.
- [ ] **Step 3:** After the `timeline` entry in `segments`, add: `find(body, "linear") && ["linear", "Linear", "mods/linear/linear.svg"],`
- [ ] **Step 4:** `npm run install:local`, then `herdr-app check ~/.config/herdr-app/mods/my-annotator-tabs` and `herdr-app status`.
- [ ] **Step 5:** Tell the person the Linear button now exists. With their go-ahead, show the panel and take a `herdr-app shot` to confirm the placeholder renders.

---

### Task 3: GraphQL documents and schema validation

**Files:**
- Create: `mods/linear/queries.js`
- Test: `tests/queries.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSchema, parse, validate } from "graphql";
import * as Q from "../mods/linear/queries.js";

const sdl = readFileSync(new URL("../.cache/linear-schema.graphql", import.meta.url), "utf8");
const schema = buildSchema(sdl, { assumeValidSDL: true });

test("queries.js exports every document the mod uses", () => {
  assert.deepEqual(Object.keys(Q).sort(), [
    "BRANCH", "BY_NUMBER", "COMMENT_CREATE", "ISSUE_UPDATE", "MY_ISSUES",
    "PROJECTS", "PROJECT_ISSUES", "SEARCH", "TICKET",
  ]);
});

for (const [name, doc] of Object.entries(Q)) {
  test(`${name} validates against Linear's schema`, () => {
    assert.deepEqual(validate(schema, parse(doc)).map((e) => e.message), []);
  });
}
```

- [ ] **Step 2: Run it and see it fail**

Run: `npm test`
Expected: the schema downloads on first run; the test fails with "Cannot find module … queries.js".

- [ ] **Step 3: Write `mods/linear/queries.js`** starting from these documents. Each operation name is the export name in PascalCase, because `linear.js` keys its cache by operation name.

```js
// Linear GraphQL documents. Every list row uses the ROW fields.
const ROW = `id identifier title priority priorityLabel updatedAt url
  state { id name type position color }`;
const OPEN = `{ state: { type: { nin: ["completed", "canceled"] } } }`;

export const MY_ISSUES = `query MyIssues {
  viewer { assignedIssues(first: 100, orderBy: updatedAt, filter: ${OPEN}) { nodes { ${ROW} } } }
}`;

export const PROJECTS = `query Projects {
  projects(first: 50, orderBy: updatedAt, filter: {
    status: { type: { nin: ["completed", "canceled"] } }
    accessibleTeams: { some: { members: { some: { isMe: { eq: true } } } } }
  }) { nodes { id name color updatedAt } }
}`;

export const PROJECT_ISSUES = `query ProjectIssues($id: String!) {
  project(id: $id) { id name issues(first: 100, filter: ${OPEN}) { nodes { ${ROW} } } }
}`;

export const SEARCH = `query Search($term: String!) {
  searchIssues(term: $term, first: 25) { nodes { ${ROW} } }
}`;

export const BY_NUMBER = `query ByNumber($number: Float!) {
  issues(first: 25, filter: { number: { eq: $number }, team: { members: { some: { isMe: { eq: true } } } } }) {
    nodes { ${ROW} }
  }
}`;

export const BRANCH = `query Branch($branch: String!) {
  issueVcsBranchSearch(branchName: $branch) { ${ROW} }
}`;

export const TICKET = `query Ticket($id: String!) {
  viewer { id }
  issue(id: $id) {
    id identifier title url branchName priority priorityLabel description dueDate estimate
    state { id name type color }
    assignee { id name }
    labels { nodes { name color } }
    project { id name }
    cycle { number name }
    parent { identifier title }
    children { nodes { identifier title state { name type } } }
    relations { nodes { type relatedIssue { identifier title state { type } } } }
    inverseRelations { nodes { type issue { identifier title state { type } } } }
    attachments { nodes { title subtitle url sourceType } }
    comments(first: 100) { nodes { id body createdAt url user { name } parent { id } } }
    team { id key states { nodes { id name type position color } } }
  }
}`;

export const ISSUE_UPDATE = `mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) { success }
}`;

export const COMMENT_CREATE = `mutation CommentCreate($input: CommentCreateInput!) {
  commentCreate(input: $input) { success }
}`;
```

- [ ] **Step 4: Run the test and fix each document against the schema**

Run: `npm test`
Expected: some documents may fail validation (the field names above come from memory). For each failure, grep `.cache/linear-schema.graphql` for the type (`type IssueSearchResult`, `input ProjectFilter`, …) and fix the document with the nearest field that gives the same data. Keep the fields each screen in the spec needs. Rerun until every test passes. Then report each change you made and why in your final message.

- [ ] **Step 5: Commit** — `feat: add Linear GraphQL documents with schema validation`.

---

### Task 4: Pure model functions

**Files:**
- Create: `mods/linear/model.js`
- Test: `tests/model.test.mjs`

`model.js` imports nothing. Each export below is one function.

- [ ] **Step 1: Write the failing tests**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseSearch, groupIssues, statusOptions, buildThreads, relationsOf,
  ticketLine, commentText, startText, pushRecent, isPanelShown, targetAgent, relativeTime,
} from "../mods/linear/model.js";

test("parseSearch: a Linear URL opens its key", () => {
  assert.deepEqual(parseSearch("https://linear.app/acme/issue/WEB-212/fix-thing"), { kind: "key", value: "WEB-212" });
});
test("parseSearch: a key in any case", () => {
  assert.deepEqual(parseSearch(" web-212 "), { kind: "key", value: "WEB-212" });
});
test("parseSearch: a bare number", () => {
  assert.deepEqual(parseSearch("212"), { kind: "number", value: 212 });
});
test("parseSearch: other text", () => {
  assert.deepEqual(parseSearch("signing key"), { kind: "text", value: "signing key" });
});
test("parseSearch: blank", () => {
  assert.deepEqual(parseSearch("   "), { kind: "empty", value: "" });
});

const st = (name, type, position) => ({ id: name, name, type, position, color: "#000" });
const row = (identifier, state, priority, updatedAt) =>
  ({ id: identifier, identifier, title: identifier, priority, priorityLabel: "", updatedAt, state });

test("groupIssues: state type order, then state position; priority, then recency", () => {
  const prog = st("In Progress", "started", 2), review = st("In Review", "started", 3);
  const todo = st("Todo", "unstarted", 1), back = st("Backlog", "backlog", 0), tri = st("Triage", "triage", 0);
  const groups = groupIssues([
    row("A-1", todo, 3, "2026-11-01T00:00:00Z"),
    row("A-2", prog, 0, "2026-11-10T00:00:00Z"),
    row("A-3", prog, 1, "2026-11-02T00:00:00Z"),
    row("A-4", review, 2, "2026-11-03T00:00:00Z"),
    row("A-5", back, 2, "2026-11-04T00:00:00Z"),
    row("A-6", tri, 1, "2026-11-05T00:00:00Z"),
    row("A-7", prog, 1, "2026-11-09T00:00:00Z"),
  ]);
  assert.deepEqual(groups.map((g) => [g.name, g.issues.map((i) => i.identifier)]), [
    ["In Progress", ["A-7", "A-3", "A-2"]],
    ["In Review", ["A-4"]],
    ["Todo", ["A-1"]],
    ["Backlog", ["A-5"]],
    ["Triage", ["A-6"]],
  ]);
});

test("statusOptions: triage, backlog, unstarted, started, completed, canceled, then position", () => {
  const states = [st("Done", "completed", 0), st("In Review", "started", 3), st("Todo", "unstarted", 1),
    st("In Progress", "started", 2), st("Canceled", "canceled", 0), st("Backlog", "backlog", 0), st("Triage", "triage", 0)];
  assert.deepEqual(statusOptions(states).map((s) => s.name),
    ["Triage", "Backlog", "Todo", "In Progress", "In Review", "Done", "Canceled"]);
});

const c = (id, createdAt, parent) =>
  ({ id, body: id, createdAt, url: `u#${id}`, user: { name: "x" }, parent: parent ? { id: parent } : null });

test("buildThreads: top-level oldest first, replies under their parent oldest first", () => {
  const threads = buildThreads([
    c("r2", "2026-11-03T00:00:00Z", "t1"), c("t2", "2026-11-02T00:00:00Z"),
    c("t1", "2026-11-01T00:00:00Z"), c("r1", "2026-11-02T12:00:00Z", "t1"),
  ]);
  assert.deepEqual(threads.map((t) => [t.comment.id, t.replies.map((r) => r.id)]), [["t1", ["r1", "r2"]], ["t2", []]]);
});
test("buildThreads: a reply whose parent is missing becomes top-level", () => {
  const threads = buildThreads([c("r1", "2026-11-02T00:00:00Z", "gone"), c("t1", "2026-11-01T00:00:00Z")]);
  assert.deepEqual(threads.map((t) => t.comment.id), ["t1", "r1"]);
});

test("relationsOf: blocks, blocked by, related, duplicate of", () => {
  const i = (identifier) => ({ identifier, title: identifier, state: { type: "started" } });
  const r = relationsOf({
    relations: { nodes: [
      { type: "blocks", relatedIssue: i("A-2") }, { type: "related", relatedIssue: i("A-3") },
      { type: "duplicate", relatedIssue: i("A-4") }, { type: "similar", relatedIssue: i("A-9") },
    ] },
    inverseRelations: { nodes: [
      { type: "blocks", issue: i("A-5") }, { type: "related", issue: i("A-6") }, { type: "duplicate", issue: i("A-7") },
    ] },
  });
  const ids = (list) => list.map((x) => x.identifier);
  assert.deepEqual(
    { blocks: ids(r.blocks), blockedBy: ids(r.blockedBy), related: ids(r.related), duplicateOf: ids(r.duplicateOf) },
    { blocks: ["A-2"], blockedBy: ["A-5"], related: ["A-3", "A-6"], duplicateOf: ["A-4"] });
});

const issue = { identifier: "WEB-736", title: "Fix webhook signing key rotation", url: "https://linear.app/acme/issue/WEB-736/fix" };

test("ticketLine", () => {
  assert.equal(ticketLine(issue), "Linear WEB-736: Fix webhook signing key rotation https://linear.app/acme/issue/WEB-736/fix");
});
test("commentText", () => {
  assert.equal(
    commentText(issue, { body: "Still fails on retry.", url: "https://linear.app/acme/issue/WEB-736/fix#comment-9f2c", user: { name: "QA" } }),
    "Comment on WEB-736 from QA (https://linear.app/acme/issue/WEB-736/fix#comment-9f2c):\nStill fails on retry.");
});
test("commentText: a comment without a user comes from Integration", () => {
  assert.match(commentText(issue, { body: "b", url: "u", user: null }), /^Comment on WEB-736 from Integration \(u\):/);
});
test("startText", () => {
  assert.equal(startText(issue),
    "Work on Linear issue WEB-736: Fix webhook signing key rotation\n" +
    "https://linear.app/acme/issue/WEB-736/fix\n" +
    "Read the issue and its comments with the Linear MCP before you start.");
});

test("pushRecent: newest first, one entry per ticket, at most max", () => {
  let list = [];
  for (let n = 1; n <= 22; n++) list = pushRecent(list, { identifier: `A-${n}`, title: `t${n}` }, 20);
  list = pushRecent(list, { identifier: "A-10", title: "t10b" }, 20);
  assert.equal(list.length, 20);
  assert.deepEqual(list.slice(0, 3).map((r) => r.identifier), ["A-10", "A-22", "A-21"]);
  assert.deepEqual(list[0], { identifier: "A-10", title: "t10b" });
});

test("isPanelShown: the linear block is the active child of a visible panel", () => {
  const tree = (hidden, active) => ({ id: "root", children: [{ id: "panel", hidden, children: [
    { id: "panel-body", type: "stack", active, children: [{ id: "linear" }, { id: "prs" }] }] }] });
  assert.equal(isPanelShown(tree(false, "linear")), true);
  assert.equal(isPanelShown(tree(true, "linear")), false);
  assert.equal(isPanelShown(tree(false, "prs")), false);
  assert.equal(isPanelShown(null), false);
});

test("targetAgent: the agent in the focused pane", () => {
  const agents = [{ address: "t1", pane: "p1" }, { address: "t2", pane: "p2" }];
  assert.equal(targetAgent(agents, { pane: "p2" })?.address, "t2");
  assert.equal(targetAgent(agents, { pane: "p9" }), null);
  assert.equal(targetAgent(agents, { pane: null }), null);
  assert.equal(targetAgent(agents, null), null);
});

test("relativeTime", () => {
  const now = Date.parse("2026-11-12T12:00:00Z");
  assert.equal(relativeTime("2026-11-12T11:59:30Z", now), "now");
  assert.equal(relativeTime("2026-11-12T11:55:00Z", now), "5m");
  assert.equal(relativeTime("2026-11-12T10:00:00Z", now), "2h");
  assert.equal(relativeTime("2026-11-09T12:00:00Z", now), "3d");
  assert.equal(relativeTime("2026-09-12T12:00:00Z", now), "2mo");
  assert.equal(relativeTime("2024-11-12T12:00:00Z", now), "2y");
  assert.equal(relativeTime(Date.parse("2026-11-12T11:57:00Z"), now), "3m");
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npm test`
Expected: FAIL, "Cannot find module … model.js".

- [ ] **Step 3: Write `mods/linear/model.js`** so every test passes. Behaviour the tests pin down:
  - `parseSearch(input)`: trim. Blank → `empty`. A `linear.app/<org>/issue/<KEY>` URL → `key`. `^[A-Za-z][A-Za-z0-9]{0,9}-\d{1,7}$` → `key`, upper-cased. `^\d{1,7}$` → `number` as a Number. Else `text`.
  - `groupIssues(issues)`: groups by state `id`; groups ordered by type rank `started, unstarted, backlog, triage` (other types after, in that order of first appearance), then state `position`. Rows: priority 1–4 ascending, priority 0 last, then `updatedAt` newest first. Returns `[{ id, name, type, color, issues }]`.
  - `statusOptions(states)`: type rank `triage, backlog, unstarted, started, completed, canceled`, then `position`. Returns a new array.
  - `buildThreads(comments)`: `[{ comment, replies }]`.
  - `relationsOf(issue)`: `{ blocks, blockedBy, related, duplicateOf }`, each a list of issues. Missing `relations` / `inverseRelations` give empty lists.
  - `ticketLine`, `commentText`, `startText`: the exact strings in the tests. `commentText` uses `comment.user?.name ?? "Integration"`.
  - `pushRecent(list, { identifier, title }, max)`: returns a new list.
  - `isPanelShown(root, id = "linear")`: finds nodes `panel` and `panel-body` by `id` through `children`; true when `panel.hidden` is falsy and `panel-body.active === id`.
  - `targetAgent(agents, focused)`: the agent whose `pane` equals `focused.pane`, else `null`.
  - `relativeTime(when, now)`: `when` is an ISO string or epoch ms. Under 60 s `now`, under 60 min `Nm`, under 24 h `Nh`, under 30 d `Nd`, under 365 d `N mo` written `Nmo` (days / 30, floored), else `Ny` (days / 365, floored).

- [ ] **Step 4: Run the tests and see them pass**

Run: `npm test`
Expected: PASS for every test in `tests/model.test.mjs` and `tests/queries.test.mjs`.

- [ ] **Step 5: Commit** — `feat: add pure model functions for the Linear panel`.

---

### Task 5: API client

**Files:**
- Create: `mods/linear/linear.js`
- Test: `tests/linear.test.mjs`

`linear.js` imports nothing. `main.js` later passes Herdr's `fetch`, a Keychain reader and `localStorage`.

- [ ] **Step 1: Write the failing tests**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "../mods/linear/linear.js";

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
function fakeFetch(responses) {
  const calls = [];
  const f = async (url, opts) => {
    calls.push({ url, opts });
    const r = responses.shift();
    if (r instanceof Error) throw r;
    const status = r.status ?? 200;
    return { status, ok: status < 400, url, text: async () => JSON.stringify(r.body), json: async () => r.body };
  };
  f.calls = calls;
  return f;
}
const DOC = "query MyIssues { viewer { id } }";
const client = (fetch, opts = {}) =>
  createClient({ fetch, readKey: opts.readKey ?? (async () => "lin_api_x"), storage: opts.storage ?? memoryStorage(), now: opts.now ?? (() => 1000) });

test("query posts the document with the key, returns data and caches it", async () => {
  const fetch = fakeFetch([{ body: { data: { viewer: { id: "u1" } } } }]);
  const c = client(fetch);
  assert.deepEqual(await c.query(DOC, {}), { data: { viewer: { id: "u1" } }, at: 1000, error: null });
  const { url, opts } = fetch.calls[0];
  assert.equal(url, "https://api.linear.app/graphql");
  assert.equal(opts.method, "POST");
  assert.equal(opts.headers.Authorization, "lin_api_x");
  assert.equal(opts.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(opts.body), { query: DOC, variables: {} });
  assert.deepEqual(c.cached(DOC, {}), { data: { viewer: { id: "u1" } }, at: 1000 });
});

test("a cache younger than ttl answers without the network", async () => {
  let t = 1000;
  const fetch = fakeFetch([{ body: { data: { a: 1 } } }]);
  const c = client(fetch, { now: () => t });
  await c.query(DOC, {}, { ttl: 60_000 });
  t = 30_000;
  const r = await c.query(DOC, {}, { ttl: 60_000 });
  assert.equal(fetch.calls.length, 1);
  assert.deepEqual(r, { data: { a: 1 }, at: 1000, error: null });
});

test("the cache keeps variables apart", async () => {
  const fetch = fakeFetch([{ body: { data: { n: "A" } } }, { body: { data: { n: "B" } } }]);
  const c = client(fetch);
  await c.query(DOC, { id: "A" });
  await c.query(DOC, { id: "B" });
  assert.deepEqual(c.cached(DOC, { id: "A" }).data, { n: "A" });
  assert.deepEqual(c.cached(DOC, { id: "B" }).data, { n: "B" });
  assert.equal(c.cached(DOC, { id: "C" }), null);
});

test("no key gives a nokey error and no request; a later key is picked up", async () => {
  const fetch = fakeFetch([{ body: { data: { a: 1 } } }]);
  let key = null;
  const c = client(fetch, { readKey: async () => key });
  assert.equal((await c.query(DOC, {})).error.kind, "nokey");
  assert.equal(fetch.calls.length, 0);
  key = "k";
  assert.deepEqual((await c.query(DOC, {})).data, { a: 1 });
});

test("the key is read once", async () => {
  let reads = 0;
  const fetch = fakeFetch([{ body: { data: {} } }, { body: { data: {} } }]);
  const c = client(fetch, { readKey: async () => { reads++; return "k"; } });
  await c.query(DOC, { n: 1 });
  await c.query(DOC, { n: 2 });
  assert.equal(reads, 1);
});

test("HTTP 401 is an auth error", async () => {
  const c = client(fakeFetch([{ status: 401, body: { errors: [{ message: "Authentication required" }] } }]));
  assert.equal((await c.query(DOC, {})).error.kind, "auth");
});

test("a GraphQL authentication error is an auth error", async () => {
  const c = client(fakeFetch([{ status: 400, body: { errors: [{ message: "x", extensions: { type: "authentication error" } }] } }]));
  assert.equal((await c.query(DOC, {})).error.kind, "auth");
});

test("a network failure returns the cached data with an offline error", async () => {
  let t = 1000;
  const fetch = fakeFetch([{ body: { data: { a: 1 } } }, new Error("ECONNREFUSED")]);
  const c = client(fetch, { now: () => t });
  await c.query(DOC, {});
  t = 200_000;
  const r = await c.query(DOC, {}, { ttl: 0 });
  assert.deepEqual(r.data, { a: 1 });
  assert.equal(r.at, 1000);
  assert.equal(r.error.kind, "offline");
});

test("HTTP 5xx is offline", async () => {
  const c = client(fakeFetch([{ status: 503, body: {} }]));
  const r = await c.query(DOC, {});
  assert.equal(r.error.kind, "offline");
  assert.equal(r.data, null);
});

test("GraphQL errors give the first message", async () => {
  const c = client(fakeFetch([{ body: { data: null, errors: [{ message: "Entity not found: Issue" }, { message: "second" }] } }]));
  const r = await c.query(DOC, {});
  assert.deepEqual(r.error, { kind: "graphql", message: "Entity not found: Issue" });
});

test("mutate sends the document, never caches, and reports errors the same way", async () => {
  const M = "mutation IssueUpdate($id: String!) { issueUpdate(id: $id, input: {}) { success } }";
  const fetch = fakeFetch([{ body: { data: { issueUpdate: { success: true } } } }, { body: { errors: [{ message: "nope" }] } }]);
  const c = client(fetch);
  assert.deepEqual(await c.mutate(M, { id: "1" }), { data: { issueUpdate: { success: true } }, error: null });
  assert.equal(c.cached(M, { id: "1" }), null);
  assert.deepEqual((await c.mutate(M, { id: "1" })).error, { kind: "graphql", message: "nope" });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npm test`
Expected: FAIL, "Cannot find module … linear.js".

- [ ] **Step 3: Write `mods/linear/linear.js`** so every test passes:
  - `createClient({ fetch, readKey, storage, now })` returns `{ query, mutate, cached }`.
  - `query(doc, vars = {}, { ttl = 0 } = {})` → `{ data, at, error }`. A cache entry younger than `ttl` answers alone. A failed request returns the cached `data` and `at` (or `null`, `null`) with the error.
  - `mutate(doc, vars = {})` → `{ data, error }`.
  - `cached(doc, vars = {})` → `{ data, at }` or `null`.
  - Cache key: `cache:<operation name>:<JSON.stringify(vars)>`. The operation name comes from `/^\s*(query|mutation)\s+(\w+)/`.
  - The key is kept after the first non-empty read. An empty read is not kept.
  - Error kinds: `nokey`; `auth` (HTTP 401, or any error whose `extensions.type` is `"authentication error"` or `extensions.code` is `"AUTHENTICATION_ERROR"`); `offline` (`fetch` throws, or HTTP ≥ 500); `graphql` with `message` (any other `errors` entry, or other HTTP ≥ 400 with `message: "HTTP <status>"`).
  - A storage read or write that throws is ignored: the cache is a convenience.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npm test`
Expected: PASS for all three test files.

- [ ] **Step 5: Commit** — `feat: add the Linear API client with cache and error kinds`.

---

### Task 6: View skeleton and Home screen

**Files:**
- Modify: `mods/linear/main.js` (replace the placeholder)
- Create: `mods/linear/home.js`

Read the spec's **Home** section and the rules at the top of this plan first.

- [ ] **Step 1: Build the View state in `main.js`.** These names are the contract later tasks use:

```js
// Linear: tickets in the side panel. Home lists tickets; a ticket opens in the same panel.
import { View } from "gpui-kit";
import { exec, focused, panes } from "herdr";
import { createClient } from "./linear.js";
import * as Q from "./queries.js";
import { parseSearch, pushRecent } from "./model.js";
import { renderHome } from "./home.js";

const LIST_TTL = 60_000;

// The Linear personal API key from the macOS Keychain, or null when none is stored.
async function readKey() {
  const r = await exec("security", ["find-generic-password", "-s", "herdr-linear", "-w"]);
  return r.code === 0 ? r.stdout.trim() || null : null;
}

export default class Linear extends View {
  init(_props, cx) {
    this.client = createClient({ fetch, readKey, storage: localStorage, now: Date.now });
    this.stack = [{ screen: "home" }];  // also { screen: "project", id, name } and { screen: "ticket", key }
    this.tab = "mine";                  // "mine" | "projects" | "recent"
    this.results = {};                  // screen key → { data, at, error, loading }
    this.search = { input: null, kind: "empty", value: "", notFound: null };
    this.recent = loadRecent();
    this.branch = null;                 // { name, issue } for the focused pane's branch
    // … InputState for search, focus handle …
    this.load(cx);
  }
  top() { return this.stack[this.stack.length - 1]; }
  // Methods later tasks rely on:
  //   key(entry) → string cache slot for a screen entry
  //   load(cx, { force } = {}) → shows the cached copy, then fetches the top screen (ttl LIST_TTL, or 0 when force)
  //   setTab(tab, cx), runSearch(cx), openProject(project, cx), open(identifier, cx), back(cx)
  render(cx) { return this.top().screen === "home" || this.top().screen === "project" ? renderHome(this, cx) : /* Task 7 */ renderHome(this, cx); }
}
```

  `loadRecent()` and the save after `pushRecent` use `localStorage` key `recent` (JSON), wrapped in `try`/`catch`.

- [ ] **Step 2: Data per screen.** `load` picks the document: `mine` → `Q.MY_ISSUES` (`data.viewer.assignedIssues.nodes`); `projects` → `Q.PROJECTS`; `recent` → no request; project entry → `Q.PROJECT_ISSUES` with `{ id }`; search `number` → `Q.BY_NUMBER` with `{ number }`; search `text` → `Q.SEARCH` with `{ term }`. Store each result under its screen key and `cx.notify()`.

- [ ] **Step 3: Search.** On Enter in the search `Input`: `parseSearch`. `key` → `open(value)` (Task 7 fills `open`; for now it pushes `{ screen: "ticket", key }` and records it in Recent). `number` and `text` → list results below the search row, in place of the tab list, until the input is cleared. `empty` → back to the tab list.

- [ ] **Step 4: Branch row.** In `render`, read the focused pane's branch: `panes().find((p) => p.id === focused()?.pane)?.branch`. When it differs from `this.branch?.name`, start one `cx.spawn` that runs `Q.BRANCH` with `{ branch }` (ttl `LIST_TTL`) and stores `{ name, issue }`. Show the row only when `issue` is non-null: `This branch → <identifier> <title>`. Clicking it calls `open`.

- [ ] **Step 5: `home.js`.** Export `renderHome(view, cx)`. Layout from the spec mockup, top to bottom: search row (`Input`, ↻ button calling `view.load(cx, { force: true })`); tab row (`My issues`, `Projects`, `Recent`; hidden on a project screen, which shows `← <project name>` instead); branch row; the body. Body: groups from `groupIssues` with a header `<state name> <count>` and rows `<identifier> <title> <priorityLabel>` (identifier in `t.muted`, title truncated, row hover `t.hover`); project rows `<name>`; Recent rows `<identifier> <title>`. The list scrolls (`overflow_y_scrollbar`). Use a state-color dot from `state.color` before each row.

- [ ] **Step 6: Setup and error cards** (they show on any screen, so put them in `home.js` as an exported `renderProblem(view, cx, error)` that `ticket.js` reuses):
  - `nokey`: "Add your Linear API key", the command `security add-generic-password -U -s herdr-linear -a "$USER" -w` in a selectable monospace block, a link "Create a key" opening `https://linear.app/settings/account/security` with `exec("open", [url])`, and a "Check again" button calling `view.load(cx, { force: true })`.
  - `auth`: "Linear rejected the key" above the same card.
  - `graphql`: the message, in place of the body.
  - `offline` with data: a slim bar above the body, `Offline · data from <relativeTime(at, Date.now())> ago`. Without data: the bar alone.
  - Loading with no cached data: one line with a `.frames(["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"], 80)` spinner.

- [ ] **Step 7: Check**

Run: `npm test && npm run check`
Expected: tests pass; `herdr-app check` exits 0 (with no key stored it renders the setup card).

- [ ] **Step 8: Commit** — `feat: add the Home screen with search, tabs and branch row`.

---

### Task 7: Ticket screen (read)

**Files:**
- Create: `mods/linear/ticket.js`
- Modify: `mods/linear/main.js` (`open`, `back`, ticket loading, render dispatch)

Read the spec's **Ticket** section first.

- [ ] **Step 1: `open(identifier, cx)` and `back(cx)`.** From a list row: push `{ screen: "ticket", key: identifier }`, record it in Recent with its title, then `load`. From search (`kind: "key"`): run `Q.TICKET` with `{ id: identifier }` first; when `data.issue` is null or the error message contains "not found", set `this.search.notFound = identifier` (the search row shows `<KEY> not found`) and push nothing. `back` pops unless only Home is left.

- [ ] **Step 2: Ticket data.** `load` for a ticket entry runs `Q.TICKET` with `{ id: key }` (ttl `LIST_TTL`). Keep `data.viewer.id` on the view as `this.viewerId`. Update the Recent entry's title from the result.

- [ ] **Step 3: `ticket.js`.** Export `renderTicket(view, cx)`. Top to bottom, scrolling as one column, leaving out empty parts:
  - Bar: `←` (back), the identifier, ↻ (`load` force), ↗ (`exec("open", [issue.url])`).
  - Header: status (name with its color dot), priority label, assignee name or "Unassigned"; the title (`font_semibold`, wraps); labels, project name, `Cycle <number>` or cycle name, due date, estimate, joined with ` · `; `Parent <identifier> <title>` (click: `open`).
  - Action row placeholder: an empty `h_flex` with id `ticket-actions` (Tasks 8 and 9 fill it).
  - Description: `TextView.markdown("desc-<identifier>", description)`.
  - `Sub-issues <done>/<total>` (done = state type `completed`), each row clickable with its state.
  - `Links`: each attachment `title` (and `subtitle`), click: `exec("open", [url])`.
  - Relations from `relationsOf`: headings `Blocks`, `Blocked by`, `Related`, `Duplicate of`; rows clickable.
  - `Comments <count>`: `buildThreads`; each comment shows `user?.name ?? "Integration"` · `relativeTime(createdAt, Date.now())`, then `TextView.markdown("c-<id>", body)`; replies indented under their thread.
- [ ] **Step 4: Render dispatch.** `render` calls `renderTicket` for a ticket entry and `renderProblem` when its result has an error and no data.

- [ ] **Step 5: Check**

Run: `npm test && npm run check`
Expected: both pass.

- [ ] **Step 6: Commit** — `feat: add the Ticket screen`.

---

### Task 8: Ticket actions

**Files:**
- Modify: `mods/linear/ticket.js`, `mods/linear/main.js`

Read the spec's **Ticket actions** table first. Find `Popover` in `~/.config/herdr-app/gpui-kit.d.ts` (`grep -n "export const Popover"`, then read its doc comment) for the two menus, and the `Textarea` usage in `~/.config/herdr-app/mods/pr-flow/main.js` for the comment box.

- [ ] **Step 1: A mutation helper in `main.js`.**

```js
  // Runs a Linear mutation; on success reloads the open ticket, on failure shows Linear's message.
  mutate(doc, vars, cx, onDone) {
    cx.spawn(async (cx) => {
      const r = await this.client.mutate(doc, vars);
      if (r.error) notify({ title: "Linear", body: r.error.message ?? r.error.kind, level: "error" });
      else { onDone?.(); this.load(cx, { force: true }); }
      cx.notify();
    });
  }
```

- [ ] **Step 2: Status menu.** The status name in the header becomes a `Popover` trigger. Its items are `statusOptions(issue.team.states.nodes)`, the current one marked. Picking one: `view.mutate(Q.ISSUE_UPDATE, { id: issue.id, input: { stateId } }, cx)`.

- [ ] **Step 3: Assignee menu.** The assignee becomes a `Popover` trigger with one item: "Assign to me" (`assigneeId: view.viewerId`), or "Unassign" (`assigneeId: null`) when `issue.assignee?.id === view.viewerId`.

- [ ] **Step 4: Comment box and Reply.** Below the comments, a `Textarea` with placeholder `Comment…`. ⌘Enter sends `Q.COMMENT_CREATE` with `{ input: { issueId: issue.id, body } }`; a `Reply` button on each thread moves the box under that thread and adds `parentId: thread.comment.id`, with a small "Replying to <name> ×" line that cancels. The draft text is kept per ticket on the view and cleared only in `onDone`. A blank draft sends nothing.

- [ ] **Step 5: Copy menu and the action row.** In `ticket-actions`, add `Copy ▾` (a `Popover` with `ID`, `Branch name`, `Link`). Each item: `cx.write_to_clipboard(text)`, then `notify({ title: "Copied", body: text, timeout: 2000 })`.

- [ ] **Step 6: Check**

Run: `npm test && npm run check`
Expected: both pass.

- [ ] **Step 7: Commit** — `feat: add status, assignee, comment and copy actions`.

---

### Task 9: Agent bridge

**Files:**
- Modify: `mods/linear/ticket.js`, `mods/linear/main.js`

Read the spec's **Agent bridge** section first.

- [ ] **Step 1: Methods in `main.js`.**

```js
  // The agent in the focused pane, or null.
  agent() { return targetAgent(agents(), focused()); }

  // Pastes text into the focused agent and presses Enter.
  sendToAgent(text, cx) {
    const agent = this.agent();
    if (!agent) return;
    cx.spawn(async () => {
      const r = await hc(["send", agent.address, text]);
      notify(r.code === 0
        ? { title: "Sent to agent", body: agent.title, timeout: 2000 }
        : { title: "Couldn't send", body: (r.stderr || r.stdout).trim(), level: "error" });
    });
  }

  // Opens a new tab in the focused space with Claude Code working on the ticket.
  startAgent(issue) {
    run("tab.new", { space: focused()?.space, name: issue.identifier, argv: ["claude"], task: startText(issue) });
  }
```

- [ ] **Step 2: Buttons.** In `ticket-actions`, before `Copy ▾`: `Start agent` (`startAgent`) and `Send to agent` (`sendToAgent(ticketLine(issue), cx)`). On each comment, a `Send` button (`sendToAgent(commentText(issue, comment), cx)`). When `view.agent()` is null, both send controls are dimmed, do nothing on click, and show the tooltip "Focus an agent's pane first." (grep `tooltip` in `gpui-kit.d.ts` for the builder).

- [ ] **Step 3: Check**

Run: `npm test && npm run check`
Expected: both pass.

- [ ] **Step 4: Commit** — `feat: send tickets and comments to agents`.

---

### Task 10: Refresh while shown, README

**Files:**
- Modify: `mods/linear/main.js`
- Create: `README.md`

- [ ] **Step 1: Refresh.** In `init`: `cx.timer.every(60_000, (cx) => { if (isPanelShown(layout())) this.load(cx); })`. In `render`, keep `this.shown = isPanelShown(layout())`; when it turns true from false, start `this.load(cx)` in a `cx.spawn`. A hidden panel makes no requests.

- [ ] **Step 2: `README.md`.** Sections: what it is (two sentences), install (`npm install`, `npm run install:local`), the Keychain command with "Create a key" at `https://linear.app/settings/account/security`, adding the panel (the `panel-body` block JSON from Task 2 and the button line), and the screens in one short list. Follow the person's writing rules: describe the thing as it stands, short sentences, no history.

- [ ] **Step 3: Check**

Run: `npm test && npm run check && npm run install:local`
Expected: all three pass.

- [ ] **Step 4: Commit** — `feat: refresh while the panel is shown; add README`.

---

### Task 11: Visual check (controller)

- [ ] With the person's go-ahead and their key stored: show the panel, open Home, a project, a search, a ticket with comments and relations; take `herdr-app shot` of each and read the images. Fix what looks wrong through a subagent, then report.
