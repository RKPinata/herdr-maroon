// The Home, Project and View screens: search, tabs, the branch row and a ticket list. Also the setup and error cards,
// and the row builders the Ticket screen shares.
import { div } from "gpui-kit";
import { v_flex, h_flex, Input, TextView } from "gpui-base";
import { theme } from "herdr";
import { favoriteTree, groupIssues, relativeTime } from "./model.js";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const KEY_COMMAND = 'security add-generic-password -U -s herdr-linear -a "$USER" -w';
const KEY_URL = "https://linear.app/settings/account/security";
const TABS = [["mine", "My issues"], ["favorites", "Favorites"], ["projects", "Projects"], ["recent", "Recent"]];

export const dot = (color, t) => div().size(8).flex_none().rounded(99).bg(color ?? t.dim);
export const spinner = () => div().flex_none().frames(SPINNER, 80);
export const action = (id, t, onClick) => h_flex().id(id).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover)).on_click(onClick);
export const row = (id, t, onClick) => action(id, t, onClick).w_full().h(28).flex_none().px(8).gap(7);

// The panel's rounded card that every screen draws in. `bare` leaves out the card's border and corners.
export const frame = (t, bare = false) =>
  v_flex().size_full().min_h(0).overflow_hidden().bg(t.background).text_color(t.foreground).text_size(13)
    .when(!bare, (e) => e.rounded(10).border_1().border_color(t.border));
export const loadingLine = (t) => h_flex().p(14).gap(8).text_color(t.muted).child(spinner()).child("Loading");

// Issue rows from any list query's data: My issues, a project, a view, a number search or a text search.
const issuesOf = (d) =>
  d.viewer?.assignedIssues?.nodes ?? d.project?.issues?.nodes ?? d.customView?.issues?.nodes ?? d.issues?.nodes ?? d.searchIssues?.nodes ?? [];

const list = (id, t, rows) =>
  v_flex().id(id).flex_1().min_h(0).overflow_y_scrollbar().p(6)
    .children(rows.length ? rows : [div().p(8).text_color(t.dim).child("Nothing here")]);

// A row that opens issue `x`, with its state dot and an optional note on the right.
export const issueRow = (view, t, id, x, note) =>
  row(id, t, (_e, cx) => view.open(x.identifier, cx, x.title))
    .child(dot(x.state.color, t))
    .child(div().flex_none().text_color(t.muted).child(x.identifier))
    .child(div().flex_1().min_w(0).truncate().child(x.title))
    .when(Boolean(note), (e) => e.child(div().flex_none().text_size(11.5).text_color(t.dim).child(note)));

const issueRows = (view, t, issues) =>
  groupIssues(issues).flatMap((g) => [
    h_flex().flex_none().px(8).pt(10).pb(4).gap(6).text_size(11.5).font_medium().text_color(t.dim)
      .child(div().min_w(0).truncate().child(g.name))
      .child(div().flex_none().child(String(g.issues.length))),
    ...g.issues.map((i) => issueRow(view, t, `i-${i.id}`, i, i.priority > 0 && i.priorityLabel)),
  ]);

const named = (el, t, color, name) => el.child(dot(color, t)).child(div().flex_1().min_w(0).truncate().child(name));

const projectRows = (view, t, projects) =>
  projects.map((p) => named(row(`p-${p.id}`, t, (_e, cx) => view.openProject(p, cx)), t, p.color, p.name));

// A favorite's row, or null for one the panel cannot open. A folder opens or closes; a kind with no screen here
// opens in Linear.
function favoriteRow(view, t, f) {
  const id = `f-${f.id}`;
  if (f.type === "folder") {
    return row(id, t, (_e, cx) => view.toggleFolder(f.id, cx))
      .child(div().flex_none().w(10).text_color(t.dim).child(view.closedFolders.includes(f.id) ? "▸" : "▾"))
      .child(div().flex_1().min_w(0).truncate().child(f.folderName ?? "Folder"));
  }
  if (f.issue) return issueRow(view, t, id, f.issue);
  if (f.project) return named(row(id, t, (_e, cx) => view.openProject(f.project, cx)), t, f.project.color, f.project.name);
  const v = f.customView;
  if (v?.modelName === "Issue") return named(row(id, t, (_e, cx) => view.openView(v, cx)), t, v.color, v.name);
  if (!f.url) return null;
  const name = v?.name ?? f.document?.title ?? (f.cycle && (f.cycle.name || `Cycle ${f.cycle.number}`)) ?? f.type;
  return named(row(id, t, (_e, cx) => cx.open_url(f.url)), t, null, name);
}

// Rows for favorites in order. An open folder's children follow it, one step further in.
const favoriteRows = (view, t, nodes, depth = 0) =>
  nodes.flatMap((f) => {
    const r = favoriteRow(view, t, f);
    if (!r) return [];
    const el = r.when(depth > 0, (e) => e.pl(8 + depth * 16));
    const open = f.type === "folder" && !view.closedFolders.includes(f.id);
    return open ? [el, ...favoriteRows(view, t, f.children, depth + 1)] : [el];
  });

// The rows of a list query's data: favorites, projects or issues.
const listRows = (view, t, d) =>
  d.favorites ? favoriteRows(view, t, favoriteTree(d.favorites.nodes))
  : d.projects ? projectRows(view, t, d.projects.nodes)
  : issueRows(view, t, issuesOf(d));

function searchRow(view, t) {
  const loading = view.results[view.key(view.top())]?.loading || view.lookup;
  return h_flex().h(40).flex_none().px(8).gap(6).items_center().border_b(1).border_color(t.border)
    .child(Input.new(view.search.input).flex_1().min_w(0).h(28).px(8).rounded(6).border_1().border_color(t.input).bg(t.background).text_size(12.5))
    .when(Boolean(view.search.notFound), (e) => e.child(div().flex_none().text_size(11.5).text_color(t.ansi1).child(`${view.search.notFound} not found`)))
    .child(action("refresh", t, (_e, cx) => view.load(cx, { force: true })).size(26).flex_none().justify_center().text_color(t.muted)
      .child(loading ? spinner() : "↻"));
}

const tabRow = (view, t) =>
  h_flex().h(36).flex_none().px(8).gap(4).items_center().border_b(1).border_color(t.border).children(TABS.map(([tab, label]) =>
    action(`tab-${tab}`, t, (_e, cx) => view.setTab(tab, cx)).h(24).flex_none().px(8).text_size(12)
      .when(view.tab === tab, (e) => e.bg(t.selected))
      .text_color(view.tab === tab ? t.foreground : t.muted)
      .child(label)));

const backRow = (view, entry, t) =>
  h_flex().h(36).flex_none().px(6).items_center().border_b(1).border_color(t.border)
    .child(action("back", t, (_e, cx) => view.back(cx)).h(26).min_w(0).px(6).gap(6).text_color(t.muted)
      .child(div().flex_none().child("←"))
      .child(div().min_w(0).truncate().child(entry.name)));

function branchRow(view, t) {
  const i = view.branch.issue;
  return div().flex_none().px(6).py(3).border_b(1).border_color(t.border)
    .child(row("branch", t, (_e, cx) => view.open(i.identifier, cx, i.title))
      .child(div().flex_none().text_color(t.dim).child("This branch →"))
      .child(div().flex_none().text_color(t.muted).child(i.identifier))
      .child(div().flex_1().min_w(0).truncate().child(i.title)));
}

function body(view, cx, t) {
  const entry = view.top();
  if (entry.screen === "home" && view.search.kind === "empty" && view.tab === "recent") {
    return list("list-recent", t, view.recent.map((r) =>
      row(`r-${r.identifier}`, t, (_e, cx) => view.open(r.identifier, cx, r.title))
        .child(div().flex_none().text_color(t.muted).child(r.identifier))
        .child(div().flex_1().min_w(0).truncate().child(r.title))));
  }
  const slot = view.key(entry);
  const res = view.results[slot] ?? { loading: true };
  if (res.error && res.error.kind !== "offline") return renderProblem(view, res.error);
  const d = res.data;
  return v_flex().flex_1().min_h(0)
    .when(res.error?.kind === "offline", (e) => e.child(renderProblem(view, res.error)))
    .when(!d && res.loading, (e) => e.child(loadingLine(t)))
    .when(Boolean(d), (e) => e.child(list(`list-${slot}`, t, listRows(view, t, d))));
}

export function renderHome(view, cx) {
  const t = theme();
  const searching = view.searchSlot() !== null;
  return frame(t)
    .child(searchRow(view, t))
    .when(view.stack.length > 1, (e) => e.child(backRow(view, view.top(), t)))
    .when(view.stack.length === 1 && !searching, (e) => e.child(tabRow(view, t)))
    .when(Boolean(view.branch?.issue), (e) => e.child(branchRow(view, t)))
    .child(body(view, cx, t));
}

// The setup card, the error message or the offline bar for an error from the Linear client.
export function renderProblem(view, error) {
  const t = theme();
  if (error.kind === "offline") {
    const at = view.results[view.key(view.top())]?.at;
    const ago = at ? relativeTime(at, Date.now()) : null;
    return div().flex_none().px(12).py(5).border_b(1).border_color(t.border).bg(t.raised).truncate().text_size(11.5).text_color(t.muted)
      .child(!ago ? "Offline" : ago === "now" ? "Offline · data from just now" : `Offline · data from ${ago} ago`);
  }
  if (error.kind === "graphql") return div().p(14).text_size(12.5).text_color(t.ansi1).child(error.message);
  return v_flex().p(14).gap(10)
    .when(error.kind === "auth", (e) => e.child(div().text_color(t.ansi1).child("Linear rejected the key")))
    .child(div().font_semibold().child("Add your Linear API key"))
    .child(div().text_size(12).text_color(t.muted).child("Run this in a terminal. It asks for the key and stores it in the macOS Keychain."))
    .child(div().px(10).py(8).rounded(8).bg(t.raised).border_1().border_color(t.border).text_size(12)
      .child(TextView.markdown("key-command", `\`${KEY_COMMAND}\``).selectable(true)))
    .child(h_flex().gap(8).items_center()
      .child(action("create-key", t, (_e, cx) => cx.open_url(KEY_URL)).h(28).px(10).text_color(t.accent).child("Create a key"))
      .child(action("check-key", t, (_e, cx) => view.load(cx, { force: true })).h(28).px(10).border_1().border_color(t.input).child("Check again")));
}
