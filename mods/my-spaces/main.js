// Workspace spaces: stable colored avatars, worktrees under their checkout,
// grouped by machine when more than one is known. After a space's name, the repo
// its first terminal is in now, only where unusual: branch, then what waits on you
// there (uncommitted files, commits to push or pull, the branch's pull request;
// on a repo's first row its open pull requests, issues and stars), as many as fit
// beside the name; hovering the row says all of it. Agent state lives in the agents
// list, not here. Click to switch, right-click for its menu, drag to reorder. Below
// this computer's spaces, folded, the repos in the projects folder that have no
// space here ("Not open"): a click opens one. The block is as tall as its list, up
// to half its column.

import { View, div, svg } from "gpui-kit";
import { boxy, card } from "./boxy.js";
import { v_flex, h_flex } from "gpui-base";
import { spaces, machines, panes, run, openOverlay, exec, hc, theme, shared, setShared, watchFolder, window, layout, notify, props, home } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The nodes from `node` down to the first that `test` accepts, else null.
function path(node, test) {
  if (!node) return null;
  if (test(node)) return [node];
  for (const child of node.children ?? []) {
    const found = path(child, test);
    if (found) return [node, ...found];
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
const rowHeight = ({ tree }) => (tree ? 28 : 30);
const RAIL_CELL = 32;
const railCell = (el) => h_flex().flex_none().justify_center().child(el);
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;
// The least time between two looks at one place, however often it changes.
const GAP = 5000;
// How often each GitHub repo's pull requests, issues and stars are asked for.
// Nothing is fetched: ↓ counts the commits known as of the repo's last fetch.
const REMOTE = 300000;
// Push and pull never ask for a password: they fail instead.
const QUIET = ["GIT_TERMINAL_PROMPT=0", "GIT_SSH_COMMAND=ssh -o BatchMode=yes"];
// The projects folder: the layout block's `projects` prop, else this.
const PROJECTS = "~/Repo";
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
// This mod's folder, for its own icons.
const HERE = "mods/my-spaces";
// The layout block that shows this mod.
const MINE = (n) => n.content?.mod === HERE.slice(5);
// Above and below the list: the "Spaces" heading and the list's bottom padding.
const FRAME = 31 + 14;
// Across a row, besides its own content: the list's and the row's side padding,
// and the scrollbar.
const CHROME = 16 + 16 + 10;
// The narrowest a long name gets (about ten letters), however many counts wait.
const NAME_MIN = 72;
// Rough text widths, px per character: a name, a count.
const NAME_CHAR = 7.2, COUNT_CHAR = 6.6;

// The counts that fit in `room` px, in their order. Each has a `width` and a
// `rank`, and 5 px between two; while they overflow, the lowest rank goes.
export function fits(counts, room) {
  const kept = [...counts];
  const need = () => kept.reduce((n, c) => n + c.width + 5, -5);
  while (kept.length && need() > room) kept.splice(kept.indexOf(kept.reduce((a, b) => (b.rank < a.rank ? b : a))), 1);
  return kept;
}

// Check conclusions (or commit status states) that fail a pull request.
const FAILED = new Set(["FAILURE", "ERROR", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"]);

// What a pull request waits on, the most pressing: failing checks, changes asked
// for, still a draft, approved, else just open. `p`: one of `gh pr list`'s, its
// `statusCheckRollup` each check's conclusion or state.
export function prState(p) {
  if ((p.statusCheckRollup ?? []).some((c) => FAILED.has(c))) return "failing";
  if (p.reviewDecision === "CHANGES_REQUESTED") return "changes";
  if (p.isDraft) return "draft";
  if (p.reviewDecision === "APPROVED") return "approved";
  return "open";
}

// A branch's pull request chip by its state: theme color, mark after the
// number, and the words for the tooltip.
const PR_LOOK = {
  failing: ["ansi1", " \u2717", "CI failing"],
  changes: ["ansi3", " \u00b1", "changes requested"],
  draft: ["dim", "", "draft"],
  approved: ["ansi2", " \u2713", "approved"],
  open: ["muted", "", "open"],
};

// What a stored color name looks like on an avatar (the same in every mod
// that draws space avatars): one strong color per hue, light and dark alike.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

// A space speaks up only when something in it needs you.
export function glyph(status) {
  return status === "blocked" || status === "done" ? "●" : "·";
}

export function tone(t, status) {
  return t[status] ?? t.unknown;
}

export default class Spaces extends View {
  init(_props, cx) {
    this.git = {}; // where() -> { name, branch, ahead, behind, dirty, slug, top, repo, linked }, null: not a repo
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Set(); // local repos' git folders
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.pressed = null;
    this.over = null;
    this.machines = [];
    this.reconnecting = JSON.parse(localStorage.getItem("machines.reconnecting") ?? "{}");
    for (const state of Object.values(this.reconnecting)) state.busy = false;
    this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]"));
    this.inView = new Set(); // where()s the list shows
    this.projects = []; // repo folders in the projects folder
    this.closedOpen = localStorage.getItem("projects.notOpen") === "true";
    this.prs = {}; // "owner/repo" -> { open, review }: open pull requests, those asking you
    this.branchPrs = {}; // "owner/repo" -> branch -> { number, state }: that branch's open pull request
    this.write = {}; // "owner/repo" -> you can push there
    this.repoInfo = {}; // "owner/repo" -> { stars, issues }: open issues
    this.remoteAt = {}; // "owner/repo" -> when GitHub was last asked about it
    this.me = null; // your GitHub login
    this.meAt = 0;
    this.armed = null; // ↑ clicked once: { repo }; a second click pushes
    this.syncing = new Set(); // repos a push or pull runs in
    this.tallies = {}; // badge id -> { text, prev, b }: its count, the one before, which layer shows it
    this.hovered = null; // the row under the pointer
    this.listHeight = 0; // the list's height, without the heading
    this.fitted = [Number(localStorage.getItem("fit.px")) || null]; // heights `fit` gave this block
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    this.scanProjects(cx);
    cx.timer.every(15000, (cx) => this.refreshRemote(cx));
    // Refresh only when git's answer could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
  }

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size || this.pending.size) this.refreshGit(due, cx);
    if (window().active && now - this.scannedAt > FALLBACK) this.scanProjects(cx);
    if (sp.some((s) => !this.shown.has(s.id)) || this.orderingDue(now)) cx.notify();
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due. Not open
  // repos are in view only while that section is unfolded.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const closed = this.closedOpen && !narrow() ? this.notOpen(sp, ps).map((d) => JSON.stringify([null, d])) : [];
    const keys = this.inView = new Set([...Object.values(at).filter((k) => JSON.parse(k)[1]), ...closed]);
    const due = new Set([...keys].filter((k) => !(k in this.checked)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch {}
      cx.notify();
    });
  }

  rebuilt(machine) {
    return machine?.state === "unreachable" && /^a different core answers there \("[^"]+"\)$/.test(machine.why ?? "");
  }

  reconnect(machine, cx) {
    const name = machine.name;
    if (this.reconnecting[name]?.busy) return;
    const state = this.reconnecting[name] ??= { machine, removed: false };
    state.busy = true;
    state.error = null;
    localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
    cx.notify();
    cx.spawn(async cx => {
      try {
        const ask = async args => {
          const r = await hc([...args, "--json"]);
          if (r.code !== 0) {
            let error;
            try { error = JSON.parse(r.stdout || r.stderr).error?.message; } catch {}
            throw new Error(error || r.stderr || r.stdout || "Couldn't connect.");
          }
        };
        if (!state.removed) {
          await ask(["machine", "rm", name]);
          state.removed = true;
          localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
        }
        const args = ["machine", "add"];
        if (machine.via) args.push("--via", machine.target);
        else args.push(machine.target);
        args.push("--name", name);
        if (machine.session) args.push("--session", machine.session);
        if (machine.temporary) args.push("--temp");
        await ask(args);
        this.folded.delete(name);
        localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
        delete this.reconnecting[name];
      } catch (e) {
        state.error = String(e.message ?? e);
        state.busy = false;
      }
      localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
      this.refreshMachines(cx);
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile,
  // and not again within GAP of its last (checkNew asks for what still waits).
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    const now = Date.now();
    const ready = [...this.pending].filter((k) => now - (this.checked[k] ?? 0) >= GAP);
    if (!ready.length) return;
    for (const k of ready) this.pending.delete(k);
    this.refreshing = true;
    cx.spawn(async (cx) => {
      // A few at a time: unfolding Not open asks for dozens at once.
      for (let i = 0; i < ready.length; i += 6) await Promise.all(ready.slice(i, i + 6).map((key) => this.check(key, cx)));
      const used = new Set(Object.values(this.git).filter(Boolean).map((g) => JSON.parse(g.repo)).filter(([on]) => !on).map(([, repo]) => repo));
      for (const repo of this.watching) if (!used.has(repo)) this.watching.delete(repo);
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: branch, ahead/behind, uncommitted files, its repo and its
  // GitHub name (origin's first).
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // Two reads: a folder name may itself contain a newline.
      const [r, common] = await Promise.all([
        exec("git", ["rev-parse", "--path-format=absolute", "--show-toplevel"], { cwd, on }),
        exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on }),
      ]);
      if (r.code !== 0 || common.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.code !== 0 ? r.stderr : common.stderr)) this.unsure.add(key);
        this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = r.stdout.replace(/\n$/, ""), repo = common.stdout.replace(/\n$/, "");
      // No optional locks, no fsmonitor: status writes nothing under .git, so it
      // doesn't wake watch(). Untracked files count as the repo's config says.
      const [status, remotes] = await Promise.all([
        exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v2", "--branch"], { cwd, on }),
        exec("git", ["remote", "-v"], { cwd, on }),
      ]);
      if (status.code !== 0) throw new Error(status.stderr);
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const info = { name, branch: "(detached)", ahead: 0, behind: 0, dirty: 0, slug: null, top, repo: JSON.stringify([on, repo]), linked: repo !== `${top}/.git` };
      for (const line of status.stdout.split("\n")) {
        if (line.startsWith("# branch.head ")) info.branch = line.slice(14);
        else if (line.startsWith("# branch.ab ")) [info.ahead, info.behind] = line.slice(12).split(" ").map((n) => Math.abs(parseInt(n, 10)) || 0);
        else if (line && !line.startsWith("#")) info.dirty++;
      }
      // A GitHub host, or an ssh alias for one ("github-work").
      info.slug = remotes.stdout.split("\n").map((l) => l.split(/\s+/)).filter(([, , kind]) => kind === "(fetch)")
        .sort(([a], [b]) => Number(b === "origin") - Number(a === "origin"))
        .map(([, url]) => /github[\w.-]*[:/]+([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(url)?.[1]).find(Boolean) ?? null;
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    this.watching.add(repo);
    cx.spawn(async (cx) => {
      try {
        while (this.watching.has(repo)) {
          await watchFolder(repo);
          const mine = JSON.stringify([null, repo]);
          if (this.watching.has(repo)) this.refreshGit(Object.keys(this.git).filter((k) => this.git[k]?.repo === mine), cx);
        }
      } catch { this.watching.delete(repo); }
    });
  }

  // The repos right in the projects folder: each folder there with a .git
  // folder (a worktree's .git is a file).
  scanProjects(cx) {
    if (this.scanning) return;
    this.scanning = true;
    this.scannedAt = Date.now();
    cx.spawn(async (cx) => {
      try {
        const dir = String(props()?.projects ?? PROJECTS).replace(/^~(?=\/|$)/, home()).replace(/\/+$/, "");
        // A folder it can't read makes find fail but still list the rest.
        const r = await exec("find", [dir, "-mindepth", "2", "-maxdepth", "2", "-name", ".git", "-type", "d"]);
        const found = r.stdout.split("\n").filter(Boolean).map((p) => p.slice(0, -5))
          .sort((a, b) => base(a).localeCompare(base(b), undefined, { sensitivity: "base" }));
        if (JSON.stringify(found) !== JSON.stringify(this.projects)) {
          this.projects = found;
          cx.notify();
        }
      } catch {}
      this.scanning = false;
    });
  }

  // Projects with no space on this computer: none whose folder or first
  // terminal is in it, and none in one of its worktrees.
  notOpen(sp, ps) {
    const local = sp.filter((s) => !s.machine);
    const dirs = local.flatMap((s) => [s.folder, place(s, ps)]).filter(Boolean).map((d) => d.replace(/\/+$/, ""));
    const repos = new Set(local.map((s) => this.git[where(s, ps)]?.repo).filter(Boolean));
    return this.projects.filter((d) => !repos.has(JSON.stringify([null, `${d}/.git`])) && !dirs.some((f) => f === d || f.startsWith(d + "/")));
  }

  // GitHub, for each repo in view at most every REMOTE: its open pull requests
  // (and which branch each is from, and its state), open issues and stars, and
  // whether you can push there. Without gh, a login or the network, the badges
  // stay as they were.
  refreshRemote(cx) {
    if (this.remoteBusy) return;
    const now = Date.now();
    const slugs = [...new Set([...this.inView].map((k) => this.git[k]?.slug).filter(Boolean))]
      .filter((s) => now - (this.remoteAt[s] ?? 0) >= REMOTE);
    if (!slugs.length) return;
    this.remoteBusy = true;
    cx.spawn(async (cx) => {
      if (!this.me && now - this.meAt >= REMOTE) {
        this.meAt = now;
        const r = await exec("gh", ["api", "user", "--jq", ".login"]).catch(() => null);
        this.me = (r?.code === 0 && r.stdout.trim()) || null;
      }
      for (const slug of slugs) {
        this.remoteAt[slug] = Date.now();
        try {
          const v = await exec("gh", ["repo", "view", slug, "--json", "viewerPermission,stargazerCount,issues",
            "--jq", "[.viewerPermission, .stargazerCount, .issues.totalCount] | @tsv"]);
          if (v.code === 0) {
            const [perm, stars, issues] = v.stdout.trim().split("\t");
            this.write[slug] = ["ADMIN", "MAINTAIN", "WRITE"].includes(perm);
            this.repoInfo[slug] = { stars: Number(stars) || 0, issues: Number(issues) || 0 };
          }
          // Each check comes back as its conclusion, or a commit status's state.
          const r = await exec("gh", ["pr", "list", "--repo", slug, "--state", "open", "--limit", "100",
            "--json", "number,author,reviewRequests,headRefName,isCrossRepository,isDraft,reviewDecision,statusCheckRollup",
            "--jq", "map(.statusCheckRollup |= [.[]? | .conclusion // .state])"]);
          if (r.code === 0) {
            const all = JSON.parse(r.stdout);
            const asks = (p) => (p.reviewRequests ?? []).some((q) => q.login === this.me);
            // Someone else's repo you only cloned: just the ones that involve you.
            const list = all.filter((p) => this.write[slug] !== false || p.author?.login === this.me || asks(p));
            this.prs[slug] = { open: list.length, review: list.filter(asks).length };
            // A fork's branch can share a name with one here.
            this.branchPrs[slug] = Object.fromEntries(all.filter((p) => !p.isCrossRepository).reverse()
              .map((p) => [p.headRefName, { number: p.number, state: prState(p) }]));
          }
        } catch {}
        cx.notify();
      }
      this.remoteBusy = false;
    });
  }

  // A repo you can push to: your own, or your team's off its main branch (a
  // shared main takes pull requests).
  canPush(g) {
    if (g.slug && this.write[g.slug] === false) return false;
    return Boolean(this.me && g.slug?.split("/")[0] === this.me) || !["main", "master"].includes(g.branch);
  }

  // ↑ asks for a second click within 4 s, then pushes.
  push(g, cx) {
    if (this.armed?.repo !== g.repo) {
      this.armed = { repo: g.repo };
      cx.timer.after(4000, (cx) => { if (this.armed?.repo === g.repo) { this.armed = null; cx.notify(); } });
      return cx.notify();
    }
    this.armed = null;
    this.gitOp(g, ["push", "--quiet"], `Pushed ${g.name}`, cx);
  }

  // Runs git in the repo, says how it went, and looks at the repo again.
  gitOp(g, args, done, cx) {
    this.syncing.add(g.repo);
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await exec("env", [...QUIET, "git", ...args], { cwd: g.top, on: JSON.parse(g.repo)[0], timeout: 120000 })
        .catch((e) => ({ code: 1, stdout: "", stderr: String(e?.message ?? e) }));
      const why = (r.stderr || r.stdout).trim().split("\n").filter(Boolean).pop() ?? "";
      notify(r.code === 0 ? { title: done, level: "success" } : { title: `Couldn't ${args[0]} ${g.name}`, body: why, level: "error" });
      this.syncing.delete(g.repo);
      const mine = Object.keys(this.git).filter((k) => this.git[k]?.repo === g.repo);
      for (const k of mine) this.checked[k] = 0;
      this.refreshGit(mine, cx);
      cx.notify();
    });
  }

  menu(w) {
    // A popup is as tall as its items; height is only the most.
    openOverlay({ mod: "my-menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: w.id } } });
  }

  orderingDue(now) {
    return this.ordering && now - this.ordering.at >= 1000
      && this.ordering.machines.every(name => machines().some(m => m.name === name && m.layout === "ready"));
  }

  // Spaces in order, each worktree space moved under its main checkout's.
  ordered() {
    const sp = spaces(), ps = panes();
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null }));
    const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
    const nested = (r) => r.g?.linked && mains.has(r.g.repo);
    const out = [];
    const placed = new Set(); // repos whose worktrees are listed (under the first of its spaces)
    for (const r of list) {
      if (nested(r)) continue;
      out.push({ ...r, tree: null });
      if (!r.g || r.g.linked || placed.has(r.g.repo)) continue;
      placed.add(r.g.repo);
      const kids = list.filter((k) => nested(k) && k.g.repo === r.g.repo);
      kids.forEach((k, n) => out.push({ ...k, tree: n === kids.length - 1 ? "└─" : "├─" }));
    }
    // Simulate the batch so later indexes include earlier moves. An attempted
    // write can lose a sync conflict: allow the echo to settle before retrying.
    const order = sp.map(w => w.id);
    const target = out.map(r => r.w.id);
    const key = JSON.stringify([order, target, machines()]);
    if (order.every((id, i) => id === target[i])) {
      this.ordering = null;
    } else if (this.ordering?.key !== key || this.orderingDue(Date.now())) {
      const moved = new Set();
      this.ordering = { key, at: Date.now(), machines: [] };
      for (let i = 0; i < out.length; i++) {
        const from = order.indexOf(out[i].w.id);
        if (from === i) continue;
        run("space.move", { id: out[i].w.id, index: i + 1 });
        moved.add(out[i].w.machine ?? null);
        order.splice(i, 0, order.splice(from, 1)[0]);
      }
      this.ordering.machines = [...moved];
    }
    return out.filter(r => this.shown.has(r.w.id));
  }

  // The rows, under a header per machine once one isn't this computer.
  grouped(t, collapsed) {
    this.seen = new Set(); // GitHub repos a row drawn so far carries the counts of
    const rows = this.ordered();
    const draw = (r) => (collapsed ? this.compact(r, t) : this.row(r, t));
    const remote = [...new Set([...rows.map(r => r.w.machine).filter(Boolean), ...this.machines.map(m => m.name), ...Object.keys(this.reconnecting)])].sort();
    const loading = m => {
      const layout = machines().find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || spaces().some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => h_flex().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 0 : 8).items_center().when(collapsed, el => el.justify_center()).text_size(12).text_color(t.dim).child(collapsed ? "…" : "Loading…");
    const closed = collapsed ? [] : this.notOpenRows(t);
    if (!remote.length) return loading(null) && !rows.length ? [loadingRow(null)] : [...rows.map(draw), ...closed];
    const machineNames = [null, ...remote];
    return machineNames.flatMap((m) => {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const repair = this.reconnecting[m];
      const machine = this.machines.find(k => k.name === m) ?? repair?.machine;
      const connected = !m || machine?.state === "connected";
      const rebuilt = this.rebuilt(machine) || !!repair;
      const login = machine?.state === "needs_login" ? `hc machine login ${m}` : null;
      const folded = this.folded.has(m);
      const icon = svg(`mods/my-workspace-chrome/${m ? "server" : "monitor"}.svg`).size(13).flex_none();
      const badge = div().absolute().right(-3).bottom(-2).size(6).rounded(3).border_1().border_color(t.chrome).bg(connected ? t.ansi2 : t.dim);
      const head = h_flex().id(`machine-${m ?? "local"}`).h(26).flex_none().px(collapsed ? 0 : 8).gap(7).items_center().text_size(11).text_color(t.dim)
        .when(collapsed, el => el.mt(4).w(RAIL_CELL).justify_center().rounded(6).tooltip(login ? `${m} needs a login: run ${login}. Click for Copy.` : m ? `${m} · ${connected ? "connected" : (machine?.state ?? "asleep").replace(/_/g, " ")}` : "This computer"))
        .cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => {
          if (collapsed && login) { run("app.settings", { section: "machines" }); return; }
          folded ? this.folded.delete(m) : this.folded.add(m);
          localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
          cx.notify();
        })
        .when(!collapsed, el => el.child(icon))
        .when(collapsed, el => el.child(div().relative().flex_none().child(icon).when(Boolean(m), el => el.child(badge))))
        .when(!collapsed, el => el.child(div().flex_1().truncate().child(m ?? "This computer"))
          .when(!connected && !rebuilt && !login, el => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
          .when(rebuilt, el => el.child(h_flex().flex_none().gap(3).items_center()
            .child(div().max_w(140).truncate().child(repair?.error || "rebuilt ·"))
            .child(div().id(`machine-connect-${m}`).text_color(repair?.error ? t.blocked : t.muted)
              .hover(s => s.text_color(t.foreground))
              .tooltip(repair?.error || "This machine was rebuilt or replaced. Click to connect to the new one.")
              .on_click((_e, cx) => { cx.stop_propagation(); this.reconnect(machine, cx); })
              .child(repair?.busy ? "Connecting…" : "Connect"))))
          .when(connected, el => el.child(div().id(`machine-add-${m ?? "local"}`).flex_none().px(4).rounded(4).hover(s => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", { machine: m ?? "" }); }).child("+")))
          .child(div().size(6).rounded(3).flex_none().bg(connected ? t.ansi2 : t.dim))
          .child(svg(`mods/my-workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none()));
      const empty = !collapsed ? boxy(t, `machine-new-${m ?? "local"}`, [svg("mods/my-workspace-chrome/plus.svg").size(12), "New space there"],
        { onClick: () => run("space.new", { machine: m ?? "" }), h: 20 }).self_start().mx(8).my(2)
        : h_flex().id(`machine-new-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 0 : 8).gap(7).items_center().rounded(7)
        .text_size(12).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("space.new", { machine: m ?? "" }))
        .when(collapsed, el => el.w(RAIL_CELL).rounded(6).justify_center().tooltip(`New space on ${m ?? "this computer"}`)
          .child(h_flex().size(18).rounded(5).border_1().border_color(t.dim).items_center().justify_center()
            .child(svg("mods/my-workspace-chrome/plus.svg").size(10))));
      if (!collapsed && rebuilt) return [head];
      const cell = collapsed ? railCell : (el) => el;
      const guidance = !collapsed && login ? [v_flex().px(8).pb(6).gap(3).flex_none()
        .child(div().text_size(11).text_color(t.blocked).child("needs a login: run"))
        .child(h_flex().gap(5).items_center()
          .child(div().flex_1().min_w(0).truncate().tooltip(login).text_size(11).text_color(t.muted).child(login))
          .child(boxy(t, `machine-login-copy-${m}`, this.copiedLogin === login ? "Copied" : "Copy", { h: 18, px: 5, size: 11,
            onClick: (_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(login); this.copiedLogin = login; cx.notify(); } })))] : [];
      return [cell(head), ...guidance, ...(folded ? [] : [...(mine.length ? mine.map(draw) : [loading(m) ? loadingRow(m) : cell(empty)]), ...(m ? [] : closed)])];
    });
  }

  // Only what's unusual, after the name: "herdr \u00b7 spike \u21912 \u21931". The repo or
  // branch goes when the name already says it (a worktree is named after its branch),
  // and master/main go: nearly every space is on one. The counts that don't fit
  // beside a name of NAME_MIN give way (see `fits`), and the place goes before it
  // shows only a few letters. `lead`: the row's width before the name; `id`: the
  // row's. Gives the row's children after the name, and its tooltip: the place
  // and every count, in words.
  gitTail(g, tree, name, t, id, lead) {
    const raw = g.branch ?? "detached";
    const same = (a) => a.toLowerCase() === name.toLowerCase();
    const branch = same(raw) || raw === "master" || raw === "main" ? "" : raw;
    const repo = tree || same(g.name) ? "" : g.name;
    const where = [repo, branch].filter(Boolean).join(" \u00b7 ");
    const all = this.counts(g, t);
    const room = this.sidebarPx - CHROME - lead, named = Math.min([...name].length * NAME_CHAR, 150);
    const kept = fits(all, room - Math.min(named, NAME_MIN) - 9);
    const left = room - named - 9 - kept.reduce((n, c) => n + c.width + 5, 4);
    return {
      tip: [where, ...all.map((c) => c.word)].filter(Boolean).join(" \u00b7 "),
      kids: [
        h_flex().flex_1().min_w(0).justify_end().text_size(11.5).text_color(t.dim)
          .when(Boolean(where) && left >= 40, (el) => el.child(div().min_w(0).truncate().child(where))),
        h_flex().flex_none().gap(5).items_center().text_size(11.5).text_color(t.dim).children(kept.map((c) => this.badge(c, id, t))),
      ],
    };
  }

  // What waits on you in a repo: uncommitted files, commits to push (click twice
  // to push) and to pull (click to pull, fast-forward only), the branch's own pull
  // request, and on the repo's first row (see `grouped`) its open pull requests,
  // and on a repo you can push to its open issues and stars. Each GitHub count
  // opens its page there. `rank`: the order they give way in, lowest first;
  // `word`: the count in the row's tooltip.
  counts(g, t) {
    const web = `https://github.com/${g.slug}`, busy = this.syncing.has(g.repo), out = [];
    const add = (c) => out.push({ ...c, width: 4 + (c.icon ? 13 : 0) + [...c.text].length * COUNT_CHAR });
    if (g.dirty > 0) add({ key: "dirty", rank: 5, color: t.ansi3, tip: plural(g.dirty, "uncommitted file"), text: String(g.dirty), word: `${g.dirty} uncommitted` });
    if (g.ahead > 0) {
      const can = this.canPush(g), armed = this.armed?.repo === g.repo;
      const tip = armed ? "Click again to push" : can ? `Push ${plural(g.ahead, "commit")}`
        : `${plural(g.ahead, "commit")} not pushed (${this.write[g.slug] === false ? "not your repo" : "shared main: use a pull request"})`;
      add({ key: "ahead", rank: 4, color: t.ansi2, tip, armed, fn: can && !busy ? (cx) => this.push(g, cx) : null,
        text: busy ? "\u2191\u2026" : armed ? "push?" : `\u2191${g.ahead}`, word: `${g.ahead} ahead` });
    }
    if (g.behind > 0) add({ key: "behind", rank: 3, color: t.ansi1, tip: `Pull ${plural(g.behind, "commit")}`,
      fn: busy ? null : (cx) => this.gitOp(g, ["pull", "--ff-only", "--quiet"], `Pulled ${g.name}`, cx),
      text: busy ? "\u2193\u2026" : `\u2193${g.behind}`, word: `${g.behind} behind` });
    const own = g.slug && this.branchPrs[g.slug]?.[g.branch];
    if (own) {
      const [color, mark, state] = PR_LOOK[own.state];
      add({ key: "pr", rank: 2.5, color: t[color], icon: `${HERE}/pull-request.svg`, tip: `Pull request #${own.number}: ${state}`,
        fn: (cx) => cx.open_url(`${web}/pull/${own.number}`), text: `#${own.number}${mark}`, word: `PR #${own.number} ${state}` });
    }
    if (this.seen.has(g.slug)) return out;
    if (g.slug) this.seen.add(g.slug);
    const pr = g.slug && this.prs[g.slug];
    const asking = pr?.review ? `, ${pr.review} asking for your review` : "";
    if (pr?.open) add({ key: "prs", rank: 2, color: pr.review ? t.blocked : t.dim, icon: `${HERE}/pull-request.svg`,
      tip: plural(pr.open, "open pull request") + asking, fn: (cx) => cx.open_url(`${web}/pulls`),
      text: String(pr.open), word: plural(pr.open, "open PR") + asking });
    const info = g.slug && this.write[g.slug] && this.repoInfo[g.slug];
    if (info?.issues) add({ key: "issues", rank: 1, color: t.dim, icon: `${HERE}/issue.svg`, tip: plural(info.issues, "open issue"),
      fn: (cx) => cx.open_url(`${web}/issues`), text: String(info.issues), word: plural(info.issues, "open issue") });
    if (info?.stars) add({ key: "stars", rank: 0, color: t.dim, icon: `${HERE}/star.svg`, tip: plural(info.stars, "star"),
      fn: (cx) => cx.open_url(`${web}/stargazers`), text: String(info.stars), word: plural(info.stars, "star") });
    return out;
  }

  // A count (one of `counts`) that says on hover what it is; with `fn`, a button.
  // Its press stays off the row, which would start a drag. `id`: the row's.
  badge(c, id, t) {
    const key = `${c.key}-${id}`;
    const el = h_flex().id(key).flex_none().gap(2).items_center().px(2).rounded(4).text_color(c.color)
      .when(this.pressed === null, (el) => el.tooltip(c.tip))
      .when(Boolean(c.armed), (el) => el.bg(t.hover))
      .when(Boolean(c.icon), (el) => el.child(svg(c.icon).size(11)))
      .child(this.tally(key, c.text));
    return !c.fn ? el : el.cursor_pointer().hover((s) => s.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); c.fn(cx); });
  }

  // A count's text, cross-faded when it changes: two layers, the one with the
  // current count in place and the one with the count before fading out over it.
  tally(id, text) {
    const s = (this.tallies[id] ??= { text, prev: text, b: false });
    if (s.text !== text) Object.assign(s, { prev: s.text, text, b: !s.b });
    const layer = (b) => div().id(`${id}-${b ? "b" : "a"}`).opacity(b === s.b ? 1 : 0).transition("opacity", 240)
      .when(b !== s.b, (el) => el.absolute().top(0).right(0))
      .child(b === s.b ? s.text : s.prev);
    return div().relative().flex_none().child(layer(false)).child(layer(true));
  }

  // A row's hover: a fill under its content that fades in and out, none on the
  // selected row (`selected`). Goes before the row's children; `radius`: the
  // row's corners.
  glide(el, id, t, radius, selected = false) {
    return el.on_hover((on, cx) => {
      if (on) this.hovered = id;
      else if (this.hovered === id) this.hovered = null;
      cx.notify();
    }).child(div().id(`${id}-hover`).absolute().inset_0().rounded(radius).bg(t.hover)
      .opacity(!selected && this.hovered === id ? 1 : 0).transition("opacity", 120));
  }

  // Not open projects, under a heading that folds them (folded at first) and
  // counts them.
  notOpenRows(t) {
    const list = this.notOpen(spaces(), panes());
    if (!list.length) return [];
    const open = this.closedOpen;
    const head = h_flex().id("projects-not-open").h(26).flex_none().mt(6).px(8).gap(7).items_center().rounded(7)
      .text_size(11).text_color(t.dim).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => {
        this.closedOpen = !open;
        localStorage.setItem("projects.notOpen", String(this.closedOpen));
        if (this.closedOpen) this.scanProjects(cx);
        cx.notify();
      })
      .child(svg(`mods/my-workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
      .child(div().flex_1().truncate().child("Not open"))
      .child(div().flex_none().child(String(list.length)));
    return [head, ...(open ? list.map((dir) => this.closedRow(dir, t)) : [])];
  }

  // A project with no space: a click opens one in it.
  closedRow(dir, t) {
    const name = base(dir), g = this.git[JSON.stringify([null, dir])];
    const tail = g ? this.gitTail(g, null, name, t, dir, 27) : { tip: "", kids: [div().flex_1()] };
    return this.glide(h_flex().id(`project-${dir}`).relative().h(28).flex_none().px(8).gap(9).items_center().rounded(8), `project-${dir}`, t, 8)
      .text_color(t.muted).hover((s) => s.text_color(t.foreground))
      .when(Boolean(tail.tip), (el) => el.tooltip(tail.tip))
      // The row goes from the list, and no hover-out comes.
      .on_click((_e, cx) => { this.hovered = null; run("space.new", { folder: dir, machine: "" }); cx.notify(); })
      .child(h_flex().w(18).flex_none().justify_center().child(svg("mods/my-workspace-chrome/folder.svg").size(13).text_color(t.dim)))
      .child(div().min_w(Math.min([...name].length * NAME_CHAR, NAME_MIN)).max_w(150).truncate().child(name))
      .children(tail.kids);
  }

  row({ w, i, g, tree }, t) {
    const on = w.active;
    const fromIndex = this.pressed === null ? -1 : spaces().findIndex(s => s.id === this.pressed);
    const colors = shared("space.colors") ?? {};
    const color = colors[w.id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color]);
    // The width before the name: a worktree's indent and icon, else the avatar.
    const tail = g ? this.gitTail(g, tree, w.name, t, w.id, tree ? 44 : 27) : { tip: "", kids: [div().flex_1()] };
    return v_flex()
      .relative()
      .id(`space-${w.id}`)
      .px(8)
      .h(rowHeight({ tree }))
      .flex_none()
      .justify_center()
      .rounded(8)
      .map((el) => card(t, el, on))
      .map((el) => this.glide(el, `space-${w.id}`, t, 8, on))
      // No tooltip while a row is pressed: a release over it never reaches the row, and the drag would stick.
      .when(Boolean(tail.tip) && this.pressed === null, (el) => el.tooltip(tail.tip))
      .when(this.pressed === w.id && this.over !== w.id, (el) => el.opacity(0.5))
      // The drop marker is ink, so it never reads as a selected card's accent lip.
      .when(this.pressed !== null && this.over === w.id && this.pressed !== w.id, (el) => el.child(
        div().absolute().left(0).right(0).h(2).bg(t.foreground)
          .when(fromIndex < i, line => line.bottom(0))
          .when(fromIndex > i, line => line.top(0)),
      ))
      .on_mouse_down("left", (_e, cx) => {
        this.pressed = w.id;
        this.over = w.id;
        cx.notify();
      })
      .on_mouse_move((_e, cx) => {
        const source = spaces().find(s => s.id === this.pressed);
        const over = source && (source.machine ?? null) === (w.machine ?? null) ? w.id : null;
        if (this.pressed !== null && this.over !== over) {
          this.over = over;
          cx.notify();
        }
      })
      .on_mouse_up("left", (_e, cx) => {
        const from = this.pressed;
        const over = this.over;
        this.pressed = null;
        this.over = null;
        if (from !== null && over === w.id && from !== w.id) {
          // The rows move under the pointer, and no hover-out comes.
          this.hovered = null;
          const index = spaces().findIndex(s => s.id === w.id);
          if (index !== -1) run("space.move", { id: from, index: index + 1 });
        } else if (from === w.id) run("space.select", { id: w.id });
        cx.notify();
      })
      .on_mouse_down("right", () => this.menu(w))
      .child(
        h_flex()
          .gap(9)
          .items_center()
          .when(Boolean(tree), el => el.pl(22).child(svg("mods/my-workspace-chrome/branch.svg").size(13).text_color(t.dim)))
          .when(!tree, el => el.child(h_flex().size(18).flex_none().rounded(5).bg(fill).items_center().justify_center().text_size(10.5).font_bold().text_color("#ffffff").child([...w.name][0]?.toUpperCase() ?? "?")))
          .child(div().min_w(Math.min([...w.name].length * NAME_CHAR, NAME_MIN)).max_w(150).truncate().text_color(t.foreground).child(w.name))
          .children(tail.kids),
      );
  }

  compact({ w, i }, t) {
    return railCell(h_flex()
      .id(`space-${w.id}`)
      .relative()
      .w(RAIL_CELL)
      .h(26)
      .rounded(6)
      .justify_center()
      .items_center()
      .when(w.active, (el) => el.bg(t.selected))
      .map((el) => this.glide(el, `space-${w.id}`, t, 6, w.active))
      .on_click(() => run("space.select", { id: w.id }))
      .child(div().text_color(w.active ? t.foreground : t.muted).child(String(i + 1)))
      .child(div().absolute().right(5).text_color(tone(t, w.status)).child(glyph(w.status))));
  }

  // This block's height: its list's, up to half its column, so the block below
  // gets the rest. A height this didn't give it (a drag on the divider) stays
  // until a double-click on the heading (see `refit`).
  fit() {
    const p = path(layout(), MINE), own = p?.at(-1);
    if (!own?.id || p.at(-2)?.type !== "column" || !this.listHeight) return;
    const px = own.size?.px;
    this.manual = px != null && !this.fitted.some((v) => v != null && Math.abs(px - v) <= 1);
    if (this.manual) return;
    // The column's height: the window's, less the fixed-height blocks beside each
    // column on the way down (`window` here is Herdr's; the drawing window's is global).
    // shortcut: gaps, padding and dividers on the way count as nothing; add them if the sidebar gets any.
    let room = globalThis.window.viewport_size().height;
    for (const n of p.slice(0, -2)) if (n.type === "column") for (const c of n.children) if (!p.includes(c) && !c.hidden) room -= c.size?.px ?? 0;
    const want = Math.round(Math.max(own.min ?? 0, Math.min(this.listHeight + FRAME, room / 2)));
    if (px != null && Math.abs(px - want) <= 1) return;
    // The last two: the layout can still show the one before.
    this.fitted = [this.fitted.at(-1), want];
    localStorage.setItem("fit.px", String(want));
    run("layout.resize", { id: own.id, px: want });
  }

  // Hands this block's height back to `fit`, and the blocks beside it that a
  // drag gave a fixed height share the rest again.
  refit(cx) {
    const p = path(layout(), MINE), own = p?.at(-1);
    if (!own) return;
    this.fitted = [own.size?.px ?? null];
    // shortcut: each goes back to weight 1, the agents list's in the layout; read the layout file's weights if another needs its own.
    for (const c of p.at(-2)?.children ?? []) if (c !== own && c.size?.px != null) run("layout.resize", { id: c.id, weight: 1 });
    cx.notify();
  }

  render() {
    const t = theme();
    const collapsed = narrow();
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const sp = spaces();
    const ids = new Set(sp.map(p => p.id));
    const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = c => Object.values(kept).filter(v => v === c).length;
      kept[p.id] = palette.reduce((best, c) => uses(c) < uses(best) ? c : best);
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
    this.sidebarPx = find(layout(), "sidebar")?.size?.px ?? Infinity;
    this.fit();
    return v_flex().id("spaces-root").size_full().min_h(0).bg(t.chrome).text_size(13)
      // A release outside this block never reaches it: leaving drops the press.
      .on_hover((on, cx) => { if (!on && this.pressed !== null) { this.pressed = null; this.over = null; cx.notify(); } })
      .child(h_flex().h(31).pl(16).pr(10).items_center().justify_between().text_size(11.5).font_semibold().text_color(t.foreground)
        .when(collapsed, el => el.pl(0).pr(0).justify_center())
        .when(!collapsed, el => el.child(div().id("spaces-heading")
          .when(this.manual, el => el.tooltip("Double-click to fit to the list again"))
          .on_click((e, cx) => { if (e.click_count === 2) this.refit(cx); })
          .child("Spaces")))
        .child(boxy(t, "space-new", svg("mods/my-workspace-chrome/plus.svg").size(14), { onClick: () => run("space.new"), h: 20, px: 5 })))
      .child(v_flex().flex_1().min_h(0).px(collapsed ? 0 : 8).pb(14).overflow_y_scrollbar().mode("always")
        .on_mouse_up("left", (_e, cx) => { this.pressed = null; this.over = null; cx.notify(); })
        .child(v_flex().id("list").flex_none().gap(3)
          .on_size_change((size, cx) => { if (size.height !== this.listHeight) { this.listHeight = size.height; cx.notify(); } })
          .children(this.grouped(t, collapsed))));
  }
}
