// Quick open's file list and ranking. The list of a root is written once to a file on its machine; each query
// filters that file natively (fzf, else grep) and only the first FILTER_MAX hits are ranked here with VS Code's
// scorer (lib/fuzzy.js): mods run in QuickJS, where scoring a whole repository would take seconds. Pure apart from
// the functions passed to createFinder.
import { prepareQuery, scoreItem, compareItems } from "./fuzzy.js";
import { hiddenPath } from "./hidden.js";

// exec returns at most 8 MiB; the listing stops a little below that.
export const LIST_BYTES = 7340032;
export const FILTER_MAX = 200;
const RECENT_SHOWN = 10, RECENT_KEPT = 100, CACHE_MAX = 4, REMOTE_STALE_MS = 30000;

// `<root> <dots> <file>`: writes one relative path per line to <file> and prints "<lines> <bytes>". rg (respects
// .gitignore), else git ls-files in a repository, else find. <dots> 0 leaves out dot files and dot folders.
// node_modules and .git are skipped. Exit 2: the root cannot be entered.
export const FILES_SCRIPT = [
  'cd "$1" 2>/dev/null || exit 2',
  'mkdir -p "$(dirname "$3")" || exit 3',
  '{ if command -v rg >/dev/null 2>&1; then',
  '  if [ "$2" = 1 ]; then rg --files --hidden -g "!.git" -g "!node_modules"; else rg --files -g "!node_modules"; fi',
  'elif git rev-parse --is-inside-work-tree >/dev/null 2>&1; then git ls-files -co --exclude-standard',
  'else find . -name .git -prune -o -name node_modules -prune -o -type f -print | sed "s|^\\./||"',
  `fi; } | { if [ "$2" = 1 ]; then cat; else grep -v -E "(^|/)\\\\."; fi; } | head -c ${LIST_BYTES} > "$3.tmp" && mv "$3.tmp" "$3" || exit 3`,
  'printf "%s %s\\n" "$(wc -l < "$3")" "$(wc -c < "$3")"',
].join("\n");

// `<file> <fzf query> <limit> <grep pattern>`: the best <limit> lines of <file> for the query, best first (fzf), or
// the first <limit> lines matching the pattern where fzf is missing. Older fzf without --scheme runs without it.
export const SEARCH_SCRIPT = [
  'if command -v fzf >/dev/null 2>&1; then',
  '  { fzf --filter "$2" --scheme=path < "$1" 2>/dev/null || fzf --filter "$2" < "$1"; } | head -n "$3"',
  'else grep -i -E -- "$4" "$1" | head -n "$3"; fi',
].join("\n");

// "name:12" or "name:12:5" -> { text: "name", line: 12, column: 5 }; anything else keeps its text.
export function parseQuery(raw) {
  const m = /^(.*?):(\d+)(?::(\d+))?$/.exec(raw.trim());
  if (!m || !m[1]) return { text: raw.trim(), line: null, column: null };
  return { text: m[1], line: Number(m[2]), column: m[3] ? Number(m[3]) : null };
}

// The query for fzf: its operators (' ^ $ ! |) and quotes are dropped, so every word is a plain fuzzy term.
export const fzfQuery = (text) => text.replace(/['"^$!|\\]/g, "").trim().replace(/\s+/g, " ");

// The pattern for grep -i -E: the longest word's characters in order, anything between. Other words are checked by
// the scorer afterwards.
export function grepPattern(text) {
  const words = fzfQuery(text).split(" ").filter(Boolean);
  const word = words.sort((a, b) => b.length - a.length)[0] ?? "";
  return [...word].map((c) => c.replace(/[.*+?()[\]{}^$|\\/]/g, "\\$&")).join(".*");
}

function scored(path, query) {
  const cut = path.lastIndexOf("/"), label = path.slice(cut + 1), description = cut < 0 ? "" : path.slice(0, cut);
  return { path, label, description, score: scoreItem(label, description, path, query) };
}

const toItem = (s) => ({ path: s.path, label: s.label, dir: s.description, score: s.score.score, labelHits: s.score.labelMatch, dirHits: s.score.descriptionMatch });

// Ranks the filtered paths for raw query text. recent: relative paths newest first, ranked in their own group (at
// most 10) and left out of files. hide: the panel's hide settings (system files are dropped here).
// -> { recent, files, line, column }; Item: { path, label, dir, score, labelHits, dirHits }, hits are [start, end).
export function rankPaths(paths, raw, { recent = [], hide = null } = {}) {
  const { text, line, column } = parseQuery(raw);
  const query = prepareQuery(text);
  const visible = (p) => !hiddenPath(p, hide);
  if (!query.normalized) return { recent: recent.filter(visible).slice(0, RECENT_SHOWN).map((p) => toItem(scored(p, query))), files: [], line, column };
  const rank = (list) => list.filter(visible).map((p) => scored(p, query)).filter((s) => s.score.score > 0).sort((a, b) => compareItems(a, b, query));
  const shownRecent = rank(recent).slice(0, RECENT_SHOWN);
  const shown = new Set(shownRecent.map((s) => s.path));
  return { recent: shownRecent.map(toItem), files: rank(paths.filter((p) => !shown.has(p))).map(toItem), line, column };
}

// The recent list as stored in recent.json: { v: 1, items: [{ on, path, at }] }, absolute paths, newest first.
export function addRecent(doc, { on, path, at }) {
  const items = (doc?.v === 1 && Array.isArray(doc.items) ? doc.items : []).filter((r) => !(r.path === path && (r.on ?? null) === (on ?? null)));
  return { v: 1, items: [{ on: on ?? null, path, at }, ...items].slice(0, RECENT_KEPT) };
}

// The relative paths of the recent files below root on machine on, newest first.
export function recentUnder(doc, on, root) {
  const base = root.replace(/\/+$/, "") + "/";
  return (doc?.v === 1 && Array.isArray(doc.items) ? doc.items : [])
    .filter((r) => (r.on ?? null) === (on ?? null) && typeof r.path === "string" && r.path.startsWith(base))
    .map((r) => r.path.slice(base.length));
}

// A short stable name for a root's list file.
export function listName(on, root) {
  let h = 5381;
  const s = `${on ?? ""}\0${root}`;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

// deps: { exec, readTextFile, writeTextFile, recentPath, localDir, now }. localDir holds this computer's list files;
// a machine keeps its own in /tmp.
export function createFinder({ exec, readTextFile, writeTextFile, recentPath, localDir, now }) {
  const cache = new Map(); // key -> entry, oldest first

  // The cache entry for a root: { state: "loading" | "ready" | "error", file, count, truncated, error, ready: Promise }.
  // A stale, failed or (machine) 30 s old entry is listed again; a stale one keeps serving its old file meanwhile.
  function files({ root, on = null, hide }) {
    const name = listName(on, root), key = name;
    let entry = cache.get(key);
    const old = entry && (entry.stale || entry.state === "error" || (on && now() - entry.at > REMOTE_STALE_MS));
    if (entry && (!old || entry.loading)) { cache.delete(key); cache.set(key, entry); return entry; }
    entry = entry ?? { state: "loading", file: on ? `/tmp/filer-pro-finder-${name}.txt` : `${localDir}/${name}.txt`, count: 0, truncated: false, error: null, at: 0 };
    entry.stale = false;
    entry.loading = true;
    entry.ready = exec("sh", ["-c", FILES_SCRIPT, "files", root, hide?.hide_dotfiles === true ? "0" : "1", entry.file], { on, timeout: 15000 })
      .then((r) => {
        if (r.code !== 0) throw new Error(r.code === 2 ? `Cannot open ${root}` : (r.stderr.trim() || "Cannot list files"));
        const [count, bytes] = r.stdout.trim().split(/\s+/).map(Number);
        entry.count = count || 0;
        entry.truncated = bytes >= LIST_BYTES;
        entry.state = "ready"; entry.error = null;
      })
      .catch((e) => { if (entry.state !== "ready") entry.state = "error"; entry.error = String(e?.message ?? e); })
      .finally(() => { entry.loading = false; entry.at = now(); });
    cache.delete(key);
    cache.set(key, entry);
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    return entry;
  }

  // A watch batch under root: the next files() call lists again.
  function invalidate({ root, on = null }) {
    const entry = cache.get(listName(on, root));
    if (entry) entry.stale = true;
  }

  // The ranked result for raw query text on a ready entry (rankPaths). Rejects when the filter cannot run.
  async function search(entry, raw, { on = null, recent = [], hide = null } = {}) {
    const { text } = parseQuery(raw);
    const q = fzfQuery(text);
    if (!q) return rankPaths([], raw, { recent, hide });
    const r = await exec("sh", ["-c", SEARCH_SCRIPT, "search", entry.file, q, String(FILTER_MAX), grepPattern(text) || "."], { on, timeout: 10000 });
    if (r.code !== 0) throw new Error(r.stderr.trim() || "Search failed");
    return rankPaths(r.stdout.split("\n").filter(Boolean), raw, { recent, hide });
  }

  async function readRecent() {
    const text = await readTextFile(recentPath).catch(() => null);
    try { return { text, doc: text ? JSON.parse(text) : null }; } catch { return { text, doc: null }; }
  }

  // Adds an opened file (absolute path) to recent.json. A write that loses a race reads again once, then gives up.
  async function recordOpen({ on = null, path }) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const { text, doc } = await readRecent();
      try { await writeTextFile(recentPath, JSON.stringify(addRecent(doc, { on, path, at: now() })), text); return; } catch {}
    }
  }

  return { files, invalidate, search, readRecent, recordOpen };
}

// The modal's selection after a move of delta rows, skipping group headers ({ kind: "head" }). A move by one
// wraps; a bigger move (a page) stops at the ends. 0 when there is nothing to select.
export function stepRow(rows, at, delta) {
  const items = [];
  rows.forEach((r, i) => { if (r.kind !== "head") items.push(i); });
  if (!items.length) return 0;
  const pos = Math.max(0, items.indexOf(at));
  const next = Math.abs(delta) === 1 ? (pos + delta + items.length) % items.length : Math.max(0, Math.min(items.length - 1, pos + delta));
  return items[next];
}
