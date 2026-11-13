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
