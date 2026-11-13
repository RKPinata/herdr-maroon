# Filer Pro Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add VS Code-style quick open (`cmd-k`), reveal in tree, a find row (`cmd-f`) and a go-to row to the `my-filer-pro` Herdr mod, plus a pane-menu entry in `my-menu`.

**Architecture:** A root's file list is written once to a file on its machine; each query filters it natively with `fzf` (or `grep`) and only the top 200 hits are ranked in JavaScript with a port of VS Code's scorer, because mods run in QuickJS (no JIT, about 0.5 s per job). The popup is a copy of `my-filer-pro` opened with `mod.open`; it hands picks to the panel through a shared key. Pure logic lives in `lib/` with `node` assert tests; UI lives in `ui/` and `main.js` and is checked with `herdr-app check` and in the running app.

**Tech Stack:** gpui-kit JavaScript on QuickJS (Herdr mods), `sh`, `rg`/`git`/`find`, `fzf`/`grep`, Node 24 for tests.

**Spec:** `docs/superpowers/specs/2026-11-13-filer-pro-search-design.md`

---

## Working rules

- Repository: `/Users/danish/Repo/herdr-maroon`, branch `main`. Commit after each task.
- Mod source: `mods/my-filer-pro/` and `mods/my-menu/`. The running app loads `~/.config/herdr-app/mods/<name>/` and reloads on save. To try a change live:
  ```bash
  rsync -a /Users/danish/Repo/herdr-maroon/mods/my-filer-pro/ ~/.config/herdr-app/mods/my-filer-pro/
  rsync -a /Users/danish/Repo/herdr-maroon/mods/my-menu/ ~/.config/herdr-app/mods/my-menu/
  herdr-app check ~/.config/herdr-app/mods/my-filer-pro
  ```
  Expected: `check passed: …`. A broken save keeps the old build running; `herdr-app status` shows why.
- Tests run from the mod folder: `cd /Users/danish/Repo/herdr-maroon/mods/my-filer-pro && for f in test/*.test.mjs; do node "$f" || exit 1; done`. Node prints a module-type warning for `.js` files; ignore it.
- QuickJS limits: never loop over a whole file list in JavaScript; never keep a `cx` for later; create `InputState`, `ScrollHandle` and focus handles in `init`, not in `render`; `cx.notify()` throws inside `render`, so state changes from `render` go through `cx.spawn`.
- Match the comment style of the file you edit. Comments say what an expression produces or which outside condition it handles.

## File map

| File | Status | Responsibility |
|---|---|---|
| `mods/my-filer-pro/lib/fuzzy.js` | new | VS Code quick-open scorer (port) |
| `mods/my-filer-pro/lib/finder.js` | new | list file per root, native filter, ranking, recent list, `stepRow` |
| `mods/my-filer-pro/lib/treefind.js` | new | find-row matching, parent folders, go-to path |
| `mods/my-filer-pro/lib/panels.js` | modify | add `showSteps` |
| `mods/my-filer-pro/ui/quickopen.js` | new | popup state and view |
| `mods/my-filer-pro/ui/treerow.js` | new | find row and go-to row views |
| `mods/my-filer-pro/main.js` | modify | popup copy, pick handoff, reveal, rows, header |
| `mods/my-filer-pro/mod.json` | modify | popup placement for `mod.open` |
| `mods/my-filer-pro/{search,chevron-up,x,folder-input}.svg` | new | Lucide icons |
| `mods/my-filer-pro/test/*.test.mjs` | new | node assert tests |
| `mods/my-filer-pro/THIRD_PARTY_NOTICES.md` | modify | VS Code (MIT) entry |
| `mods/my-menu/main.js` | modify | "Go to Folder in Files…" |
| `README.md` | modify | key binding and `fzf` |

---

### Task 1: VS Code scorer port (`lib/fuzzy.js`)

**Files:**
- Create: `mods/my-filer-pro/test/fuzzy.test.mjs`
- Create: `mods/my-filer-pro/lib/fuzzy.js`
- Modify: `mods/my-filer-pro/THIRD_PARTY_NOTICES.md` (append section 9)

- [ ] **Step 1: Write the failing test**

Create `mods/my-filer-pro/test/fuzzy.test.mjs`:

```js
// node test/fuzzy.test.mjs
import assert from "node:assert/strict";
import { prepareQuery, scoreItem, compareItems, scoreFuzzy } from "../lib/fuzzy.js";

const item = (path) => {
  const i = path.lastIndexOf("/");
  return { path, label: path.slice(i + 1), description: i < 0 ? "" : path.slice(0, i) };
};
const rank = (paths, q) => {
  const query = prepareQuery(q);
  return paths.map(item).map((it) => ({ ...it, score: scoreItem(it.label, it.description, it.path, query) }))
    .filter((it) => it.score.score > 0).sort((a, b) => compareItems(a, b, query)).map((it) => it.path);
};

// Characters must appear in order.
assert.equal(scoreFuzzy("main.js", "mj", "mj", true)[0] > 0, true);
assert.equal(scoreFuzzy("main.js", "jm", "jm", true)[0], 0);
assert.deepEqual(scoreFuzzy("main.js", "mj", "mj", true)[1], [0, 5]);

// A file-name prefix beats a match spread over the path.
assert.deepEqual(rank(["src/vue/index.js", "app/index.vue", "lib/vuex.js"], "vue"), ["lib/vuex.js", "app/index.vue", "src/vue/index.js"]);

// Shorter names win between equal prefix matches.
assert.deepEqual(rank(["src/Vuetify.js", "src/Vue.js"], "vue"), ["src/Vue.js", "src/Vuetify.js"]);

// A query with "/" matches through the folder.
assert.deepEqual(rank(["src/msg/index.vue", "src/other/index.vue", "msgindex.md"], "msg/index"), ["src/msg/index.vue"]);

// Every space-separated word must match; highlights land in label and folder.
const query = prepareQuery("lib fin");
const s = scoreItem("finder.js", "lib", "lib/finder.js", query);
assert.ok(s.score > 0);
assert.deepEqual(s.labelMatch, [[0, 3]]);
assert.equal(scoreItem("main.js", "src", "src/main.js", query).score, 0);

// The exact relative path ranks first.
assert.deepEqual(rank(["a/b.js", "x/a/b.js"], "a/b.js")[0], "a/b.js");

// Highlight ranges on the label for a plain query.
assert.deepEqual(scoreItem("index.vue", "app", "app/index.vue", prepareQuery("vue")).labelMatch, [[6, 9]]);

console.log("fuzzy ok");
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd /Users/danish/Repo/herdr-maroon/mods/my-filer-pro && node test/fuzzy.test.mjs`
Expected: FAIL with `Cannot find module '…/lib/fuzzy.js'`.

- [ ] **Step 3: Write the implementation**

Create `mods/my-filer-pro/lib/fuzzy.js`:

```js
// File-name ranking of VS Code's quick open, ported from src/vs/base/common/fuzzyScorer.ts (MIT, Microsoft,
// commit f6c56f75d0f9ff0774c14303046f43acfde240f3): prepareQuery, scoreFuzzy, item scoring over a label (the file
// name) and a description (its folder), and compareItemsByFuzzyScore. Paths use "/". Matches are [start, end) pairs. Pure.

const NO_MATCH = 0;
const PATH_IDENTITY_SCORE = 1 << 18;
const LABEL_PREFIX_SCORE_THRESHOLD = 1 << 17;
const LABEL_SCORE_THRESHOLD = 1 << 16;
const NO_ITEM_SCORE = Object.freeze({ score: 0, labelMatch: [], descriptionMatch: [] });

// [score, positions]: positions are the target indexes the query characters matched, in order.
export function scoreFuzzy(target, query, queryLower, allowNonContiguousMatches) {
  if (!target || !query) return [NO_MATCH, []];
  const targetLength = target.length, queryLength = query.length;
  if (targetLength < queryLength) return [NO_MATCH, []];
  return doScoreFuzzy(query, queryLower, queryLength, target, target.toLowerCase(), targetLength, allowNonContiguousMatches);
}

function doScoreFuzzy(query, queryLower, queryLength, target, targetLower, targetLength, allowNonContiguousMatches) {
  const scores = new Int32Array(queryLength * targetLength);
  const matches = new Int32Array(queryLength * targetLength);
  for (let queryIndex = 0; queryIndex < queryLength; queryIndex++) {
    const queryIndexOffset = queryIndex * targetLength;
    const queryIndexPreviousOffset = queryIndexOffset - targetLength;
    const queryIndexGtNull = queryIndex > 0;
    const queryCharAtIndex = query[queryIndex];
    const queryLowerCharAtIndex = queryLower[queryIndex];
    for (let targetIndex = 0; targetIndex < targetLength; targetIndex++) {
      const targetIndexGtNull = targetIndex > 0;
      const currentIndex = queryIndexOffset + targetIndex;
      const leftIndex = currentIndex - 1;
      const diagIndex = queryIndexPreviousOffset + targetIndex - 1;
      const leftScore = targetIndexGtNull ? scores[leftIndex] : 0;
      const diagScore = queryIndexGtNull && targetIndexGtNull ? scores[diagIndex] : 0;
      const matchesSequenceLength = queryIndexGtNull && targetIndexGtNull ? matches[diagIndex] : 0;
      const score = !diagScore && queryIndexGtNull ? 0
        : computeCharScore(queryCharAtIndex, queryLowerCharAtIndex, target, targetLower, targetIndex, matchesSequenceLength);
      const isValidScore = score && diagScore + score >= leftScore;
      if (isValidScore && (allowNonContiguousMatches || queryIndexGtNull || targetLower.startsWith(queryLower, targetIndex))) {
        matches[currentIndex] = matchesSequenceLength + 1;
        scores[currentIndex] = diagScore + score;
      } else {
        matches[currentIndex] = NO_MATCH;
        scores[currentIndex] = leftScore;
      }
    }
  }
  const positions = [];
  let queryIndex = queryLength - 1, targetIndex = targetLength - 1;
  while (queryIndex >= 0 && targetIndex >= 0) {
    if (matches[queryIndex * targetLength + targetIndex] === NO_MATCH) targetIndex--;
    else { positions.push(targetIndex); queryIndex--; targetIndex--; }
  }
  return [scores[queryLength * targetLength - 1], positions.reverse()];
}

function computeCharScore(queryCharAtIndex, queryLowerCharAtIndex, target, targetLower, targetIndex, matchesSequenceLength) {
  if (!considerAsEqual(queryLowerCharAtIndex, targetLower[targetIndex])) return 0;
  let score = 1;
  if (matchesSequenceLength > 0) score += Math.min(matchesSequenceLength, 3) * 6 + Math.max(0, matchesSequenceLength - 3) * 3;
  if (queryCharAtIndex === target[targetIndex]) score += 1;
  if (targetIndex === 0) score += 8;
  else {
    const separatorBonus = scoreSeparatorAtPos(target.charCodeAt(targetIndex - 1));
    if (separatorBonus) score += separatorBonus;
    else if (isUpper(target.charCodeAt(targetIndex)) && matchesSequenceLength === 0) score += 2;
  }
  return score;
}

function considerAsEqual(a, b) {
  if (a === b) return true;
  if (a === "/" || a === "\\") return b === "/" || b === "\\";
  return false;
}

const isUpper = (code) => code >= 65 && code <= 90;

function scoreSeparatorAtPos(code) {
  if (code === 47 || code === 92) return 5; // / \
  if (code === 95 || code === 45 || code === 46 || code === 32 || code === 39 || code === 34 || code === 58) return 4; // _ - . space ' " :
  return 0;
}

// filters.ts matchesPrefix, ignoring case.
function matchesPrefix(word, target) {
  if (!target || target.length < word.length) return null;
  return target.toLowerCase().startsWith(word.toLowerCase()) ? [[0, word.length]] : null;
}

function createMatches(offsets) {
  const ret = [];
  let last = null;
  for (const pos of offsets ?? []) {
    if (last && last[1] === pos) last[1] += 1;
    else { last = [pos, pos + 1]; ret.push(last); }
  }
  return ret;
}

function normalizeMatches(matches) {
  const out = [];
  let current = null;
  for (const m of [...matches].sort((a, b) => a[0] - b[0])) {
    if (!current || current[1] < m[0] || m[1] < current[0]) { current = [m[0], m[1]]; out.push(current); }
    else { current[0] = Math.min(current[0], m[0]); current[1] = Math.max(current[1], m[1]); }
  }
  return out;
}

const queryExpectsExactMatch = (q) => q.startsWith('"') && q.endsWith('"');

function normalizeQuery(original) {
  const pathNormalized = original.replace(/\\/g, "/");
  const normalized = pathNormalized.replace(/[*…\s"]/g, "").replace(/(?<=.)#$/, "");
  return { pathNormalized, normalized, normalizedLowercase: normalized.toLowerCase() };
}

// The query as the scorer uses it; words split on spaces become `values`, and every word must match.
export function prepareQuery(original) {
  if (typeof original !== "string") original = "";
  const { pathNormalized, normalized, normalizedLowercase } = normalizeQuery(original);
  let values;
  const split = original.split(" ");
  if (split.length > 1) {
    for (const piece of split) {
      const n = normalizeQuery(piece);
      if (n.normalized) (values ??= []).push({ original: piece, ...n, expectContiguousMatch: queryExpectsExactMatch(piece) });
    }
  }
  return { original, pathNormalized, normalized, normalizedLowercase, values, containsPathSeparator: pathNormalized.includes("/"), expectContiguousMatch: queryExpectsExactMatch(original) };
}

// { score, labelMatch, descriptionMatch }: label is the file name, description its folder, path the whole relative
// path. score 0 means no match. A query with "/" is matched against folder/name instead of the name first.
export function scoreItem(label, description, path, query) {
  if (!query.normalized) return NO_ITEM_SCORE;
  const preferLabelMatches = !path || !query.containsPathSeparator;
  if (path && query.pathNormalized.toLowerCase() === path.toLowerCase()) {
    return { score: PATH_IDENTITY_SCORE, labelMatch: [[0, label.length]], descriptionMatch: description ? [[0, description.length]] : [] };
  }
  if (query.values && query.values.length > 1) {
    let total = 0;
    const labelMatches = [], descriptionMatches = [];
    for (const piece of query.values) {
      const s = scoreSingle(label, description, path, piece, preferLabelMatches);
      if (s.score === NO_MATCH) return NO_ITEM_SCORE;
      total += s.score;
      labelMatches.push(...s.labelMatch);
      descriptionMatches.push(...s.descriptionMatch);
    }
    return { score: total, labelMatch: normalizeMatches(labelMatches), descriptionMatch: normalizeMatches(descriptionMatches) };
  }
  return scoreSingle(label, description, path, query, preferLabelMatches);
}

function scoreSingle(label, description, path, query, preferLabelMatches) {
  const allowNonContiguous = !query.expectContiguousMatch;
  if (preferLabelMatches || !description) {
    const [labelScore, labelPositions] = scoreFuzzy(label, query.normalized, query.normalizedLowercase, allowNonContiguous);
    if (labelScore) {
      const prefix = matchesPrefix(query.normalized, label);
      const base = prefix ? LABEL_PREFIX_SCORE_THRESHOLD + Math.round((query.normalized.length / label.length) * 100) : LABEL_SCORE_THRESHOLD;
      return { score: base + labelScore, labelMatch: prefix ?? createMatches(labelPositions), descriptionMatch: [] };
    }
  }
  if (description) {
    const descriptionPrefix = path ? `${description}/` : description;
    const prefixLength = descriptionPrefix.length;
    const [score, positions] = scoreFuzzy(`${descriptionPrefix}${label}`, query.normalized, query.normalizedLowercase, allowNonContiguous);
    if (score) {
      const labelMatch = [], descriptionMatch = [];
      for (const [start, end] of createMatches(positions)) {
        if (start < prefixLength && end > prefixLength) { labelMatch.push([0, end - prefixLength]); descriptionMatch.push([start, prefixLength]); }
        else if (start >= prefixLength) labelMatch.push([start - prefixLength, end - prefixLength]);
        else descriptionMatch.push([start, end]);
      }
      return { score, labelMatch, descriptionMatch };
    }
  }
  return NO_ITEM_SCORE;
}

// Sort order of two scored items { label, description, path, score: scoreItem(...) }: negative puts a first.
export function compareItems(a, b, query) {
  const sa = a.score, sb = b.score, scoreA = sa.score, scoreB = sb.score;
  if ((scoreA === PATH_IDENTITY_SCORE || scoreB === PATH_IDENTITY_SCORE) && scoreA !== scoreB) return scoreA === PATH_IDENTITY_SCORE ? -1 : 1;
  if (scoreA > LABEL_SCORE_THRESHOLD || scoreB > LABEL_SCORE_THRESHOLD) {
    if (scoreA !== scoreB) return scoreA > scoreB ? -1 : 1;
    if (scoreA < LABEL_PREFIX_SCORE_THRESHOLD && scoreB < LABEL_PREFIX_SCORE_THRESHOLD) {
      const byLength = compareByMatchLength(sa.labelMatch, sb.labelMatch);
      if (byLength !== 0) return byLength;
    }
    if (a.label.length !== b.label.length) return a.label.length - b.label.length;
  }
  if (scoreA !== scoreB) return scoreA > scoreB ? -1 : 1;
  const aLabel = sa.labelMatch.length > 0, bLabel = sb.labelMatch.length > 0;
  if (aLabel !== bLabel) return aLabel ? -1 : 1;
  const da = matchDistance(a), db = matchDistance(b);
  if (da && db && da !== db) return db > da ? -1 : 1;
  return fallbackCompare(a, b, query);
}

function matchDistance(item) {
  const { labelMatch, descriptionMatch } = item.score;
  let start = -1, end = -1;
  if (descriptionMatch.length) start = descriptionMatch[0][0];
  else if (labelMatch.length) start = labelMatch[0][0];
  if (labelMatch.length) {
    end = labelMatch[labelMatch.length - 1][1];
    if (descriptionMatch.length && item.description) end += item.description.length;
  } else if (descriptionMatch.length) end = descriptionMatch[descriptionMatch.length - 1][1];
  return end - start;
}

function compareByMatchLength(a, b) {
  if (!a.length && !b.length) return 0;
  if (!b.length) return -1;
  if (!a.length) return 1;
  const la = a[a.length - 1][1] - a[0][0], lb = b[b.length - 1][1] - b[0][0];
  return la === lb ? 0 : lb < la ? 1 : -1;
}

function fallbackCompare(a, b, query) {
  const la = a.label.length + (a.description?.length ?? 0), lb = b.label.length + (b.description?.length ?? 0);
  if (la !== lb) return la - lb;
  if (a.path.length !== b.path.length) return a.path.length - b.path.length;
  if (a.label !== b.label) return compareAnything(a.label, b.label, query.normalized);
  if (a.description !== b.description) return compareAnything(a.description ?? "", b.description ?? "", query.normalized);
  return compareAnything(a.path, b.path, query.normalized);
}

// comparers.ts compareAnything without its file-name collation: prefix matches first (shorter first), then suffix
// matches, then plain order.
function compareAnything(a, b, lookFor) {
  const al = a.toLowerCase(), bl = b.toLowerCase(), q = lookFor.toLowerCase();
  const ap = al.startsWith(q), bp = bl.startsWith(q);
  if (ap !== bp) return ap ? -1 : 1;
  if (ap && al.length !== bl.length) return al.length - bl.length;
  const as = al.endsWith(q), bs = bl.endsWith(q);
  if (as !== bs) return as ? -1 : 1;
  return al < bl ? -1 : al > bl ? 1 : 0;
}
```

- [ ] **Step 4: Run the test**

Run: `node test/fuzzy.test.mjs`
Expected: `fuzzy ok`.

- [ ] **Step 5: Add the license notice**

Append to `mods/my-filer-pro/THIRD_PARTY_NOTICES.md` (after section 8, at the end of the file):

````markdown

## 9. Visual Studio Code (MIT)

Source: https://github.com/microsoft/vscode, `src/vs/base/common/fuzzyScorer.ts` at commit f6c56f75d0f9ff0774c14303046f43acfde240f3.
Adopted and adapted: the quick-open scorer and its sort order (`mods/my-filer-pro/lib/fuzzy.js`).

```
MIT License

Copyright (c) 2015 - present Microsoft Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
````

- [ ] **Step 6: Commit**

```bash
cd /Users/danish/Repo/herdr-maroon
git add mods/my-filer-pro/lib/fuzzy.js mods/my-filer-pro/test/fuzzy.test.mjs mods/my-filer-pro/THIRD_PARTY_NOTICES.md
git commit -m "Port VS Code's quick-open scorer to Filer Pro"
```

---

### Task 2: File list, native filter and ranking (`lib/finder.js`)

**Files:**
- Create: `mods/my-filer-pro/test/finder.test.mjs`
- Create: `mods/my-filer-pro/lib/finder.js`

- [ ] **Step 1: Write the failing test**

Create `mods/my-filer-pro/test/finder.test.mjs`. It runs both shell scripts on a temporary folder, so `rg` or `git` or `find`, and `fzf` or `grep`, must be on `PATH` (they are on this Mac).

```js
// node test/finder.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseQuery, fzfQuery, grepPattern, rankPaths, addRecent, recentUnder, listName, createFinder, FILES_SCRIPT, SEARCH_SCRIPT } from "../lib/finder.js";

// Line suffix.
assert.deepEqual(parseQuery("main.js:120"), { text: "main.js", line: 120, column: null });
assert.deepEqual(parseQuery("main.js:120:5"), { text: "main.js", line: 120, column: 5 });
assert.deepEqual(parseQuery("a:b"), { text: "a:b", line: null, column: null });

// Queries for the native filter.
assert.equal(fzfQuery(" 'foo  ^bar$ "), "foo bar");
assert.equal(grepPattern("ab c.d"), "c.*\\..*d"); // the longest word
assert.equal(grepPattern("lib finder"), "f.*i.*n.*d.*e.*r");
assert.equal(grepPattern("a.b"), "a.*\\..*b");

// Ranking, groups, hidden files.
const hideNone = { hide_system_files: false, hide_dotfiles: false };
const paths = ["src/msg/index.vue", "src/main.js", "lib/finder.js", "README.md", "app/vue-legacy.md", "src/.DS_Store"];
const r1 = rankPaths(paths, "vue", { recent: ["app/vue-legacy.md"], hide: hideNone });
assert.deepEqual(r1.recent.map((i) => i.path), ["app/vue-legacy.md"]);
assert.deepEqual(r1.files.map((i) => i.path), ["src/msg/index.vue"]);
assert.deepEqual(r1.files[0].labelHits, [[6, 9]]);
assert.equal(rankPaths(paths, "main.js:40", {}).line, 40);
assert.equal(rankPaths(paths, "main.js:40", {}).files[0].path, "src/main.js");
assert.deepEqual(rankPaths(paths, "ds_store", { hide: { hide_system_files: true } }).files.map((i) => i.path), []);
assert.deepEqual(rankPaths(paths, "", { recent: ["README.md"] }).recent.map((i) => i.path), ["README.md"]);
assert.deepEqual(rankPaths(paths, "msg/index", {}).files.map((i) => i.path), ["src/msg/index.vue"]);

// Recent list.
let doc = addRecent(null, { on: null, path: "/r/a.js", at: 1 });
doc = addRecent(doc, { on: null, path: "/r/b.js", at: 2 });
doc = addRecent(doc, { on: null, path: "/r/a.js", at: 3 });
doc = addRecent(doc, { on: "vps", path: "/r/c.js", at: 4 });
assert.deepEqual(recentUnder(doc, null, "/r"), ["a.js", "b.js"]);
assert.deepEqual(recentUnder(doc, "vps", "/r/"), ["c.js"]);
assert.deepEqual(recentUnder(doc, null, "/other"), []);
assert.match(listName(null, "/r"), /^[0-9a-f]{8}$/);
assert.notEqual(listName(null, "/r"), listName("vps", "/r"));

// The scripts on a real folder: dot files follow <dots>, node_modules is skipped, search finds by fuzzy name.
const dir = mkdtempSync(join(tmpdir(), "finder-"));
mkdirSync(join(dir, "src/msg"), { recursive: true });
mkdirSync(join(dir, "node_modules/x"), { recursive: true });
for (const f of ["src/msg/index.vue", "src/main.js", ".env", "node_modules/x/y.js"]) writeFileSync(join(dir, f), "");
const out = join(mkdtempSync(join(tmpdir(), "finder-lists-")), "sub/a.txt");
const sh = (script, ...args) => execFileSync("sh", ["-c", script, "x", ...args]).toString();
assert.match(sh(FILES_SCRIPT, dir, "1", out), /^\s*3 /);
assert.deepEqual(readFileSync(out, "utf8").trim().split("\n").sort(), [".env", "src/main.js", "src/msg/index.vue"]);
sh(FILES_SCRIPT, dir, "0", out);
assert.deepEqual(readFileSync(out, "utf8").trim().split("\n").sort(), ["src/main.js", "src/msg/index.vue"]);
assert.deepEqual(sh(SEARCH_SCRIPT, out, "msgidx", "200", grepPattern("msgidx")).trim().split("\n"), ["src/msg/index.vue"]);

// createFinder: one listing per root, stale after invalidate, errors kept, recent written.
let calls = 0, t = 0, file = null;
const finder = createFinder({
  exec: async (_cmd, args) => {
    if (args[2] === "search") return { code: 0, stdout: "src/b.js\na.js\n", stderr: "" };
    calls++;
    return args[3] === "/missing" ? { code: 2, stdout: "", stderr: "" } : { code: 0, stdout: "2 9\n", stderr: "" };
  },
  readTextFile: async () => file,
  writeTextFile: async (_p, text, expected) => { if (expected !== file) throw new Error("stale"); file = text; },
  recentPath: "/x/recent.json", localDir: "/x/finder", now: () => t,
});
const e1 = finder.files({ root: "/r", on: null, hide: hideNone });
await e1.ready;
assert.equal(e1.state, "ready");
assert.equal(e1.count, 2);
assert.equal(e1.file, `/x/finder/${listName(null, "/r")}.txt`);
finder.files({ root: "/r", on: null, hide: hideNone });
assert.equal(calls, 1);
finder.invalidate({ root: "/r", on: null });
await finder.files({ root: "/r", on: null, hide: hideNone }).ready;
assert.equal(calls, 2);
assert.deepEqual((await finder.search(e1, "a", { hide: hideNone })).files.map((i) => i.path), ["a.js"]);
const bad = finder.files({ root: "/missing", on: null, hide: hideNone });
await bad.ready;
assert.equal(bad.state, "error");
assert.equal(bad.error, "Cannot open /missing");
await finder.recordOpen({ on: null, path: "/r/a.js" });
await finder.recordOpen({ on: null, path: "/r/b.js" });
assert.deepEqual(recentUnder(JSON.parse(file), null, "/r"), ["b.js", "a.js"]);

console.log("finder ok");

// Selection moves skip group headers.
const { stepRow } = await import("../lib/finder.js");
const rows = [{ kind: "head" }, { kind: "item" }, { kind: "item" }, { kind: "head" }, { kind: "item" }];
assert.equal(stepRow(rows, 1, 1), 2);
assert.equal(stepRow(rows, 2, 1), 4);
assert.equal(stepRow(rows, 4, 1), 1);
assert.equal(stepRow(rows, 1, -1), 4);
assert.equal(stepRow(rows, 1, 10), 4);
assert.equal(stepRow(rows, 4, -10), 1);
assert.equal(stepRow([{ kind: "head" }], 0, 1), 0);
console.log("stepRow ok");
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node test/finder.test.mjs`
Expected: FAIL with `Cannot find module '…/lib/finder.js'`.

- [ ] **Step 3: Write the implementation**

Create `mods/my-filer-pro/lib/finder.js`:

```js
// Quick open's file list and ranking. The list of a root is written once to a file on its machine; each query
// filters that file natively (fzf, else grep) and only the first FILTER_MAX hits are ranked here with VS Code's
// scorer (lib/fuzzy.js): mods run in QuickJS, where scoring a whole repository would take seconds. Pure apart from
// the functions passed to createFinder.
import { prepareQuery, scoreItem, compareItems } from "./fuzzy.js";
import { hiddenPath } from "./hidden.js";

// exec returns at most 8 MiB; the listing stops a little below that.
export const LIST_BYTES = 7340032;
export const FILTER_MAX = 200;
const RECENT_SHOWN = 10, RECENT_KEPT = 100, CACHE_MAX = 4, REMOTE_STALE_MS = 30000;

// `<root> <dots> <file>`: writes one relative path per line to <file> and prints "<lines> <bytes>". rg (respects
// .gitignore), else git ls-files in a repository, else find. <dots> 0 leaves out dot files and dot folders.
// node_modules and .git are skipped. Exit 2: the root cannot be entered.
export const FILES_SCRIPT = [
  'cd "$1" 2>/dev/null || exit 2',
  'mkdir -p "$(dirname "$3")" || exit 3',
  '{ if command -v rg >/dev/null 2>&1; then',
  '  if [ "$2" = 1 ]; then rg --files --hidden -g "!.git" -g "!node_modules"; else rg --files -g "!node_modules"; fi',
  'elif git rev-parse --is-inside-work-tree >/dev/null 2>&1; then git ls-files -co --exclude-standard',
  'else find . -name .git -prune -o -name node_modules -prune -o -type f -print | sed "s|^\\./||"',
  `fi; } | { if [ "$2" = 1 ]; then cat; else grep -v -E "(^|/)\\\\."; fi; } | head -c ${LIST_BYTES} > "$3.tmp" && mv "$3.tmp" "$3" || exit 3`,
  'printf "%s %s\\n" "$(wc -l < "$3")" "$(wc -c < "$3")"',
].join("\n");

// `<file> <fzf query> <limit> <grep pattern>`: the best <limit> lines of <file> for the query, best first (fzf), or
// the first <limit> lines matching the pattern where fzf is missing. Older fzf without --scheme runs without it.
export const SEARCH_SCRIPT = [
  'if command -v fzf >/dev/null 2>&1; then',
  '  { fzf --filter "$2" --scheme=path < "$1" 2>/dev/null || fzf --filter "$2" < "$1"; } | head -n "$3"',
  'else grep -i -E -- "$4" "$1" | head -n "$3"; fi',
].join("\n");

// "name:12" or "name:12:5" -> { text: "name", line: 12, column: 5 }; anything else keeps its text.
export function parseQuery(raw) {
  const m = /^(.*?):(\d+)(?::(\d+))?$/.exec(raw.trim());
  if (!m || !m[1]) return { text: raw.trim(), line: null, column: null };
  return { text: m[1], line: Number(m[2]), column: m[3] ? Number(m[3]) : null };
}

// The query for fzf: its operators (' ^ $ ! |) and quotes are dropped, so every word is a plain fuzzy term.
export const fzfQuery = (text) => text.replace(/['"^$!|\\]/g, "").trim().replace(/\s+/g, " ");

// The pattern for grep -i -E: the longest word's characters in order, anything between. Other words are checked by
// the scorer afterwards.
export function grepPattern(text) {
  const words = fzfQuery(text).split(" ").filter(Boolean);
  const word = words.sort((a, b) => b.length - a.length)[0] ?? "";
  return [...word].map((c) => c.replace(/[.*+?()[\]{}^$|\\/]/g, "\\$&")).join(".*");
}

function scored(path, query) {
  const cut = path.lastIndexOf("/"), label = path.slice(cut + 1), description = cut < 0 ? "" : path.slice(0, cut);
  return { path, label, description, score: scoreItem(label, description, path, query) };
}

const toItem = (s) => ({ path: s.path, label: s.label, dir: s.description, score: s.score.score, labelHits: s.score.labelMatch, dirHits: s.score.descriptionMatch });

// Ranks the filtered paths for raw query text. recent: relative paths newest first, ranked in their own group (at
// most 10) and left out of files. hide: the panel's hide settings (system files are dropped here).
// -> { recent, files, line, column }; Item: { path, label, dir, score, labelHits, dirHits }, hits are [start, end).
export function rankPaths(paths, raw, { recent = [], hide = null } = {}) {
  const { text, line, column } = parseQuery(raw);
  const query = prepareQuery(text);
  const visible = (p) => !hiddenPath(p, hide);
  if (!query.normalized) return { recent: recent.filter(visible).slice(0, RECENT_SHOWN).map((p) => toItem(scored(p, query))), files: [], line, column };
  const rank = (list) => list.filter(visible).map((p) => scored(p, query)).filter((s) => s.score.score > 0).sort((a, b) => compareItems(a, b, query));
  const shownRecent = rank(recent).slice(0, RECENT_SHOWN);
  const shown = new Set(shownRecent.map((s) => s.path));
  return { recent: shownRecent.map(toItem), files: rank(paths.filter((p) => !shown.has(p))).map(toItem), line, column };
}

// The recent list as stored in recent.json: { v: 1, items: [{ on, path, at }] }, absolute paths, newest first.
export function addRecent(doc, { on, path, at }) {
  const items = (doc?.v === 1 && Array.isArray(doc.items) ? doc.items : []).filter((r) => !(r.path === path && (r.on ?? null) === (on ?? null)));
  return { v: 1, items: [{ on: on ?? null, path, at }, ...items].slice(0, RECENT_KEPT) };
}

// The relative paths of the recent files below root on machine on, newest first.
export function recentUnder(doc, on, root) {
  const base = root.replace(/\/+$/, "") + "/";
  return (doc?.v === 1 && Array.isArray(doc.items) ? doc.items : [])
    .filter((r) => (r.on ?? null) === (on ?? null) && typeof r.path === "string" && r.path.startsWith(base))
    .map((r) => r.path.slice(base.length));
}

// A short stable name for a root's list file.
export function listName(on, root) {
  let h = 5381;
  const s = `${on ?? ""}\0${root}`;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

// deps: { exec, readTextFile, writeTextFile, recentPath, localDir, now }. localDir holds this computer's list files;
// a machine keeps its own in /tmp.
export function createFinder({ exec, readTextFile, writeTextFile, recentPath, localDir, now }) {
  const cache = new Map(); // key -> entry, oldest first

  // The cache entry for a root: { state: "loading" | "ready" | "error", file, count, truncated, error, ready: Promise }.
  // A stale, failed or (machine) 30 s old entry is listed again; a stale one keeps serving its old file meanwhile.
  function files({ root, on = null, hide }) {
    const name = listName(on, root), key = name;
    let entry = cache.get(key);
    const old = entry && (entry.stale || entry.state === "error" || (on && now() - entry.at > REMOTE_STALE_MS));
    if (entry && (!old || entry.loading)) { cache.delete(key); cache.set(key, entry); return entry; }
    entry = entry ?? { state: "loading", file: on ? `/tmp/filer-pro-finder-${name}.txt` : `${localDir}/${name}.txt`, count: 0, truncated: false, error: null, at: 0 };
    entry.stale = false;
    entry.loading = true;
    entry.ready = exec("sh", ["-c", FILES_SCRIPT, "files", root, hide?.hide_dotfiles === true ? "0" : "1", entry.file], { on, timeout: 15000 })
      .then((r) => {
        if (r.code !== 0) throw new Error(r.code === 2 ? `Cannot open ${root}` : (r.stderr.trim() || "Cannot list files"));
        const [count, bytes] = r.stdout.trim().split(/\s+/).map(Number);
        entry.count = count || 0;
        entry.truncated = bytes >= LIST_BYTES;
        entry.state = "ready"; entry.error = null;
      })
      .catch((e) => { if (entry.state !== "ready") entry.state = "error"; entry.error = String(e?.message ?? e); })
      .finally(() => { entry.loading = false; entry.at = now(); });
    cache.delete(key);
    cache.set(key, entry);
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    return entry;
  }

  // A watch batch under root: the next files() call lists again.
  function invalidate({ root, on = null }) {
    const entry = cache.get(listName(on, root));
    if (entry) entry.stale = true;
  }

  // The ranked result for raw query text on a ready entry (rankPaths). Rejects when the filter cannot run.
  async function search(entry, raw, { on = null, recent = [], hide = null } = {}) {
    const { text } = parseQuery(raw);
    const q = fzfQuery(text);
    if (!q) return rankPaths([], raw, { recent, hide });
    const r = await exec("sh", ["-c", SEARCH_SCRIPT, "search", entry.file, q, String(FILTER_MAX), grepPattern(text) || "."], { on, timeout: 10000 });
    if (r.code !== 0) throw new Error(r.stderr.trim() || "Search failed");
    return rankPaths(r.stdout.split("\n").filter(Boolean), raw, { recent, hide });
  }

  async function readRecent() {
    const text = await readTextFile(recentPath).catch(() => null);
    try { return { text, doc: text ? JSON.parse(text) : null }; } catch { return { text, doc: null }; }
  }

  // Adds an opened file (absolute path) to recent.json. A write that loses a race reads again once, then gives up.
  async function recordOpen({ on = null, path }) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const { text, doc } = await readRecent();
      try { await writeTextFile(recentPath, JSON.stringify(addRecent(doc, { on, path, at: now() })), text); return; } catch {}
    }
  }

  return { files, invalidate, search, readRecent, recordOpen };
}

// The modal's selection after a move of delta rows, skipping group headers ({ kind: "head" }). A move by one
// wraps; a bigger move (a page) stops at the ends. 0 when there is nothing to select.
export function stepRow(rows, at, delta) {
  const items = [];
  rows.forEach((r, i) => { if (r.kind !== "head") items.push(i); });
  if (!items.length) return 0;
  const pos = Math.max(0, items.indexOf(at));
  const next = Math.abs(delta) === 1 ? (pos + delta + items.length) % items.length : Math.max(0, Math.min(items.length - 1, pos + delta));
  return items[next];
}
```

- [ ] **Step 4: Run the tests**

Run: `node test/finder.test.mjs && node test/fuzzy.test.mjs`
Expected: `finder ok`, `stepRow ok`, `fuzzy ok`.

- [ ] **Step 5: Commit**

```bash
git add mods/my-filer-pro/lib/finder.js mods/my-filer-pro/test/finder.test.mjs
git commit -m "Add Filer Pro's quick-open file list and ranking"
```

---

### Task 3: Tree find helpers (`lib/treefind.js`)

**Files:**
- Create: `mods/my-filer-pro/test/treefind.test.mjs`
- Create: `mods/my-filer-pro/lib/treefind.js`

- [ ] **Step 1: Write the failing test**

Create `mods/my-filer-pro/test/treefind.test.mjs`:

```js
// node test/treefind.test.mjs
import assert from "node:assert/strict";
import { findMatches, stepMatch, matchCount, ancestorsOf, matchRange, resolveGoto } from "../lib/treefind.js";

const row = (path, note = false) => ({ path, entry: { name: path.split("/").pop() || "x", note }, depth: 0 });
const rows = [row("Front"), row("src"), row("src/front.vue"), row("src/back.vue"), row("src/", true)];
assert.deepEqual(findMatches(rows, "FRONT"), ["Front", "src/front.vue"]);
assert.deepEqual(findMatches(rows, "  "), []);
assert.deepEqual(findMatches([row("No permission", true)], "perm"), []);

const m = ["a", "b", "c"];
assert.equal(stepMatch(m, "a", 1), "b");
assert.equal(stepMatch(m, "c", 1), "a");
assert.equal(stepMatch(m, "a", -1), "c");
assert.equal(stepMatch(m, "zzz", 1), "a");
assert.equal(stepMatch(m, "zzz", -1), "c");
assert.equal(stepMatch([], "a", 1), null);
assert.equal(matchCount(m, "b"), "2/3");
assert.equal(matchCount(m, "x"), "0/3");

assert.deepEqual(ancestorsOf("a/b/c.txt"), ["a", "a/b"]);
assert.deepEqual(ancestorsOf("c.txt"), []);

assert.deepEqual(matchRange("FrontEnd.vue", "end"), [5, 8]);
assert.equal(matchRange("a.vue", "x"), null);

assert.equal(resolveGoto("/abs/x/", "/r", "/h"), "/abs/x");
assert.equal(resolveGoto("~", "/r", "/h"), "/h");
assert.equal(resolveGoto("~/Repo", "/r", "/h"), "/h/Repo");
assert.equal(resolveGoto("../x", "/r/a", "/h"), "/r/x");
assert.equal(resolveGoto("sub/./y", "/r/", "/h"), "/r/sub/y");
assert.equal(resolveGoto("/..", "/r", "/h"), "/");
assert.equal(resolveGoto("  ", "/r", "/h"), null);

console.log("treefind ok");
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node test/treefind.test.mjs`
Expected: FAIL with `Cannot find module '…/lib/treefind.js'`.

- [ ] **Step 3: Write the implementation**

Create `mods/my-filer-pro/lib/treefind.js`:

```js
// The find row's matching, Reveal's folder chain and the go-to row's path. Pure.

// The paths of rows (from visibleRows) whose name contains q, ignoring case, in row order. Note rows never match.
export function findMatches(rows, q) {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  return rows.filter((r) => !r.entry.note && r.entry.name.toLowerCase().includes(needle)).map((r) => r.path);
}

// The match after (dir 1) or before (dir -1) current, wrapping; the first or last when current is not a match.
// null without matches.
export function stepMatch(matches, current, dir) {
  if (!matches.length) return null;
  const i = matches.indexOf(current);
  if (i < 0) return dir < 0 ? matches[matches.length - 1] : matches[0];
  return matches[(i + dir + matches.length) % matches.length];
}

// "1/3" for the counter: current's place among the matches, 0 when it is not one of them.
export function matchCount(matches, current) {
  return `${matches.indexOf(current) + 1}/${matches.length}`;
}

// The folders above a relative path, outermost first: "a/b/c.txt" -> ["a", "a/b"].
export function ancestorsOf(rel) {
  const parts = rel.split("/").filter(Boolean);
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
}

// [start, end) of q in name ignoring case, or null: the find row's highlight.
export function matchRange(name, q) {
  const needle = q.trim().toLowerCase();
  const i = needle ? name.toLowerCase().indexOf(needle) : -1;
  return i < 0 ? null : [i, i + needle.length];
}

// The absolute folder a go-to entry names: "/abs", "~", "~/x" (home), or a path relative to root. "." and ".."
// parts are resolved; a trailing slash is dropped. null for an empty entry.
export function resolveGoto(text, root, home) {
  const t = text.trim();
  if (!t) return null;
  const base = t === "~" || t.startsWith("~/") ? home + t.slice(1) : t.startsWith("/") ? t : `${root.replace(/\/+$/, "")}/${t}`;
  const out = [];
  for (const part of base.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return "/" + out.join("/");
}
```

- [ ] **Step 4: Run the test**

Run: `node test/treefind.test.mjs`
Expected: `treefind ok`.

- [ ] **Step 5: Commit**

```bash
git add mods/my-filer-pro/lib/treefind.js mods/my-filer-pro/test/treefind.test.mjs
git commit -m "Add Filer Pro's find-row and go-to helpers"
```

---

### Task 4: Show the Files panel from code (`showSteps`)

**Files:**
- Create: `mods/my-filer-pro/test/panels.test.mjs`
- Modify: `mods/my-filer-pro/lib/panels.js` (append at the end)

- [ ] **Step 1: Write the failing test**

Create `mods/my-filer-pro/test/panels.test.mjs`:

```js
// node test/panels.test.mjs
import assert from "node:assert/strict";
import { showSteps } from "../lib/panels.js";

const stack = (hidden, active) => ({ id: "root", children: [{ id: "panel", hidden, children: [{ id: "panel-body", type: "stack", active, children: [{ id: "files" }, { id: "filer-pro" }] }] }] });
assert.deepEqual(showSteps(stack(false, "filer-pro"), "filer-pro"), []);
assert.deepEqual(showSteps(stack(true, "filer-pro"), "filer-pro"), [["layout.select", { stack: "panel-body", child: "filer-pro" }], ["layout.show", { id: "panel" }]]);
assert.deepEqual(showSteps(stack(false, "files"), "filer-pro"), [["layout.select", { stack: "panel-body", child: "filer-pro" }], ["layout.show", { id: "panel" }]]);
const column = { id: "root", children: [{ id: "panel", hidden: false, children: [{ id: "panel-body", type: "column", children: [{ id: "files" }, { id: "filer-pro", hidden: true }] }] }] };
assert.deepEqual(showSteps(column, "filer-pro"), [["layout.show", { id: "files" }], ["layout.show", { id: "filer-pro" }], ["layout.show", { id: "panel" }]]);
assert.deepEqual(showSteps({ id: "root" }, "filer-pro"), []);
console.log("panels ok");
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node test/panels.test.mjs`
Expected: FAIL with `The requested module '../lib/panels.js' does not provide an export named 'showSteps'`.

- [ ] **Step 3: Write the implementation**

Append to the end of `mods/my-filer-pro/lib/panels.js`:

```js
// The run() calls ([command, args] pairs) that put panel block `id` on screen; [] when it is shown already or the
// layout has no panel.
export function showSteps(root, id) {
  const panel = find(root, "panel"), body = find(root, "panel-body");
  if (!panel || !body || panelShown(root, id)) return [];
  if (body.type === "stack") return [["layout.select", { stack: "panel-body", child: id }], ["layout.show", { id: "panel" }]];
  const want = [...(panel.hidden ? [] : (body.children ?? []).filter((c) => !c.hidden).map((c) => c.id)), id];
  return [...(body.children ?? []).map((c) => [want.includes(c.id) ? "layout.show" : "layout.hide", { id: c.id }]), ["layout.show", { id: "panel" }]];
}
```

- [ ] **Step 4: Run all tests**

Run: `for f in test/*.test.mjs; do node "$f" || exit 1; done`
Expected: `fuzzy ok`, `finder ok`, `stepRow ok`, `panels ok`, `treefind ok` (order may differ).

- [ ] **Step 5: Commit**

```bash
git add mods/my-filer-pro/lib/panels.js mods/my-filer-pro/test/panels.test.mjs
git commit -m "Add showSteps to put the Files panel on screen"
```

---

### Task 5: Icons and the two UI files

**Files:**
- Create: `mods/my-filer-pro/search.svg`, `chevron-up.svg`, `x.svg`, `folder-input.svg`
- Create: `mods/my-filer-pro/ui/quickopen.js`
- Create: `mods/my-filer-pro/ui/treerow.js`

- [ ] **Step 1: Add the Lucide icons**

Each file uses the same frame as the existing `chevron-down.svg`. Create `mods/my-filer-pro/search.svg`:

```svg
<svg
  class="lucide lucide-search"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <circle cx="11" cy="11" r="8" />
  <path d="m21 21-4.3-4.3" />
</svg>
```

Create `mods/my-filer-pro/chevron-up.svg`:

```svg
<svg
  class="lucide lucide-chevron-up"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="m18 15-6-6-6 6" />
</svg>
```

Create `mods/my-filer-pro/x.svg`:

```svg
<svg
  class="lucide lucide-x"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M18 6 6 18" />
  <path d="m6 6 12 12" />
</svg>
```

Create `mods/my-filer-pro/folder-input.svg`:

```svg
<svg
  class="lucide lucide-folder-input"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <path d="M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1" />
  <path d="M2 13h10" />
  <path d="m9 16 3-3-3-3" />
</svg>
```

- [ ] **Step 2: Write `ui/quickopen.js`**

Create `mods/my-filer-pro/ui/quickopen.js`:

```js
// Quick open (cmd-k, the header's search button): a popup that finds files under the Files root by name, ranked
// like VS Code (lib/finder.js), and hands the pick to the panel. State lives in createQuickOpen (init), the view
// in quickOpenView (render).
import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, v_virtual_list, Scrollbar, VirtualListScrollHandle } from "gpui-base";
import { boxy, card } from "../boxy.js";
import { icon, BASE } from "../lib/icons.js";
import { recentUnder, stepRow } from "../lib/finder.js";

const ROW = 30, HEAD = 24;

// The list rows of a result: a header, then items, per group.
function rowsOf(result) {
  const rows = [];
  if (result.recent.length) {
    rows.push({ kind: "head", key: "h-recent", text: "recently opened" });
    for (const item of result.recent) rows.push({ kind: "item", key: `r-${item.path}`, item });
  }
  if (result.files.length) {
    rows.push({ kind: "head", key: "h-files", text: "file results" });
    for (const item of result.files) rows.push({ kind: "item", key: `f-${item.path}`, item });
  }
  return rows;
}

// target: { root, on, hide } (root null: no folder); deps: { finder, onPick(item, open, at, cx) }, at: { line, column }.
export function createQuickOpen(target, deps, cx) {
  const state = { target, query: "", result: null, rows: [], at: 0, error: null, loading: Boolean(target.root), seq: 0, recent: [] };
  state.input = InputState.new({ placeholder: "Go to file…" });
  state.handle = cx.focus_handle();
  state.scroll = VirtualListScrollHandle.new();
  state.entry = target.root ? deps.finder.files(target) : null;

  // Runs the current query; a reply for an older query is dropped. A machine waits 120 ms for more typing first.
  state.run = (cx) => {
    if (!state.entry) return;
    const seq = ++state.seq, text = state.query;
    cx.spawn(async (cx) => {
      try {
        if (target.on) { await cx.sleep(120); if (seq !== state.seq) return; }
        if (state.entry.loading) await state.entry.ready;
        if (seq !== state.seq) return;
        if (state.entry.state === "error") throw new Error(state.entry.error);
        const result = await deps.finder.search(state.entry, text, { on: target.on, recent: state.recent, hide: target.hide });
        if (seq !== state.seq) return;
        state.result = result;
        state.rows = rowsOf(result);
        state.at = Math.max(0, state.rows.findIndex((r) => r.kind === "item"));
        state.error = null;
      } catch (e) {
        if (seq !== state.seq) return;
        state.error = String(e?.message ?? e);
        state.rows = [];
      }
      state.loading = false;
      state.scroll.scroll_to_item(0);
      cx.notify();
    });
  };
  // Lists the root again (after an error), then runs the query.
  state.retry = (cx) => {
    state.entry = deps.finder.files(target);
    state.error = null; state.loading = true;
    state.run(cx);
    cx.notify();
  };
  // open false: reveal in the tree only (cmd-enter).
  state.pick = (i, open, cx) => {
    const r = state.rows[i];
    if (r?.kind === "item") deps.onPick(r.item, open, { line: state.result?.line ?? null, column: state.result?.column ?? null }, cx);
  };
  state.input.on("change", (_e, cx) => { state.query = state.input.value(); state.run(cx); });
  state.input.on("submit", (e, cx) => state.pick(state.at, !e.secondary, cx));
  cx.spawn(async (cx) => {
    const { doc } = await deps.finder.readRecent();
    state.recent = target.root ? recentUnder(doc, target.on, target.root) : [];
    state.run(cx);
  });
  state.input.focus();
  cx.timer.after(600, () => state.input.focus());
  return state;
}

// text with the [start, end) ranges in the accent, semibold.
function highlighted(t, text, ranges, size) {
  const parts = [];
  let at = 0;
  for (const [start, end] of ranges ?? []) {
    if (start > at) parts.push(div().flex_none().child(text.slice(at, start)));
    parts.push(div().flex_none().text_color(t.accent).font_semibold().child(text.slice(start, end)));
    at = end;
  }
  if (at < text.length) parts.push(div().flex_none().child(text.slice(at)));
  return h_flex().text_size(size).children(parts);
}

function rowView(t, row, on, dark) {
  if (row.kind === "head") return div().id(row.key).h(HEAD).px(8).flex().items_end().pb(3).text_size(10.5).font_semibold().text_color(t.foreground).child(row.text);
  const { item } = row;
  return card(t, h_flex().id(row.key).h(ROW).px(8).gap(8).items_center().rounded(8).cursor_pointer(), on)
    .child(image(icon(item.path, false, false, dark)).size(16).flex_none())
    .child(highlighted(t, item.label, item.labelHits, 13).flex_none())
    .child(highlighted(t, item.dir, item.dirHits, 11.5).flex_1().min_w(0).overflow_hidden());
}

// handlers: { onClose() }
export function quickOpenView(t, state, dark, rootLabel, handlers) {
  const { rows } = state;
  const move = (delta, cx) => { state.at = stepRow(rows, state.at, delta); state.scroll.scroll_to_item(state.at); cx.notify(); };
  const message = state.error ?? (!state.target.root ? "No folder to search" : state.loading ? "Listing files…" : state.query.trim() ? "No matching files" : "Type to find a file");
  return v_flex().id("quick-open").track_focus(state.handle).size_full().p(12).gap(8).bg(t.popover).text_color(t.foreground).text_size(13)
    .on_key_down((e, cx) => {
      const k = e.key;
      if (k === "escape") { handlers.onClose(); cx.stop_propagation(); return; }
      if (k === "down" || (k === "n" && e.modifiers.control)) move(1, cx);
      else if (k === "up" || (k === "p" && e.modifiers.control)) move(-1, cx);
      else if (k === "pagedown") move(10, cx);
      else if (k === "pageup") move(-10, cx);
      else return;
      cx.stop_propagation();
    })
    .child(h_flex().items_center().gap(8)
      .child(div().flex_none().text_size(14).font_semibold().child("Go to file"))
      .child(div().flex_1().min_w(0).truncate().text_size(12).child(rootLabel))
      .child(boxy(t, "quick-open-esc", "Esc", { h: 16, px: 6, size: 11, onClick: () => handlers.onClose() }).tooltip("Close")))
    .child(h_flex().h(34).flex_none().px(10).gap(8).items_center().rounded(8).border_1().border_color(t.accent).bg(t.background)
      .child(svg(`${BASE}/search.svg`).size(14).text_color(t.foreground))
      .child(Input.new(state.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)))
    .child(rows.length
      ? v_flex().id("quick-open-box").relative().flex_1().min_h(0)
        .child(v_virtual_list("quick-open-list", rows.length, rows.map((r) => (r.kind === "head" ? HEAD : ROW)), (i) => rows[i].key,
          (range) => rows.slice(range.start, range.end).map((r, k) => rowView(t, r, range.start + k === state.at, dark)))
          .track_scroll(state.scroll).size_full()
          .on_item_click((key, cx) => { const i = rows.findIndex((r) => r.key === key); if (i >= 0) state.pick(i, true, cx); }))
        .child(Scrollbar.vertical("quick-open-list").absolute().inset_0())
      : h_flex().flex_1().px(8).gap(8).items_start()
        .child(div().text_size(12).text_color(state.error ? t.ansi1 : t.foreground).child(message))
        .when(Boolean(state.error), (el) => el.child(boxy(t, "quick-open-retry", "Retry", { h: 20, px: 8, size: 11.5, onClick: (_e, cx) => state.retry(cx) }))))
    .when(Boolean(state.entry?.truncated), (el) => el.child(div().flex_none().text_size(11).child(`Listed the first ${state.entry.count} files`)));
}
```

- [ ] **Step 3: Write `ui/treerow.js`**

Create `mods/my-filer-pro/ui/treerow.js`:

```js
// The row under the Files header: the find row (cmd-f) or the go-to row (the folder button, the pane menu).
import { div, svg } from "gpui-kit";
import { h_flex, Input } from "gpui-base";
import { boxy } from "../boxy.js";
import { BASE } from "../lib/icons.js";

const icon = (t, id, glyph, label, onClick) => boxy(t, id, svg(`${BASE}/${glyph}.svg`).size(13), { h: 20, px: 5, onClick: (_e, cx) => onClick(cx) })
  .tooltip(label).accessibility_label(label);

const field = (t, input) => h_flex().flex_1().min_w(0).h(26).px(8).items_center().rounded(6).border_1().border_color(t.accent).bg(t.background)
  .child(Input.new(input).flex_1().h_full().text_size(12.5).text_color(t.foreground));

// state: { input, count ("n/m"), none (no match) }; handlers: { onStep(dir, cx), onClose(cx) }
export function findRow(t, state, handlers) {
  return h_flex().id("files-find-row").flex_none().h(38).px(10).gap(6).items_center().border_b(1).border_color(t.border)
    .on_key_down((e, cx) => {
      if (e.key === "escape") handlers.onClose(cx);
      else if (e.key === "down") handlers.onStep(1, cx);
      else if (e.key === "up") handlers.onStep(-1, cx);
      else return;
      cx.stop_propagation();
    })
    .child(svg(`${BASE}/search.svg`).size(13).flex_none().text_color(t.foreground))
    .child(field(t, state.input))
    .child(div().flex_none().w(44).text_right().text_size(11.5).text_color(state.none ? t.ansi1 : t.foreground).child(state.count))
    .child(icon(t, "files-find-prev", "chevron-up", "Previous match", (cx) => handlers.onStep(-1, cx)))
    .child(icon(t, "files-find-next", "chevron-down", "Next match", (cx) => handlers.onStep(1, cx)))
    .child(icon(t, "files-find-close", "x", "Close", (cx) => handlers.onClose(cx)));
}

// state: { input, error }; handlers: { onGo(cx), onClose(cx) }
export function gotoRow(t, state, handlers) {
  return h_flex().id("files-goto-row").flex_none().min_h(38).px(10).py(6).gap(6).items_center().flex_wrap().border_b(1).border_color(t.border)
    .on_key_down((e, cx) => { if (e.key === "escape") { handlers.onClose(cx); cx.stop_propagation(); } })
    .child(svg(`${BASE}/folder-input.svg`).size(13).flex_none().text_color(t.foreground))
    .child(field(t, state.input))
    .child(boxy(t, "files-goto-go", "Go", { h: 20, px: 8, size: 11.5, onClick: (_e, cx) => handlers.onGo(cx) }))
    .child(icon(t, "files-goto-close", "x", "Close", (cx) => handlers.onClose(cx)))
    .when(Boolean(state.error), (el) => el.child(div().w_full().text_size(11.5).text_color(t.ansi1).child(state.error)));
}
```

- [ ] **Step 4: Syntax check**

Run: `node --check ui/quickopen.js && node --check ui/treerow.js && echo syntax ok`
Expected: `syntax ok`. (Nothing imports these files yet; `herdr-app check` runs after Task 6.)

- [ ] **Step 5: Commit**

```bash
git add mods/my-filer-pro/search.svg mods/my-filer-pro/chevron-up.svg mods/my-filer-pro/x.svg mods/my-filer-pro/folder-input.svg mods/my-filer-pro/ui/quickopen.js mods/my-filer-pro/ui/treerow.js
git commit -m "Add the quick-open popup and tree rows for Filer Pro"
```

---

### Task 6: Quick open in `main.js` (popup copy, pick, reveal)

**Files:**
- Modify: `mods/my-filer-pro/main.js`
- Modify: `mods/my-filer-pro/mod.json`

Each edit below gives the exact text to find and its replacement. Apply them in order.

- [ ] **Step 1: Imports**

Find:
```js
import { v_flex, h_flex, Editor, EditorState } from "gpui-base";
```
Replace with:
```js
import { v_flex, h_flex, Editor, EditorState, ScrollHandle, InputState } from "gpui-base";
```

Find:
```js
import { withPanel, withoutLegacy, panelShown } from "./lib/panels.js";
```
Replace with:
```js
import { withPanel, withoutLegacy, panelShown, showSteps } from "./lib/panels.js";
```

Find:
```js
import { boxy } from "./boxy.js";
```
Replace with:
```js
import { boxy } from "./boxy.js";
import { createFinder } from "./lib/finder.js";
import { findMatches, stepMatch, matchCount, ancestorsOf, matchRange, resolveGoto } from "./lib/treefind.js";
import { createQuickOpen, quickOpenView } from "./ui/quickopen.js";
import { findRow, gotoRow } from "./ui/treerow.js";
```

- [ ] **Step 2: The shared finder and the popup's folder**

Find:
```js
const loadPreview = async () => (previewModule ??= await import("./preview/index.js").catch(() => null));
```
Replace with:
```js
const loadPreview = async () => (previewModule ??= await import("./preview/index.js").catch(() => null));

// Quick open's lists, shared by every copy of this build; made on first use, so loading the module runs no host call.
let finderInstance = null;
const finder = () => (finderInstance ??= createFinder({ exec, readTextFile, writeTextFile, recentPath: `${appHome()}/filer-pro/recent.json`, localDir: `${appHome()}/data/filer-pro/finder`, now: Date.now }));
```

Find:
```js
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}
```
Replace with:
```js
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}

// The folder quick open searches: the Files panel's shown root while the panel is on screen, else the focused
// terminal's folder. hide: the panel's hide settings as it published them.
function quickTarget() {
  const shown = shared("filer-pro.root");
  if (shown?.root && panelShown(layout(), "filer-pro")) return { root: shown.root, on: shown.on ?? null, hide: shown.hide ?? null };
  const loc = location();
  return { root: loc.cwd ?? null, on: loc.on ?? null, hide: shown?.hide ?? null };
}
```

- [ ] **Step 3: The popup copy**

Find:
```js
      if (props().view === "settings") {
        // Every InputState of the dialog is created here, from the snapshot the opener stored (openSettings).
        this.settings = createSettingsDialog(shared("filer-pro.settings"), cx);
      }
```
Replace with:
```js
      if (props().view === "settings") {
        // Every InputState of the dialog is created here, from the snapshot the opener stored (openSettings).
        this.settings = createSettingsDialog(shared("filer-pro.settings"), cx);
      }
      // mod.open:my-filer-pro (cmd-k, the header's search button): quick open, placed by mod.json's overlay.
      if (!props().view) this.quick = createQuickOpen(quickTarget(), { finder: finder(), onPick: (item, open, at) => this.pickFile(item, open, at) }, cx);
```

Find:
```js
  overlayView(cx) {
    const t = theme(), p = props();
    const close = () => { try { closeOverlay(p.overlay); } catch {} };
```
Replace with:
```js
  overlayView(cx) {
    const t = theme(), p = props();
    const close = () => { try { closeOverlay(p.overlay); } catch {} };
    if (!p.view && this.quick) {
      const { root, on } = this.quick.target;
      return quickOpenView(t, this.quick, Boolean(settings().dark), root ? `${on ? `${on}: ` : ""}${tilde(root, home())}` : "", { onClose: close });
    }
```

Find:
```js
  // Shows the last download in the Finder (toast action "filer-pro.reveal").
  revealLast() {
```
Replace with:
```js
  // Quick open's pick: puts the Files panel on screen and hands it the file (pollPick), then closes the popup.
  // open false: reveal only. at: { line, column } from a "name:12:5" query.
  pickFile(item, open, at) {
    const { root, on } = this.quick.target;
    for (const [command, args] of showSteps(layout(), "filer-pro")) run(command, args);
    setShared("filer-pro.pick", { id: this.newId(), machine: on ?? null, path: joinPath(root, item.path), open, line: at.line, column: at.column });
    try { closeOverlay(props().overlay); } catch {}
  }

  // Shows the last download in the Finder (toast action "filer-pro.reveal").
  revealLast() {
```

Find:
```js
  async close() {
    const e = this.edit;
```
Replace with:
```js
  async close() {
    if (this.quick) { this.quick.scroll.release(); this.quick.input.release(); this.quick = null; return; }
    const e = this.edit;
```

- [ ] **Step 4: The button copy answers `show`**

Find:
```js
          if (command === "reveal" && !panelShown(layout(), "filer-pro")) this.revealLast();
```
Replace with:
```js
          if (command === "reveal" && !panelShown(layout(), "filer-pro")) this.revealLast();
          // my-menu's Go to Folder in Files: the panel may be hidden, so this always-shown copy puts it on screen.
          if (command === "show") for (const [c, a] of showSteps(layout(), "filer-pro")) run(c, a);
```

- [ ] **Step 5: Panel state for picks, reveal and the row slot**

Find:
```js
    this.packageSeen = shared("filer-pro.package")?.id ?? null; // an old Show Package Contents request is not applied again
```
Replace with:
```js
    this.packageSeen = shared("filer-pro.package")?.id ?? null; // an old Show Package Contents request is not applied again
    this.pickSeen = shared("filer-pro.pick")?.id ?? null; // an old quick-open pick is not applied again
    this.gotoRowSeen = shared("filer-pro.goto-row")?.id ?? null;
    this.treeScroll = ScrollHandle.new();
    this.treeFocus = cx.focus_handle();
    this.row = null; this.findQuery = ""; this.gotoError = null;
    this.findInput = InputState.new({ placeholder: "Find in tree" });
    this.findInput.on("change", (_e, cx) => { this.findQuery = this.findInput.value(); this.findStep(0, cx); });
    this.findInput.on("submit", (e, cx) => this.findStep(e.shift ? -1 : 1, cx));
    this.gotoInput = InputState.new({ placeholder: "/path, ~/path or a path below this folder" });
    this.gotoInput.on("change", (_e, cx) => { if (this.gotoError) { this.gotoError = null; cx.notify(); } });
    this.gotoInput.on("submit", (_e, cx) => this.submitGoto(cx));
```

- [ ] **Step 6: Publish the shown root; drop stale lists**

Find:
```js
    this.fileWanted = Math.max(this.fileWanted ?? 0, file === true ? FILE_ALL : file || 0);
```
Replace with:
```js
    // What quick open searches while this panel is on screen (quickTarget); written only when it changed, since
    // every write redraws every mod. A config reload passes here too, so new hide settings reach it.
    if (!props()?.overlay) {
      const value = { root: cwd ?? null, on: on ?? null, hide: { hide_system_files: this.conf.hide_system_files, hide_dotfiles: this.conf.hide_dotfiles } };
      const json = JSON.stringify(value);
      if (json !== this.publishedRoot) { this.publishedRoot = json; cx.spawn(async () => setShared("filer-pro.root", value)); }
    }
    this.fileWanted = Math.max(this.fileWanted ?? 0, file === true ? FILE_ALL : file || 0);
```

Find:
```js
          const paths = await watchFolder(root);
          await resolved;
```
Replace with:
```js
          const paths = await watchFolder(root);
          finder().invalidate({ root, on: null }); // any change below the root may add or remove a file quick open lists
          await resolved;
```

Find:
```js
        if (next !== sizes) setShared("filer-pro.sizes", next);
        this.reloadConfig(cx, { file: FILE_NAMED, force: true });
```
Replace with:
```js
        if (next !== sizes) setShared("filer-pro.sizes", next);
        finder().invalidate({ root: this.root, on: this.on });
        this.reloadConfig(cx, { file: FILE_NAMED, force: true });
```

- [ ] **Step 7: Pick, reveal and scroll methods**

Find:
```js
  // Calculate Size (issue #58): the menu copy asks through shared filer-pro.sizes (lib/sizes.js requestSize). The panel
```
Replace with:
```js
  // Quick open's pick (shared filer-pro.pick = { id, machine, path, open, line, column }): the panel that shows that
  // machine and a folder above the path reveals the file and opens it, once. Called from render, so it runs in a task.
  pollPick(cx) {
    const r = shared("filer-pro.pick");
    if (!r?.id || r.id === this.pickSeen) return;
    this.pickSeen = r.id;
    const rel = expandPath({ machine: r.machine ?? null, folder: r.path }, this.root, this.on);
    if (!rel) { cx.spawn(async () => notify({ title: "Go to file", body: `Outside ${this.root ?? "the shown folder"}`, level: "warning" })); return; }
    cx.spawn(async (cx) => this.requestLeave((cx) => this.openPicked(rel, r, cx), cx));
  }

  // Reveals rel and, unless r.open is false, opens it: local text and Markdown in the tab's nvim at r.line, the rest in the viewer.
  openPicked(rel, r, cx) {
    this.revealInTree(rel, cx);
    this.lastOpened = rel;
    if (r.open === false) { cx.notify(); return; }
    this.noteOpen(rel);
    if (this.editsInNvim(rel)) this.openInNvim(rel, cx, r.line ? `:${r.line}${r.column ? `:${r.column}` : ""}` : "");
    else this.show(rel, cx);
  }

  // Expands every folder above rel and loads the ones not loaded yet; render scrolls to it afterwards (revealPending).
  // shortcut: a folder above rel that is a macOS package stays a file row, so the reveal stops there; add it to this.packages when that matters.
  revealInTree(rel, cx) {
    const above = ancestorsOf(rel);
    for (const folder of above) this.folders.add(folder);
    this.revealWanted = rel;
    if (above.some((folder) => !this.entries.has(folder))) this.refresh(cx);
    cx.notify();
  }

  // Scrolls the tree so path's row is visible; false when the row is not in the tree.
  scrollToRow(path) {
    const i = this.visible().findIndex((r) => r.path === path);
    if (i >= 0) this.treeScroll.scroll_to_item(i);
    return i >= 0;
  }

  // The scroll of a reveal, once the tree is loaded and on screen (not behind the viewer). Called from render.
  revealPending(cx) {
    const want = this.revealWanted;
    if (!want || this.file || this.loading || this.pending.size) return;
    this.revealWanted = null;
    if (!this.scrollToRow(want)) cx.spawn(async () => notify({ title: "Go to file", body: "Beyond the list limit, not shown in the tree", level: "info" }));
  }

  // An opened file for quick open's recently opened group.
  noteOpen(path) {
    finder().recordOpen({ on: this.on, path: joinPath(this.root, path) }).catch(() => {});
  }

  // Calculate Size (issue #58): the menu copy asks through shared filer-pro.sizes (lib/sizes.js requestSize). The panel
```

- [ ] **Step 8: nvim at a line; record tree opens**

Find:
```js
  openInNvim(path, cx) {
    this.lastOpened = path; cx.notify();
    const tab = focused()?.tab;
    cx.spawn(async (cx) => {
      const r = tab ? await exec(`${appHome()}/mods/my-nvim/bin/my-nvim`, ["open", "--tab", tab, joinPath(this.root, path)]).catch(() => null) : null;
```
Replace with:
```js
  // at: ":line" or ":line:column" (my-nvim open accepts <file>:line[:col]), or "".
  openInNvim(path, cx, at = "") {
    this.lastOpened = path; cx.notify();
    const tab = focused()?.tab;
    cx.spawn(async (cx) => {
      const r = tab ? await exec(`${appHome()}/mods/my-nvim/bin/my-nvim`, ["open", "--tab", tab, joinPath(this.root, path) + at]).catch(() => null) : null;
```

Find:
```js
    const action = fileClick(event, bundle ? this.conf.double_click_apps : this.conf.double_click_files);
    if (action === "open" && !bundle && this.editsInNvim(path)) { this.openInNvim(path, cx); return; }
```
Replace with:
```js
    const action = fileClick(event, bundle ? this.conf.double_click_apps : this.conf.double_click_files);
    if (action === "open" && !bundle) this.noteOpen(path);
    if (action === "open" && !bundle && this.editsInNvim(path)) { this.openInNvim(path, cx); return; }
```

- [ ] **Step 9: Wire render and the tree's scroll handle**

Find:
```js
    this.pollGoto(cx);
    const t = theme(), dark = Boolean(settings().dark);
```
Replace with:
```js
    this.pollGoto(cx);
    this.pollPick(cx);
    this.revealPending(cx);
    const t = theme(), dark = Boolean(settings().dark);
```

Find:
```js
      .child(v_flex().id("files-tree").min_h(0).overflow_y_scrollbar()
```
Replace with:
```js
      .child(v_flex().id("files-tree").min_h(0).overflow_y_scrollbar().track_scroll(this.treeScroll)
```

- [ ] **Step 10: Place the popup for `mod.open`**

Replace `mods/my-filer-pro/mod.json` with (keep `version` and `cloned_from` as they are in the file):

```json
{
  "place": "none",
  "version": "1.3.3",
  "cloned_from": {
    "name": "filer-pro",
    "version": "0.1.15"
  },
  "overlay": { "kind": "popup", "at": "top", "offset": 40, "width": 640, "height": 0.6 }
}
```

- [ ] **Step 11: Check and try it**

```bash
cd /Users/danish/Repo/herdr-maroon/mods/my-filer-pro && for f in test/*.test.mjs; do node "$f" || exit 1; done
rsync -a /Users/danish/Repo/herdr-maroon/mods/my-filer-pro/ ~/.config/herdr-app/mods/my-filer-pro/
herdr-app check ~/.config/herdr-app/mods/my-filer-pro
herdr-app do mod.open --name my-filer-pro
herdr-app shot /tmp/filer-quick-open.png
```
Expected: tests print their `ok` lines; `check passed`; the screenshot shows "Go to file" near the top of the window with the Files root and recent files.

In the app: type `main`, see ranked rows with accent highlights; ↑/↓ move the card; ⏎ opens the file in nvim (text) or the viewer, the tree expands to it and scrolls to it; ⌘⏎ only reveals; Esc closes. Type `main.js:20` and ⏎: nvim opens at line 20.

- [ ] **Step 12: Commit**

```bash
cd /Users/danish/Repo/herdr-maroon
git add mods/my-filer-pro/main.js mods/my-filer-pro/mod.json
git commit -m "Open files from Filer Pro's quick open and reveal them in the tree"
```

---

### Task 7: Header buttons, find row and go-to row in `main.js`

**Files:**
- Modify: `mods/my-filer-pro/main.js`

- [ ] **Step 1: Header buttons**

Find:
```js
      this.navButton("files-up", "corner-left-up", "Up one level", t, nav.up ? (cx) => this.navigate(nav.up, cx) : null),
    ];
  }
```
Replace with:
```js
      this.navButton("files-up", "corner-left-up", "Up one level", t, nav.up ? (cx) => this.navigate(nav.up, cx) : null),
      this.navButton("files-goto", "folder-input", "Go to folder…", t, this.root ? (cx) => this.openRow("goto", null, cx) : null),
      this.navButton("files-quick-open", "search", "Go to file (⌘K)", t, () => run("mod.open", { name: "my-filer-pro" })),
    ];
  }
```

- [ ] **Step 2: Row slot methods**

Find:
```js
  // An icon button of the header's navigation (Up, Go to /) in the refresh button's style; without onClick dimmed.
```
Replace with:
```js
  // The row under the header: "find" (cmd-f) or "goto" (the folder button, my-menu's Go to Folder in Files). value:
  // the go-to row's text (default: the shown root).
  openRow(kind, value, cx) {
    this.row = kind;
    if (kind === "find") { this.findInput.focus(); if (this.findQuery) this.findStep(0, cx); }
    else { this.gotoError = null; this.gotoInput.set_value(value ?? this.root ?? ""); this.gotoInput.focus(); }
    cx.notify();
  }

  closeRow(cx) {
    this.row = null;
    this.treeFocus.focus();
    cx.notify();
  }

  // Moves the selection (lastOpened) to the next (1) or previous (-1) row whose name contains the find query, or
  // to the first one (0, a query change), and scrolls to it.
  findStep(dir, cx) {
    const matches = findMatches(this.visible(), this.findQuery);
    const next = dir === 0 ? matches[0] ?? null : stepMatch(matches, this.lastOpened, dir);
    if (next) { this.lastOpened = next; this.scrollToRow(next); }
    cx.notify();
  }

  // The go-to row's Enter: the folder must exist on the panel's machine; then it becomes the shown root.
  // shortcut: "~" is this computer's home also on a machine; type an absolute path there.
  submitGoto(cx) {
    const abs = resolveGoto(this.gotoInput.value(), this.root ?? home(), home());
    if (!abs) return;
    const on = this.on;
    cx.spawn(async (cx) => {
      const r = await exec("test", ["-d", abs], { on }).catch(() => null);
      if (r?.code !== 0) { this.gotoError = `Not a folder: ${abs}`; cx.notify(); return; }
      if (on !== this.on) return;
      this.row = null;
      this.navigate(abs, cx);
      cx.notify();
    });
  }

  // my-menu's Go to Folder in Files (shared filer-pro.goto-row = { id, machine, cwd }): opens the go-to row with that
  // folder, once, in the panel that shows the same machine. Called from render, so it runs in a task.
  pollGotoRow(cx) {
    const r = shared("filer-pro.goto-row");
    if (!r?.id || r.id === this.gotoRowSeen) return;
    this.gotoRowSeen = r.id;
    if ((r.machine ?? null) !== (this.on ?? null)) return;
    cx.spawn(async (cx) => this.openRow("goto", r.cwd, cx));
  }

  rowSlot(t) {
    if (this.row === "find") {
      const matches = findMatches(this.visible(), this.findQuery);
      return findRow(t, { input: this.findInput, count: this.findQuery.trim() ? matchCount(matches, this.lastOpened) : "", none: Boolean(this.findQuery.trim()) && !matches.length },
        { onStep: (dir, cx) => this.findStep(dir, cx), onClose: (cx) => this.closeRow(cx) });
    }
    return gotoRow(t, { input: this.gotoInput, error: this.gotoError }, { onGo: (cx) => this.submitGoto(cx), onClose: (cx) => this.closeRow(cx) });
  }

  // A row's name; while the find row is open, the matched part is marked (the current match in the accent).
  nameCell(name, path, t) {
    const range = this.row === "find" ? matchRange(name, this.findQuery) : null;
    if (!range) return div().flex_1().min_w(0).truncate().child(name);
    const current = path === this.lastOpened;
    return h_flex().flex_1().min_w(0).overflow_hidden()
      .child(div().flex_none().child(name.slice(0, range[0])))
      .child(div().flex_none().rounded(3).bg(current ? t.accent : t.selection).text_color(current ? t.accent_foreground : t.foreground).child(name.slice(range[0], range[1])))
      .child(div().min_w(0).truncate().child(name.slice(range[1])));
  }

  // An icon button of the header's navigation (Up, Go to /) in the refresh button's style; without onClick dimmed.
```

- [ ] **Step 3: Highlight in rows**

Find:
```js
        .child(div().flex_1().min_w(0).truncate().child(entry.name))
        .when(Boolean(sizes), el => el.child(this.sizeCell(path, entry, sizes, font, t)))
```
Replace with:
```js
        .child(this.nameCell(entry.name, path, t))
        .when(Boolean(sizes), el => el.child(this.sizeCell(path, entry, sizes, font, t)))
```

- [ ] **Step 4: Render the slot, focus and cmd-f**

Find:
```js
    this.pollPick(cx);
    this.revealPending(cx);
```
Replace with:
```js
    this.pollPick(cx);
    this.pollGotoRow(cx);
    this.revealPending(cx);
```

Find:
```js
    const root = v_flex().id("files").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
```
Replace with:
```js
    const root = v_flex().id("files").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .track_focus(this.treeFocus)
      .on_key_down((e, cx) => { if (e.key === "f" && e.modifiers.platform && !this.file) { this.openRow("find", null, cx); cx.stop_propagation(); } })
```

Find:
```js
      // The tree stays mounted while a file is open, at zero height with a spacer of the same content height:
```
Replace with:
```js
      .when(Boolean(this.row) && !this.file, el => el.child(this.rowSlot(t)))
      // The tree stays mounted while a file is open, at zero height with a spacer of the same content height:
```

Find:
```js
      .child(v_flex().id("files-tree").min_h(0).overflow_y_scrollbar().track_scroll(this.treeScroll)
```
Replace with:
```js
      .child(v_flex().id("files-tree").min_h(0).overflow_y_scrollbar().track_scroll(this.treeScroll)
        .on_mouse_down("left", () => this.treeFocus.focus())
```

- [ ] **Step 5: Check and try it**

```bash
rsync -a /Users/danish/Repo/herdr-maroon/mods/my-filer-pro/ ~/.config/herdr-app/mods/my-filer-pro/
herdr-app check ~/.config/herdr-app/mods/my-filer-pro
```
Expected: `check passed`.

In the app:
1. Click a row in the tree, press ⌘F: the find row opens under the header with the cursor in it. Type `src`: matching names are marked, the first is selected, the counter shows `1/n`. ↓ / ⏎ step forward, ↑ / ⇧⏎ back, wrapping. A query without matches shows `0/0` in red. Esc closes the row; the selection stays.
2. Click 📁→: the go-to row opens with the shown root. Type `..` ⏎: the root moves up, ⌂ becomes active. Type `/nope` ⏎: "Not a folder: /nope" shows and the row stays.
3. Click ⌕: quick open opens.

- [ ] **Step 6: Commit**

```bash
cd /Users/danish/Repo/herdr-maroon
git add mods/my-filer-pro/main.js
git commit -m "Add Filer Pro's find row, go-to row and quick-open button"
```

---

### Task 8: Pane menu entry (`my-menu`)

**Files:**
- Modify: `mods/my-menu/main.js`

- [ ] **Step 1: Import `setShared`**

Find:
```js
import { run, props, closeOverlay, openOverlay, theme, keys, terminals, spaces, panes, exec, hc, notify } from "herdr";
```
Replace with:
```js
import { run, props, closeOverlay, openOverlay, theme, keys, terminals, spaces, panes, exec, hc, notify, setShared } from "herdr";
```

- [ ] **Step 2: The item**

Find:
```js
      const inTab = panes().some((pane) => pane.pane === tg.pane);
      return [
```
Replace with:
```js
      const inTab = panes().some((pane) => pane.pane === tg.pane);
      const cwd = panes().find((pane) => pane.pane === tg.pane)?.cwd;
      return [
```

Find:
```js
        ...(parent ? [[`Send back to ${parent.name || parent.address}`, "terminal.park", { terminal: term.address }]] : []),
```
Replace with:
```js
        ...(parent ? [[`Send back to ${parent.name || parent.address}`, "terminal.park", { terminal: term.address }]] : []),
        ...(term && cwd ? [["Go to Folder in Files…", "files-goto", { machine: term.address.includes("/") ? term.address.split("/")[0] : null, cwd }]] : []),
```

- [ ] **Step 3: Running it**

Find:
```js
    else run(it[1], it[2]);
```
Replace with:
```js
    // Files opens its go-to row with this folder (my-filer-pro pollGotoRow); mod commands carry no arguments, so the
    // folder goes through shared state and the command only puts the panel on screen.
    else if (it[1] === "files-goto") {
      setShared("filer-pro.goto-row", { id: Math.random().toString(36).slice(2, 10), machine: it[2].machine, cwd: it[2].cwd, at: Date.now() });
      run("my-filer-pro.show");
    }
    else run(it[1], it[2]);
```

- [ ] **Step 4: Check and try it**

```bash
rsync -a /Users/danish/Repo/herdr-maroon/mods/my-menu/ ~/.config/herdr-app/mods/my-menu/
herdr-app check ~/.config/herdr-app/mods/my-menu
```
Expected: `check passed`.

In the app: hide the Files panel, right-click a terminal pane, choose "Go to Folder in Files…": Files appears with the go-to row filled with that pane's folder and focused. Check that the menu still shows every item without clipping; if it clips, add `"height": 300` to the `overlay` object in `mods/my-menu/mod.json`.

- [ ] **Step 5: Commit**

```bash
cd /Users/danish/Repo/herdr-maroon
git add mods/my-menu/main.js
git commit -m "Add Go to Folder in Files to the pane menu"
```

---

### Task 9: Key binding, README and the live pass

**Files:**
- Modify: `~/.config/herdr-app/keys.json` (local only; the repository ships none)
- Modify: `README.md`

- [ ] **Step 1: Bind cmd-k**

In `~/.config/herdr-app/keys.json`, inside `"global"`, after the line `"cmd-shift-p": "app.palette",` add:

```json
    "cmd-k": "mod.open:my-filer-pro",
```

Run: `ls ~/.config/herdr-app/keys.error 2>/dev/null || echo no keys error`
Expected: `no keys error`.

- [ ] **Step 2: README**

In `README.md`, find:
```
- **Programs:** `git`, `gh` (signed in), `python3`, `jq`. `node` for Mermaid previews in `my-filer-pro`. Neovim 0.10+ and Rust (`rustup`) for `my-nvim`.
- **Keys:** no bindings ship. Bind `mod.open:agent-switcher` (for example `ctrl-tab`), `mod.open:agent-resume`, `mod.open:my-nvim` (for example `cmd-e`) and `my-nvim.pick` (for example `cmd-o`) in your `keys.json`. Inside the switcher, `agent-switcher.next` and `agent-switcher.prev` move.
```
Replace with:
```
- **Programs:** `git`, `gh` (signed in), `python3`, `jq`. `node` for Mermaid previews in `my-filer-pro`. `rg` and `fzf` make `my-filer-pro`'s quick open fast (it falls back to `git`, `find` and `grep`). Neovim 0.10+ and Rust (`rustup`) for `my-nvim`.
- **Keys:** no bindings ship. Bind `mod.open:agent-switcher` (for example `ctrl-tab`), `mod.open:agent-resume`, `mod.open:my-nvim` (for example `cmd-e`), `my-nvim.pick` (for example `cmd-o`) and `mod.open:my-filer-pro` (quick open, for example `cmd-k`) in your `keys.json`. Inside the switcher, `agent-switcher.next` and `agent-switcher.prev` move.
```

- [ ] **Step 3: Live pass**

With both mods synced (rsync commands under Working rules), go through each check and note the result:

1. ⌘K in a terminal: the popup opens near the top, the input has the cursor, recent files show. ⌘K again closes it.
2. In the popup, ↑ and ↓ move the selected card (they reach `on_key_down` through the input).
3. Typing over `~/Repo` updates without a visible pause.
4. ⏎ on a result opens it and the tree shows it selected and scrolled into view. Pick a file inside a collapsed folder three levels down: every folder above it expands.
5. Close Files, ⌘K, pick a file: Files appears and reveals it.
6. ⌘F after clicking the tree opens the find row.
7. The pane menu item works with Files hidden.
8. `herdr-app status` shows no mod errors.

If check 1 fails because the popup does not open at the top, the `overlay` keys in `mod.json` are not applied to `mod.open` for this mod: report it and keep the default placement. If check 2 fails, add `.on_key_down` handling inside `ui/quickopen.js` on the input's wrapper `h_flex` with the same `move` calls.

- [ ] **Step 4: Commit**

```bash
cd /Users/danish/Repo/herdr-maroon
git add README.md
git commit -m "Document Filer Pro's quick-open key and tools"
```
