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
assert.equal(resolveGoto("~", "/r", ""), null);
assert.equal(resolveGoto("~/x", "/r", undefined), null);
assert.equal(resolveGoto("../x", "/r/a", "/h"), "/r/x");
assert.equal(resolveGoto("sub/./y", "/r/", "/h"), "/r/sub/y");
assert.equal(resolveGoto("/..", "/r", "/h"), "/");
assert.equal(resolveGoto("  ", "/r", "/h"), null);

console.log("treefind ok");
