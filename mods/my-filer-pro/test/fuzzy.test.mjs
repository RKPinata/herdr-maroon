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
