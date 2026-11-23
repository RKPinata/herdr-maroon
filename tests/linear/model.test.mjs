import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseSearch, groupIssues, statusOptions, buildThreads, relationsOf,
  ticketLine, commentText, startText, pushRecent, isPanelShown, ownPane, targetAgent, relativeTime, imagesAsLinks,
  favoriteTree, keepSpaces, oneLine,
} from "../../mods/linear/model.js";

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
test("buildThreads: a reply to a reply sits under the top-level comment", () => {
  const threads = buildThreads([
    c("t1", "2026-11-01T00:00:00Z"), c("r1", "2026-11-02T00:00:00Z", "t1"), c("r2", "2026-11-03T00:00:00Z", "r1"),
  ]);
  assert.deepEqual(threads.map((t) => [t.comment.id, t.replies.map((r) => r.id)]), [["t1", ["r1", "r2"]]]);
});
test("buildThreads: a parent cycle keeps every comment", () => {
  const threads = buildThreads([c("a", "2026-11-01T00:00:00Z", "b"), c("b", "2026-11-02T00:00:00Z", "a")]);
  const ids = threads.flatMap((t) => [t.comment.id, ...t.replies.map((r) => r.id)]).sort();
  assert.deepEqual(ids, ["a", "b"]);
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

test("imagesAsLinks: an image becomes a link with its alt text, or Image", () => {
  assert.equal(
    imagesAsLinks("See ![shot.png](https://uploads.linear.app/a.png) and ![](https://x.io/b.png \"t\")."),
    'See [shot.png](https://uploads.linear.app/a.png) and [Image](https://x.io/b.png "t").',
  );
  assert.equal(imagesAsLinks("[link](https://x.io) stays"), "[link](https://x.io) stays");
});
test("imagesAsLinks: a badge inside a link becomes one link to the link's target", () => {
  assert.equal(
    imagesAsLinks("[![build](https://ci.io/b.svg)](https://ci.io/run/1) ok"),
    "[build](https://ci.io/run/1) ok",
  );
});
test("imagesAsLinks: an escaped image stays as written", () => {
  assert.equal(imagesAsLinks("Type \\![x](y) for an image"), "Type \\![x](y) for an image");
});

test("relationsOf: a ticket related both ways shows once", () => {
  const i = (identifier) => ({ identifier, title: identifier, state: { type: "started" } });
  const r = relationsOf({
    relations: { nodes: [{ type: "related", relatedIssue: i("A-3") }] },
    inverseRelations: { nodes: [{ type: "related", issue: i("A-3") }, { type: "related", issue: i("A-6") }] },
  });
  assert.deepEqual(r.related.map((x) => x.identifier), ["A-3", "A-6"]);
});

const ag = (address, pane, space, tab, seq) => ({ address, pane, space, tab, seq, title: address });

test("targetAgent: with no pane focused, the last target if it still runs", () => {
  const agents = [ag("t1", "p1", "s1", "a", 1), ag("t2", "p2", "s1", "b", 2)];
  assert.equal(targetAgent(agents, { space: "s1", pane: null }, { last: "t2" })?.address, "t2");
  assert.equal(targetAgent(agents, { space: "s1", pane: null }, { last: "t9" }), null);
  assert.equal(targetAgent(agents, { space: "s1", pane: "p1" }, { last: "t2" })?.address, "t1");
  assert.equal(targetAgent(agents, { space: "s1", pane: "p9" }, { last: "t2" }), null);
});

test("targetAgent: a ticket pane targets the newest agent in its tab, else the newest in the space", () => {
  const agents = [
    ag("t1", "p1", "s1", "a", 5), ag("t2", "p2", "s1", "b", 9),
    ag("t3", "p3", "s2", "c", 99), ag("t4", "p4", "s1", "a", 7),
  ];
  const f = { space: "s1", pane: "p-mod" };
  assert.equal(targetAgent(agents, f, { ticket: "WEB-2", tab: "a" })?.address, "t4");
  assert.equal(targetAgent(agents, f, { ticket: "WEB-2", tab: "z" })?.address, "t2");
  assert.equal(targetAgent(agents, { space: "s3", pane: "p-mod" }, { ticket: "WEB-2", tab: "z" }), null);
  assert.equal(targetAgent(agents, null, { ticket: "WEB-2", tab: "a" }), null);
});

test("ownPane: the claimed linear pane, else the only linear pane in the tab", () => {
  const panes = [{ pane: "p1", tab: "a", mod: "linear" }, { pane: "p2", tab: "a", mod: null }, { pane: "p3", tab: "b", mod: "linear" }];
  assert.equal(ownPane(panes, "b", "p3"), "p3");
  assert.equal(ownPane(panes, "a", "p2"), "p1");
  assert.equal(ownPane(panes, "a", null), "p1");
  assert.equal(ownPane([...panes, { pane: "p4", tab: "a", mod: "linear" }], "a", "gone"), null);
  assert.equal(ownPane(panes, "z", null), null);
});

test("oneLine: an attachment subtitle as one plain line", () => {
  assert.equal(oneLine("```\nEmail: [a@b.io](mailto:a@b.io)\nFeedback Id:\n`x`"), "Email: a@b.io Feedback Id: x");
});

test("agent texts drop control characters but keep tabs and newlines", () => {
  const evil = { identifier: "WEB-1", title: "a\x1b[201~b\x07", url: "u" };
  assert.equal(ticketLine(evil), "Linear WEB-1: a[201~b u");
  assert.equal(commentText(evil, { body: "x\x1b[201~\ty\nz\x7f", url: "c", user: { name: "Q\x1b" } }),
    "Comment on WEB-1 from Q (c):\nx[201~\ty\nz");
  assert.equal(startText(evil).split("\n")[0], "Work on Linear issue WEB-1: a[201~b");
});

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
