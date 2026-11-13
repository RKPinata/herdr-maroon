// The find row's matching, Reveal's folder chain and the move-terminal row's path and folder completion. Pure.

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

// The absolute folder a move-terminal entry names: "/abs", "~", "~/x" (home), or a path relative to root. "." and ".."
// parts are resolved; a trailing slash is dropped. null for an empty entry.
export function resolveGoto(text, root, home) {
  const t = text.trim();
  if (!t) return null;
  if (!home && (t === "~" || t.startsWith("~/"))) return null;
  const base = t === "~" || t.startsWith("~/") ? home + t.slice(1) : t.startsWith("/") ? t : `${root.replace(/\/+$/, "")}/${t}`;
  const out = [];
  for (const part of base.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return "/" + out.join("/");
}

// The folder to list and the name typed so far in a go-to entry: "~/Re" -> { dir: "<home>/", prefix: "Re" }; an entry
// ending in "/" has the prefix "". null for an empty entry (or "~" without a home).
export function completionBase(text, root, home) {
  if (!text.trim()) return null;
  const cut = text.lastIndexOf("/") + 1;
  const dir = resolveGoto(cut ? text.slice(0, cut) : ".", root, home);
  return dir && { dir, prefix: text.slice(cut) };
}

// At most max (default 200) folder names for the typed prefix, ignoring case: names starting with it, then names containing it.
// Dot names only when the prefix starts with ".".
export function filterFolders(names, prefix, max = 200) {
  const p = prefix.toLowerCase(), shown = names.filter((n) => prefix.startsWith(".") || !n.startsWith("."));
  const starts = shown.filter((n) => n.toLowerCase().startsWith(p));
  return [...starts, ...shown.filter((n) => !starts.includes(n) && n.toLowerCase().includes(p))].slice(0, max);
}

// The entry with its last segment replaced by the folder name and a "/": "~/Re" + "Repo" -> "~/Repo/".
export function applyCompletion(text, name) {
  return `${text.slice(0, text.lastIndexOf("/") + 1)}${name}/`;
}
