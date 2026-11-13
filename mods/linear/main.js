// Linear: tickets in the side panel. Home lists tickets; a ticket opens in the same panel.
import { View } from "gpui-kit";
import { InputState, TextareaState } from "gpui-base";
import { agents, exec, focused, hc, knownAgents, layout, machines, notify, openOverlay, panes, props, run, spaces } from "herdr";
import { createClient } from "./linear.js";
import * as Q from "./queries.js";
import { isPanelShown, keepSpaces, ownPane, parseSearch, pushRecent, startText, targetAgent } from "./model.js";
import { renderHome } from "./home.js";
import { renderTicket } from "./ticket.js";

const LIST_TTL = 60_000;
const RECENT_MAX = 20;
const CACHE_MAX_AGE = 7 * 24 * 3600_000;

// The Linear personal API key from the macOS Keychain, or null when none is stored.
async function readKey() {
  const r = await exec("security", ["find-generic-password", "-s", "herdr-linear", "-w"]);
  return r.code === 0 ? r.stdout.trim() || null : null;
}

// The JSON value stored under `key`, or `fallback` when it is missing, unreadable or of another shape.
function loadStored(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value && typeof value === "object" && Array.isArray(value) === Array.isArray(fallback) ? value : fallback;
  } catch {
    return fallback;
  }
}

function store(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

// The id of the shown space, or null before Herdr reports one.
const shownSpace = () => spaces().find((s) => s.active)?.id ?? null;

// Removes cached responses older than CACHE_MAX_AGE: every search term leaves one behind.
function pruneCache() {
  try {
    const old = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith("cache:") && Date.now() - (JSON.parse(localStorage.getItem(k))?.at ?? 0) > CACHE_MAX_AGE) old.push(k);
    }
    for (const k of old) localStorage.removeItem(k);
  } catch {}
}

export default class Linear extends View {
  init(_props, cx) {
    pruneCache();
    this.client = createClient({ fetch, readKey, storage: localStorage, now: Date.now });
    this.ticket = props()?.ticket ?? null; // the key a ticket pane shows; null in the side panel
    // A copy starts the first time it shows, so the shown tab is a ticket pane's own. pane.split focuses the pane it
    // makes, so a pane opened from the panel finds itself as the focused pane; ownPane() checks the claim.
    this.paneTab = this.ticket ? focused()?.tab ?? null : null;
    this.pane = this.ticket ? focused()?.pane ?? null : null;
    this.lastPane = null; // the pane that last had the keyboard, for the panel's ⧉
    this.stack = [this.ticket ? { screen: "ticket", key: this.ticket } : { screen: "home" }]; // also { screen: "project", id, name }, { screen: "view", id, name } and { screen: "ticket", key }
    this.tab = "mine"; // "mine" | "favorites" | "projects" | "recent"
    this.results = {}; // screen key → { data, at, error, loading }
    this.search = { input: InputState.new({ placeholder: "Search: key, 212, URL or text" }), kind: "empty", value: "", notFound: null };
    this.recent = this.ticket ? [] : loadStored("recent", []); // tickets opened in the panel, newest first: [{ identifier, title }]
    // A machine still loading has its spaces missing from spaces(), so nothing is dropped until every machine is ready.
    const live = machines().every((m) => m.layout === "ready") ? spaces().map((s) => s.id) : [];
    this.spaces = this.ticket ? {} : keepSpaces(loadStored("spaces", {}), live); // space id → { stack, tab, search: { kind, value } }
    this.closedFolders = this.ticket ? [] : loadStored("closedFolders", []); // ids of the Favorites folders shown closed
    this.space = null; // the space whose context the panel shows; null in a ticket tab
    this.branch = null; // { name, issue } for the focused pane's branch
    this.viewerId = null; // the Linear user id of the key's owner, once a ticket loads
    this.lookup = null; // the token of the searched key in flight
    this.menu = null; // the open dropdown on the Ticket screen: "status" | "assignee" | "start" | "copy"
    this.drafts = {}; // ticket key → { input, parent, sending }: its comment box
    this.known = []; // the agents people can start, most picked first
    this.knownFailed = false; // the last check of those agents failed
    this.updating = false; // a ticket change is in flight: status, assignee or star
    this.lastAgent = null; // the address of the agent targeted while a pane last had the keyboard
    this.search.input.on("submit", (_e, cx) => this.runSearch(cx));
    this.search.input.on("change", (_e, cx) => {
      if (this.search.notFound) {
        this.search.notFound = null;
        cx.notify();
      }
      if (!this.search.input.value().trim() && this.search.kind !== "empty") this.runSearch(cx);
    });
    if (!this.ticket) this.enter(shownSpace());
    this.restore();
    this.shown = true; // a copy starts the first time it shows
    this.load(cx);
    this.loadAgents(cx);
    cx.timer.every(LIST_TTL, (cx) => {
      // A hidden copy may not render; this lets the render after it shows again see it come back.
      this.shown = this.isShown();
      // A load in flight (↻, or the reload after a change) answers for this tick.
      if (this.shown && !this.results[this.key(this.top())]?.loading) this.load(cx, { quiet: true });
    });
  }

  // Whether this copy is on screen: the side panel showing it, or a ticket pane in the shown tab.
  isShown() {
    return this.ticket ? this.paneTab !== null && focused()?.tab === this.paneTab : isPanelShown(layout());
  }

  top() {
    return this.stack[this.stack.length - 1];
  }

  // The results slot of the active number or text search, or null.
  searchSlot() {
    const { kind, value } = this.search;
    return kind === "number" || kind === "text" ? `${kind}:${value}` : null;
  }

  // The results slot for a screen entry. Search results take the place of a list screen's own.
  key(entry) {
    if (entry.screen === "ticket") return `ticket:${entry.key}`;
    return this.searchSlot() ?? (entry.screen === "home" ? this.tab : `${entry.screen}:${entry.id}`);
  }

  // [document, variables] that fill a screen entry, or null when it needs no request.
  request(entry) {
    if (entry.screen === "ticket") return [Q.TICKET, { id: entry.key }];
    if (this.search.kind === "number") return [Q.BY_NUMBER, { number: this.search.value }];
    if (this.search.kind === "text") return [Q.SEARCH, { term: this.search.value }];
    if (entry.screen === "project") return [Q.PROJECT_ISSUES, { id: entry.id }];
    if (entry.screen === "view") return [Q.VIEW_ISSUES, { id: entry.id }];
    if (this.tab === "mine") return [Q.MY_ISSUES, {}];
    if (this.tab === "favorites") return [Q.FAVORITES, {}];
    if (this.tab === "projects") return [Q.PROJECTS, {}];
    return null;
  }

  // Shows the top screen's cached copy at once, then fetches it.
  // `force` (↻) always fetches. `quiet` (the timer) fetches unless the cache is under 55 s old, and shows no spinner over data.
  load(cx, { force = false, quiet = false } = {}) {
    // A branch with no ticket found is looked up again: the lookup may have run before a key was stored.
    if (force && this.branch?.issue == null) this.branch = null;
    const entry = this.top();
    const req = this.request(entry);
    if (req) {
      const [doc, vars] = req;
      const slot = this.key(entry);
      const hit = this.client.cached(doc, vars);
      const token = {};
      const error = quiet ? this.results[slot]?.error ?? null : null;
      this.results[slot] = { data: hit?.data ?? null, at: hit?.at ?? null, error, loading: !quiet || !hit?.data, token };
      cx.spawn(async (cx) => {
        const r = await this.client.query(doc, vars, { ttl: force ? 0 : quiet ? LIST_TTL - 5_000 : LIST_TTL });
        // A later load of the same slot, or a cleared search, owns the slot now.
        if (this.results[slot]?.token !== token) return;
        this.settle(slot, entry, r, token);
        cx.notify();
      });
    }
    cx.notify();
  }

  // Stores a finished request in its slot. A loaded ticket also keeps the viewer id and its title in Recent.
  settle(slot, entry, r, token) {
    this.results[slot] = { ...r, loading: false, token };
    const issue = entry.screen === "ticket" ? r.data?.issue : null;
    if (!issue) return;
    // Cached data that comes back with an error may belong to an earlier key's account.
    if (!r.error) this.viewerId = r.data.viewer?.id ?? this.viewerId;
    if (this.recent.some((x) => x.identifier === entry.key && x.title !== issue.title)) {
      this.recent = this.recent.map((x) => (x.identifier === entry.key ? { ...x, title: issue.title } : x));
      this.saveRecent();
    }
  }

  saveRecent() {
    store("recent", this.recent);
  }

  // Shows the context saved for `space`, after saving the one shown so far. A space seen for the first time starts on
  // Home → My issues. Nothing it calls is illegal in render; restore() makes the calls that are.
  enter(space) {
    this.remember();
    const saved = this.spaces[space];
    this.space = space;
    this.stack = saved?.stack ?? [{ screen: "home" }];
    this.tab = saved?.tab ?? "mine";
    Object.assign(this.search, saved?.search ?? { kind: "empty", value: "" }, { notFound: null });
    this.lookup = null;
    this.menu = null;
  }

  // Puts the shown context into host state: the search box text, and a comment box for each ticket on the stack.
  restore() {
    const { kind, value } = this.search;
    this.search.input.set_value(kind === "empty" ? "" : String(value));
    for (const e of this.stack) if (e.screen === "ticket") this.draft(e.key);
  }

  // Saves the shown space's context. A ticket tab keeps none.
  remember() {
    if (this.ticket || !this.space) return;
    const { kind, value } = this.search;
    this.spaces[this.space] = { stack: this.stack, tab: this.tab, search: { kind, value } };
    store("spaces", this.spaces);
  }

  setTab(tab, cx) {
    this.tab = tab;
    this.remember();
    this.load(cx);
  }

  // A key opens that ticket; a number or text lists matches; empty input returns to the tabs.
  runSearch(cx) {
    this.lookup = null;
    const { kind, value } = parseSearch(this.search.input.value());
    if (kind === "key") return this.openKey(value, cx);
    delete this.results[this.searchSlot()];
    this.search.kind = kind;
    this.search.value = value;
    this.remember();
    this.load(cx);
  }

  openProject(project, cx) {
    this.stack.push({ screen: "project", id: project.id, name: project.name });
    this.remember();
    this.load(cx);
  }

  openView(customView, cx) {
    this.stack.push({ screen: "view", id: customView.id, name: customView.name });
    this.remember();
    this.load(cx);
  }

  toggleFolder(id, cx) {
    this.closedFolders = this.closedFolders.includes(id) ? this.closedFolders.filter((x) => x !== id) : [...this.closedFolders, id];
    store("closedFolders", this.closedFolders);
    cx.notify();
  }

  // `title` is the row's title when known; Recent keeps its earlier title otherwise.
  // `result` is a Ticket query result already fetched for this key; without it the ticket loads.
  open(identifier, cx, title, result) {
    if (!this.ticket) {
      title = title ?? this.recent.find((r) => r.identifier === identifier)?.title ?? "";
      this.recent = pushRecent(this.recent, { identifier, title }, RECENT_MAX);
      this.saveRecent();
    }
    this.stack.push({ screen: "ticket", key: identifier });
    this.remember();
    this.menu = null;
    this.draft(identifier);
    if (!result) return this.load(cx);
    this.settle(this.key(this.top()), this.top(), result, {});
    cx.notify();
  }

  // Opens a searched key once Linear has it. An unknown key shows "<KEY> not found" on the search row instead.
  openKey(identifier, cx) {
    const token = (this.lookup = {});
    const from = this.top();
    cx.spawn(async (cx) => {
      const r = await this.client.query(Q.TICKET, { id: identifier }, { ttl: LIST_TTL });
      // A later Enter owns the lookup now.
      if (this.lookup !== token) return;
      this.lookup = null;
      // The person left the screen they searched from.
      if (this.top() !== from) return cx.notify();
      const unknown = r.error ? r.error.kind === "graphql" && /not found/i.test(r.error.message) : !r.data?.issue;
      if (!unknown) return this.open(identifier, cx, r.data?.issue?.title, r);
      this.search.notFound = identifier;
      cx.notify();
    });
    cx.notify();
  }

  // The comment box of a ticket: its text, the thread it replies to ({ id, name } or null), and whether it is sending.
  draft(key) {
    if (this.drafts[key]) return this.drafts[key];
    const input = TextareaState.new({ placeholder: "Comment…", rows: 3 });
    input.on("submit", (e, cx) => {
      if (e.secondary && !e.shift) this.sendComment(key, cx);
    });
    return (this.drafts[key] = { input, parent: null, sending: false });
  }

  // Frees the comment box of a ticket that no stack holds any more, unless it holds text or is sending.
  dropDraft(key) {
    const d = this.drafts[key];
    const held = [this.stack, ...Object.values(this.spaces).map((c) => c.stack)].some((s) => s.some((e) => e.key === key));
    if (!d || d.sending || d.input.value() || held) return;
    d.input.release();
    delete this.drafts[key];
  }

  // Runs a Linear mutation on the open ticket; on failure shows Linear's message.
  // On success it refreshes that ticket, on screen or in the cache. `onDone(ok)` runs once it finishes.
  mutate(doc, vars, cx, onDone) {
    const key = this.top().key;
    cx.spawn(async (cx) => {
      const r = await this.client.mutate(doc, vars);
      // Linear answers a change it did not make with `success: false` and no error.
      const error = r.error ?? (Object.values(r.data ?? {})[0]?.success === false ? { message: "Linear did not make the change" } : null);
      if (error) notify({ title: "Linear", body: error.message ?? error.kind, level: "error" });
      onDone?.(!error);
      if (!error && this.top().key === key) this.load(cx, { force: true });
      else if (!error) await this.client.query(Q.TICKET, { id: key }, { ttl: 0 });
      cx.notify();
    });
  }

  // Changes the open ticket's fields. A change while another is in flight is ignored.
  update(issue, input, cx) {
    if (this.updating) return;
    this.updating = true;
    this.mutate(Q.ISSUE_UPDATE, { id: issue.id, input }, cx, () => {
      this.updating = false;
    });
  }

  // Adds the open ticket to the viewer's Linear favorites, or removes it; the side panel then refetches Favorites.
  // A click while another change is in flight, or while the ticket reloads, is ignored: ☆/★ may be stale then.
  star(issue, cx) {
    if (this.updating || this.results[this.key(this.top())]?.loading) return;
    this.updating = true;
    const [doc, vars] = issue.favorite
      ? [Q.FAVORITE_DELETE, { id: issue.favorite.id }]
      : [Q.FAVORITE_CREATE, { input: { issueId: issue.id } }];
    this.mutate(doc, vars, cx, (ok) => {
      this.updating = false;
      if (ok && !this.ticket) this.client.query(Q.FAVORITES, {}, { ttl: 0 });
    });
  }

  // Moves the comment box under a thread; the next comment replies to it.
  reply(key, comment, cx) {
    const d = this.draft(key);
    d.parent = { id: comment.id, name: comment.user?.name ?? "Integration" };
    d.input.focus();
    cx.notify();
  }

  // Posts the ticket's draft as a comment, or as a reply to its thread. The draft clears once Linear has it.
  sendComment(key, cx) {
    const d = this.draft(key);
    const issue = this.results[this.key({ screen: "ticket", key })]?.data?.issue;
    const body = d.input.value();
    if (d.sending || !issue || !body.trim()) return;
    d.sending = true;
    this.mutate(Q.COMMENT_CREATE, { input: { issueId: issue.id, body, ...(d.parent && { parentId: d.parent.id }) } }, cx, (ok) => {
      d.sending = false;
      if (!ok) return;
      d.parent = null;
      // Text typed while it was sending stays.
      if (d.input.value() === body) d.input.set_value("");
      this.dropDraft(key);
    });
    cx.notify();
  }

  // Asks Herdr again which agents people can start. A failed check keeps the last list.
  loadAgents(cx) {
    cx.spawn(async (cx) => {
      try {
        this.known = await knownAgents({ on: spaces().find((s) => s.id === focused()?.space)?.machine });
        this.knownFailed = false;
      } catch {
        this.knownFailed = true;
      }
      cx.notify();
    });
  }

  // The agent that Send on `issue` pastes into, or null.
  agent(issue) {
    return targetAgent(agents(), focused(), { ticket: this.ticket && issue.identifier, tab: this.paneTab, last: this.lastAgent });
  }

  // Pastes text into `agent`, an agents() entry, and presses Enter.
  sendToAgent(agent, text, cx) {
    cx.spawn(async () => {
      // hc rejects when it cannot start.
      const r = await hc(["send", agent.address, text]).catch((e) => ({ code: -1, stdout: "", stderr: String(e?.message ?? e) }));
      notify(r.code === 0
        ? { title: "Sent to agent", body: agent.title, timeout: 2000 }
        : { title: "Couldn't send", body: (r.stderr || r.stdout).trim() || `hc exited with ${r.code}`, level: "error" });
    });
  }

  // Opens a new tab in the focused space with `agent` (a knownAgents() entry) working on the ticket.
  startAgent(issue, agent) {
    run("tab.new", { name: issue.identifier, space: focused()?.space, argv: agent.run, task: startText(issue) });
  }

  back(cx) {
    if (this.stack.length < 2) return;
    const gone = this.stack.pop();
    this.remember();
    this.menu = null;
    this.dropDraft(gone.key);
    this.load(cx);
  }

  // Opens the open ticket in a pane beside the last focused pane; the panel goes back to the screen under it.
  openPane(issue, cx) {
    run("pane.split", { direction: "right", pane: focused()?.pane ?? this.lastPane, mod: "linear", props: { ticket: issue.identifier } });
    this.back(cx);
  }

  // Opens the layout's terminal right-click menu for this ticket pane. A menu that moves panes recreates a mod pane
  // from `mod` and `props`, so the move keeps the ticket on screen.
  paneMenu() {
    const pane = ownPane(panes(), this.paneTab, this.pane);
    if (!pane) return;
    openOverlay({ mod: layout()?.terminal_menu ?? "menu", kind: "popup", at: "pointer",
      props: { tab: "pane", target: { pane, mod: "linear", props: { ticket: this.top().key } } } });
  }

  // Looks up the ticket for the focused pane's git branch, once per branch change.
  // Focus outside any pane (this panel, a layout terminal block) keeps the last branch.
  watchBranch(cx) {
    const f = focused();
    if (!f?.pane) return;
    const name = panes().find((p) => p.pane === f.pane)?.branch ?? null;
    if (name === (this.branch?.name ?? null)) return;
    // A fresh cached answer is used in this render; the task below would notify during it.
    const hit = name ? this.client.cached(Q.BRANCH, { branch: name }) : null;
    const fresh = hit && Date.now() - hit.at < LIST_TTL;
    const branch = (this.branch = { name, issue: fresh ? hit.data?.issueVcsBranchSearch ?? null : null });
    if (!name || fresh) return;
    cx.spawn(async (cx) => {
      const r = await this.client.query(Q.BRANCH, { branch: name }, { ttl: LIST_TTL });
      branch.issue = r.data?.issueVcsBranchSearch ?? null;
      cx.notify();
    });
  }

  render(cx) {
    const shown = this.isShown();
    // Coming back into view refreshes the open screen, from a task: a load notifies.
    if (shown && !this.shown) cx.spawn(async (cx) => this.load(cx));
    this.shown = shown;
    if (!this.ticket) {
      const space = shownSpace();
      if (space && space !== this.space) {
        this.enter(space);
        // restore() and load() are host calls, so they run from a task.
        cx.spawn(async (cx) => {
          this.restore();
          this.load(cx);
        });
      }
      this.watchBranch(cx);
      if (focused()?.pane) {
        this.lastPane = focused().pane;
        this.lastAgent = targetAgent(agents(), focused())?.address ?? null;
      }
    }
    const screen = this.top().screen === "ticket" ? renderTicket(this, cx) : renderHome(this, cx);
    return this.ticket ? screen.id("ticket-pane").on_mouse_down("right", () => this.paneMenu()) : screen;
  }
}
