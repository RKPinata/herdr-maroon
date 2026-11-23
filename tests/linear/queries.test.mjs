import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSchema, parse, validate } from "graphql";
import * as Q from "../../mods/linear/queries.js";

const sdl = readFileSync(new URL("../../.cache/linear-schema.graphql", import.meta.url), "utf8");
const schema = buildSchema(sdl, { assumeValidSDL: true });

test("queries.js exports every document the mod uses", () => {
  assert.deepEqual(Object.keys(Q).sort(), [
    "BRANCH", "BY_NUMBER", "COMMENT_CREATE", "FAVORITES", "FAVORITE_CREATE", "FAVORITE_DELETE", "ISSUE_UPDATE",
    "MY_ISSUES", "PROJECTS", "PROJECT_ISSUES", "SEARCH", "TICKET", "VIEW_ISSUES",
  ]);
});

for (const [name, doc] of Object.entries(Q)) {
  test(`${name} validates against Linear's schema`, () => {
    assert.deepEqual(validate(schema, parse(doc)).map((e) => e.message), []);
  });
}
