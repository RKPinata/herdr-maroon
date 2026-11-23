import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "../../mods/linear/linear.js";

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

test("an auth error drops the key so the next call reads it again", async () => {
  let reads = 0;
  const fetch = fakeFetch([{ status: 401, body: {} }, { body: { data: { a: 1 } } }]);
  const c = client(fetch, { readKey: async () => { reads++; return reads === 1 ? "old" : "new"; } });
  assert.equal((await c.query(DOC, {})).error.kind, "auth");
  assert.deepEqual((await c.query(DOC, {})).data, { a: 1 });
  assert.equal(fetch.calls[1].opts.headers.Authorization, "new");
});

test("a key reader that throws counts as no key", async () => {
  const c = client(fakeFetch([]), { readKey: async () => { throw new Error("security failed"); } });
  assert.equal((await c.query(DOC, {})).error.kind, "nokey");
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
