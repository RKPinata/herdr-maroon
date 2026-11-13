// Pure functions for the Linear panel. No imports, so Node tests load this file directly.

export function parseSearch(input) {
  const text = input.trim();
  if (!text) return { kind: "empty", value: "" };
  const url = text.match(/linear\.app\/[^/]+\/issue\/([A-Za-z][A-Za-z0-9]{0,9}-\d{1,7})/);
  if (url) return { kind: "key", value: url[1].toUpperCase() };
  if (/^[A-Za-z][A-Za-z0-9]{0,9}-\d{1,7}$/.test(text)) return { kind: "key", value: text.toUpperCase() };
  if (/^\d{1,7}$/.test(text)) return { kind: "number", value: Number(text) };
  return { kind: "text", value: text };
}

const rankOf = (order) => (type) => {
  const i = order.indexOf(type);
  return i === -1 ? order.length : i;
};
const listRank = rankOf(["started", "unstarted", "backlog", "triage"]);
const statusRank = rankOf(["triage", "backlog", "unstarted", "started", "completed", "canceled"]);

// Priority 1 (urgent) to 4 (low) first; 0 (none) last.
const priorityKey = (p) => (p === 0 ? 5 : p);

const byRow = (a, b) =>
  priorityKey(a.priority) - priorityKey(b.priority) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt);

export function groupIssues(issues) {
  const groups = new Map();
  for (const issue of issues) {
    const { id, name, type, color } = issue.state;
    if (!groups.has(id)) groups.set(id, { id, name, type, color, position: issue.state.position, issues: [] });
    groups.get(id).issues.push(issue);
  }
  return [...groups.values()]
    .sort((a, b) => listRank(a.type) - listRank(b.type) || a.position - b.position)
    .map(({ position, issues: rows, ...group }) => ({ ...group, issues: rows.sort(byRow) }));
}

export function statusOptions(states) {
  return [...states].sort((a, b) => statusRank(a.type) - statusRank(b.type) || a.position - b.position);
}

// The top-level ancestor of `comment`; a missing parent or a parent cycle makes it its own root.
function threadRoot(comment, byId) {
  const seen = new Set([comment.id]);
  let cur = comment;
  while (cur.parent && byId.has(cur.parent.id)) {
    cur = byId.get(cur.parent.id);
    if (seen.has(cur.id)) return comment;
    seen.add(cur.id);
  }
  return cur;
}

export function buildThreads(comments) {
  const byId = new Map(comments.map((c) => [c.id, c]));
  const sorted = [...comments].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const threads = new Map();
  for (const c of sorted) if (threadRoot(c, byId) === c) threads.set(c.id, { comment: c, replies: [] });
  for (const c of sorted) {
    const root = threadRoot(c, byId);
    if (root !== c) threads.get(root.id).replies.push(c);
  }
  return [...threads.values()];
}

export function relationsOf(issue) {
  const out = { blocks: [], blockedBy: [], related: [], duplicateOf: [] };
  for (const r of issue.relations?.nodes ?? []) {
    if (r.type === "blocks") out.blocks.push(r.relatedIssue);
    else if (r.type === "related") out.related.push(r.relatedIssue);
    else if (r.type === "duplicate") out.duplicateOf.push(r.relatedIssue);
  }
  for (const r of issue.inverseRelations?.nodes ?? []) {
    if (r.type === "blocks") out.blockedBy.push(r.issue);
    else if (r.type === "related") out.related.push(r.issue);
  }
  // A relation made from either side shows once.
  out.related = out.related.filter((x, i, all) => all.findIndex((y) => y.identifier === x.identifier) === i);
  return out;
}

const linkTo = (_m, alt) => `[${alt.trim() || "Image"}](`;

// Markdown with each image turned into a link to it, and a linked badge into its link: the panel does not load images.
export const imagesAsLinks = (md) =>
  md.replace(/\[!\[([^\]]*)\]\([^)]*\)\]\(/g, linkTo).replace(/(?<!\\)!\[([^\]]*)\]\(/g, linkTo);

// Markdown as one line of plain text: links keep their text; code fences, backticks and line breaks go.
export const oneLine = (md) =>
  md.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/`/g, "").replace(/\s+/g, " ").trim();

// Text pasted into a terminal, without control characters other than tab and newline: an ESC could end the paste.
const plain = (text) => text.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");

export const ticketLine = (i) => plain(`Linear ${i.identifier}: ${i.title} ${i.url}`);

export const commentText = (i, c) =>
  plain(`Comment on ${i.identifier} from ${c.user?.name ?? "Integration"} (${c.url}):\n${c.body}`);

export const startText = (i) =>
  plain(`Work on Linear issue ${i.identifier}: ${i.title}\n${i.url}\n` +
  "Read the issue and its comments with the Linear MCP before you start.");

export function pushRecent(list, { identifier, title }, max) {
  return [{ identifier, title }, ...list.filter((r) => r.identifier !== identifier)].slice(0, max);
}

function findNode(node, id) {
  if (!node) return null;
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const hit = findNode(child, id);
    if (hit) return hit;
  }
  return null;
}

export function isPanelShown(root, id = "linear") {
  const panel = findNode(root, "panel");
  const body = findNode(root, "panel-body");
  return Boolean(panel && body && !panel.hidden && body.active === id);
}

// The pane of a ticket pane copy: `claimed` while it is a pane of mod `id`, else the only such pane in `tab`, else null.
// Herdr gives a mod pane no id of its own, so two ticket panes in one tab cannot tell which one they are.
export function ownPane(panes, tab, claimed, id = "linear") {
  if (claimed && panes.some((p) => p.pane === claimed && p.mod === id)) return claimed;
  const here = panes.filter((p) => p.tab === tab && p.mod === id);
  return here.length === 1 ? here[0].pane : null;
}

const newest = (agents) => agents.reduce((best, a) => (!best || a.seq > best.seq ? a : best), null);

// The agent that Send pastes into. In a ticket pane (`ticket` is set): the agent in the pane's tab `tab` that changed
// most recently, else the focused space's. Elsewhere: the agent in the focused pane, or with no pane focused, the
// agent at address `last` while it runs.
export function targetAgent(agents, focused, { ticket, tab, last } = {}) {
  if (!focused) return null;
  if (ticket) return newest(agents.filter((a) => a.tab === tab)) ?? newest(agents.filter((a) => a.space === focused.space));
  if (!focused.pane) return agents.find((a) => a.address === last) ?? null;
  return agents.find((a) => a.pane === focused.pane) ?? null;
}

// `when` is an ISO string or epoch ms.
export function relativeTime(when, now = Date.now()) {
  const sec = (now - (typeof when === "number" ? when : Date.parse(when))) / 1000;
  if (sec < 60) return "now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  const days = sec / 86400;
  if (days < 30) return `${Math.floor(days)}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

// Favorites as a tree: top-level nodes in sortOrder, each with `children` in sortOrder. A node whose parent is not
// in the list is top-level.
export function favoriteTree(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, { ...n, children: [] }]));
  const top = [];
  for (const n of byId.values()) {
    const parent = n.parent && byId.get(n.parent.id);
    (parent ? parent.children : top).push(n);
  }
  const sort = (list) => list.sort((a, b) => a.sortOrder - b.sortOrder).forEach((n) => sort(n.children));
  sort(top);
  return top;
}

// The saved per-space contexts whose space still exists. With no space ids known yet, all of them.
export const keepSpaces = (saved, ids) =>
  ids.length ? Object.fromEntries(Object.entries(saved).filter(([id]) => ids.includes(id))) : saved;
