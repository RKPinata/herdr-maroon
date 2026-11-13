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
assert.equal(fzfQuery("ma*in…"), "main");
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

// SEARCH_SCRIPT: a missing list file exits 4; a leading ~/ is the home folder.
assert.throws(() => sh(SEARCH_SCRIPT, join(dir, "nope.txt"), "a", "5", "a"), (e) => e.status === 4);
const home = mkdtempSync(join(tmpdir(), "finder-home-"));
mkdirSync(join(home, ".cache"), { recursive: true });
writeFileSync(join(home, ".cache/l.txt"), "src/main.js\n");
const inHome = (script, ...args) => execFileSync("sh", ["-c", script, "x", ...args], { env: { ...process.env, HOME: home } }).toString();
assert.equal(inHome(SEARCH_SCRIPT, "~/.cache/l.txt", "main", "5", "main").trim(), "src/main.js");
inHome(FILES_SCRIPT, dir, "0", "~/.cache/sub/l2.txt");
assert.deepEqual(readFileSync(join(home, ".cache/sub/l2.txt"), "utf8").trim().split("\n").sort(), ["src/main.js", "src/msg/index.vue"]);
// A file name with odd characters is listed as it is.
const odd = mkdtempSync(join(tmpdir(), "finder-odd-"));
writeFileSync(join(odd, "café.js"), "");
sh(FILES_SCRIPT, odd, "1", join(odd, "../odd-list.txt"));
assert.equal(readFileSync(join(odd, "../odd-list.txt"), "utf8").trim(), "café.js");

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

assert.equal(finder.files({ root: "/missing", on: null, hide: hideNone }).loading, false);
assert.equal(calls, 3); // the failed listing is not retried within 2 s
t += 2001;
await finder.files({ root: "/missing", on: null, hide: hideNone }).ready;
assert.equal(calls, 4);

// force lists a failed root again inside the back-off.
finder.files({ root: "/missing", on: null, hide: hideNone }, { force: true });
assert.equal(calls, 5);

// invalidate marks the entries of a machine whose root is the given one, below it or above it.
{
  const f = createFinder({
    exec: async () => ({ code: 0, stdout: "1 1 0\n", stderr: "" }),
    readTextFile: async () => null, writeTextFile: async () => {}, recentPath: "/x/r.json", localDir: "/x/finder", now: () => 0,
  });
  const entries = {};
  for (const root of ["/r/src", "/other"]) { entries[root] = f.files({ root, hide: hideNone }); await entries[root].ready; }
  f.invalidate({ root: "/r" });
  assert.equal(entries["/r/src"].stale, true);
  assert.equal(entries["/other"].stale, false);
  entries["/r/src"].stale = false;
  f.invalidate({ root: "/r/src/x" });
  assert.equal(entries["/r/src"].stale, true);
  assert.equal(entries["/other"].stale, false);
  entries["/r/src"].stale = false;
  f.invalidate({ root: "/r", on: "vps" });
  assert.equal(entries["/r/src"].stale, false);
}

// A machine's list file is in ~/.cache; exec output decides truncated; the hide setting is part of an entry; search exit 4 lists again.
{
  let n = 0, out = "5 100 0\n", searchCode = 0, clock = 0;
  const f = createFinder({
    exec: async (_c, args) => (args[2] === "search" ? { code: searchCode, stdout: "", stderr: "" } : (n++, { code: 0, stdout: out, stderr: "" })),
    readTextFile: async () => null, writeTextFile: async () => {}, recentPath: "/x/r.json", localDir: "/x/finder", now: () => clock,
  });
  const remote = f.files({ root: "/r", on: "vps", hide: hideNone });
  await remote.ready;
  assert.equal(remote.file, `~/.cache/filer-pro/finder/${listName("vps", "/r")}.txt`);
  assert.equal(remote.truncated, false);
  out = "5 7340032 1\n";
  f.invalidate({ root: "/r" });
  const cut = f.files({ root: "/r", hide: hideNone });
  await cut.ready;
  assert.equal(cut.truncated, true);
  assert.equal(n, 2);
  f.files({ root: "/r", hide: { hide_dotfiles: true } });
  assert.equal(n, 3);
  await f.files({ root: "/r", hide: { hide_dotfiles: true } }).ready;
  f.files({ root: "/r", hide: { hide_dotfiles: false } });
  assert.equal(n, 4);
  const e = f.files({ root: "/r", hide: { hide_dotfiles: false } });
  await e.ready;
  searchCode = 4;
  await assert.rejects(f.search(e, "abc", { hide: hideNone }), { message: "The file list is gone; list again" });
  f.files({ root: "/r", hide: { hide_dotfiles: false } });
  assert.equal(n, 5);
}

// A local entry is old after 60 s; a fifth root drops the oldest entry and removes its list file.
{
  let n = 0, clock = 0;
  const calls = [];
  const f = createFinder({
    exec: async (cmd, args, o) => { calls.push({ cmd, args, on: o?.on ?? null }); if (cmd === "sh") n++; return { code: 0, stdout: "1 1 0\n", stderr: "" }; },
    readTextFile: async () => null, writeTextFile: async () => {}, recentPath: "/x/r.json", localDir: "/x/finder", now: () => clock,
  });
  const first = f.files({ root: "/a", hide: hideNone });
  await first.ready;
  clock = 59999; f.files({ root: "/a", hide: hideNone });
  assert.equal(n, 1);
  clock = 60001; await f.files({ root: "/a", hide: hideNone }).ready;
  assert.equal(n, 2);
  for (const root of ["/b", "/c", "/d"]) await f.files({ root, hide: hideNone }).ready;
  assert.equal(calls.filter((c) => c.cmd === "rm").length, 0);
  await f.files({ root: "/e", hide: hideNone }).ready;
  assert.deepEqual(calls.filter((c) => c.cmd === "rm"), [{ cmd: "rm", args: ["-f", "--", first.file], on: null }]);
  // A machine's file goes through sh with the file as $1.
  const m = f.files({ root: "/m", on: "vps", hide: hideNone });
  await m.ready;
  for (const root of ["/n", "/o", "/p", "/q"]) await f.files({ root, on: "vps", hide: hideNone }).ready;
  const rm = calls.filter((c) => c.cmd === "sh" && c.args[2] === "x");
  assert.equal(rm.length, 1);
  assert.deepEqual([rm[0].on, rm[0].args[3]], ["vps", m.file]);
}

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
