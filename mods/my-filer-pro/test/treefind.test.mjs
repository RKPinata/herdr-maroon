// node test/treefind.test.mjs
import assert from "node:assert/strict";
import { findMatches, stepMatch, matchCount, ancestorsOf, matchRange, resolveGoto, completionBase, filterFolders, applyCompletion } from "../lib/treefind.js";

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

assert.deepEqual(completionBase("~/Repo/", "/r", "/h"), { dir: "/h/Repo", prefix: "" });
assert.deepEqual(completionBase("~/Re", "/r", "/h"), { dir: "/h", prefix: "Re" });
assert.deepEqual(completionBase("/Us", "/r", "/h"), { dir: "/", prefix: "Us" });
assert.deepEqual(completionBase("sub/x", "/r/", "/h"), { dir: "/r/sub", prefix: "x" });
assert.deepEqual(completionBase("x", "/r", "/h"), { dir: "/r", prefix: "x" });
assert.deepEqual(completionBase("../", "/r/a", "/h"), { dir: "/r", prefix: "" });
assert.equal(completionBase("", "/r", "/h"), null);
assert.equal(completionBase("~/x", "/r", ""), null);

const names = ["src", ".git", "Resources", "core", "docs", ".cache"];
assert.deepEqual(filterFolders(names, ""), ["src", "Resources", "core", "docs"]);
assert.deepEqual(filterFolders(names, "RE"), ["Resources", "core"]);
assert.deepEqual(filterFolders(names, "c"), ["core", "src", "Resources", "docs"]);
assert.deepEqual(filterFolders(names, "."), [".git", ".cache"]);
assert.deepEqual(filterFolders(names, ".c"), [".cache"]);
assert.deepEqual(filterFolders(names, "", 2), ["src", "Resources"]);

assert.equal(applyCompletion("~/Re", "Repo"), "~/Repo/");
assert.equal(applyCompletion("/a/b/", "c d"), "/a/b/c d/");
assert.equal(applyCompletion("x", "xyz"), "xyz/");

console.log("treefind ok");
