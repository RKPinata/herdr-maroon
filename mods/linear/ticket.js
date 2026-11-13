// The Ticket screen: a bar, then the header, description, sub-issues, links, relations and comments in one scrolling
// column. The column is at most COLUMN px wide, so lines stay readable in a wide pane.
import { div, image, svg } from "gpui-kit";
import { v_flex, h_flex, Popover, Textarea, TextView } from "gpui-base";
import { notify, theme } from "herdr";
import * as Q from "./queries.js";
import { boxy } from "./boxy.js";
import { buildThreads, commentText, imagesAsLinks, oneLine, relationsOf, relativeTime, statusOptions, ticketLine } from "./model.js";
import { action, dot, frame, issueRow, loadingLine, renderProblem, row, spinner } from "./home.js";

const COLUMN = 760;
const RELATIONS = [["blocks", "Blocks"], ["blockedBy", "Blocked by"], ["related", "Related"], ["duplicateOf", "Duplicate of"]];
const SMALL = { h: 20, px: 6, size: 11.5 };

const markdown = (id, text) =>
  div().text_size(13.5).line_height(1.55).child(TextView.markdown(id, imagesAsLinks(text)).selectable(true));
const section = (t, label, rows) =>
  rows.length ? v_flex().mt(20).pt(14).px(6).border_t(1).border_color(t.border)
    .child(div().px(8).pb(6).text_size(13).font_semibold().child(label)).children(rows) : null;

// A fact about the ticket as a pill, with a color dot when `color` is given.
const chip = (t, text, color) =>
  h_flex().h(22).flex_none().px(8).gap(6).items_center().rounded(99).border_1().border_color(t.border).bg(t.raised).text_size(11.5)
    .when(Boolean(color), (e) => e.child(dot(color, t))).child(text);

// A trigger that opens `items` under it. One menu is open at a time; `view.menu` names it.
const menu = (view, name, t, trigger, items, onOpen) =>
  Popover.new(`menu-${name}`).open(view.menu === name)
    .on_open_change((open, cx) => {
      if (open) {
        view.menu = name;
        onOpen?.(cx);
      } else if (view.menu === name) view.menu = null;
      cx.notify();
    })
    .trigger(trigger)
    .content(v_flex().id(`menu-${name}-items`).min_w(180).p(4).rounded(8).border_1().border_color(t.border).bg(t.popover)
      .text_size(12.5).text_color(t.foreground).children(items));

const trigger = (t, id, content) => boxy(t, id, content).cursor_pointer();

// A menu item that closes the menu, then runs `run(cx)`.
const item = (view, id, t, run) =>
  row(id, t, (_e, cx) => {
    view.menu = null;
    run(cx);
    cx.notify();
  });

const disabledItem = (t) => h_flex().w_full().h(28).px(8).gap(7).items_center().text_color(t.dim);

// A button that sends `text` to `agent`. Without an agent it is disabled.
const toAgent = (view, agent, id, t, label, text, opts) =>
  boxy(t, id, label, { ...opts, disabled: !agent, onClick: agent && ((_e, cx) => view.sendToAgent(agent, text, cx)) })
    .tooltip(agent ? `Send to ${agent.title}` : "Focus an agent's pane first.");

function bar(view, entry, res, t) {
  const issue = res.data?.issue;
  const icon = (id, onClick, label) => action(id, t, onClick).size(26).flex_none().justify_center().text_color(t.muted).child(label);
  return div().flex_none().border_b(1).border_color(t.border)
    .child(h_flex().w_full().max_w(COLUMN).mx_auto().h(36).px(6).gap(2).items_center()
      .when(view.stack.length > 1, (e) => e.child(icon("ticket-back", (_e, cx) => view.back(cx), "←")))
      .child(div().flex_1().min_w(0).px(4).truncate().font_medium().child(issue?.identifier ?? entry.key))
      .child(icon("ticket-refresh", (_e, cx) => view.load(cx, { force: true }), res.loading ? spinner() : "↻"))
      .when(Boolean(issue), (e) => e.child(icon("ticket-star", (_e, cx) => view.star(issue, cx), issue.favorite ? "★" : "☆")
        .when(Boolean(issue.favorite), (s) => s.text_color(t.accent))
        .tooltip(issue.favorite ? "Remove from favorites" : "Add to favorites")))
      .when(Boolean(issue) && !view.ticket, (e) => e.child(icon("ticket-pane", (_e, cx) => view.openPane(issue, cx), "⧉").tooltip("Open in a pane beside")))
      .when(Boolean(issue?.url), (e) => e.child(icon("ticket-open", (_e, cx) => cx.open_url(issue.url), "↗"))));
}

function header(view, issue, t, agent) {
  const facts = [
    issue.priority > 0 && chip(t, issue.priorityLabel),
    ...(issue.labels?.nodes ?? []).map((l) => chip(t, l.name, l.color ?? t.dim)),
    ...[
      issue.project?.name,
      issue.cycle && (issue.cycle.name || `Cycle ${issue.cycle.number}`),
      issue.dueDate && `Due ${issue.dueDate}`,
      issue.estimate != null && `${issue.estimate} ${issue.estimate === 1 ? "pt" : "pts"}`,
    ].filter(Boolean).map((f) => chip(t, f)),
  ].filter(Boolean);
  const parent = issue.parent;
  return v_flex()
    .child(v_flex().px(14).pt(16).gap(10)
      .child(div().text_size(20).line_height(1.3).font_semibold().child(issue.title))
      .child(h_flex().id("ticket-props").gap(6).flex_wrap().items_center()
        .child(statusMenu(view, issue, t))
        .child(assigneeMenu(view, issue, t)))
      .when(facts.length > 0, (e) => e.child(h_flex().gap(6).flex_wrap().items_center().children(facts))))
    .when(Boolean(parent), (e) => e.child(div().px(6).pt(6)
      .child(row(`parent-${parent.identifier}`, t, (_e, cx) => view.open(parent.identifier, cx, parent.title))
        .child(div().flex_none().text_color(t.dim).child("Parent"))
        .child(div().flex_none().text_color(t.muted).child(parent.identifier))
        .child(div().flex_1().min_w(0).truncate().child(parent.title)))))
    .child(h_flex().id("ticket-actions").px(14).pt(12).gap(6).flex_wrap()
      .child(startMenu(view, issue, t))
      .child(toAgent(view, agent, "send-ticket", t, "Send to agent", ticketLine(issue)))
      .child(copyMenu(view, issue, t)));
}

// The agents people can start, as Herdr's + menu lists them: installed ones, then two that are not installed.
function startMenu(view, issue, t) {
  const installed = view.known.filter((a) => a.installed);
  const choices = [...installed, ...view.known.filter((a) => !a.installed).slice(0, 2)];
  const icon = (a) => (!a.icon ? div().size(14) : a.tint ? svg(a.icon).size(14).text_color(t.foreground) : image(a.icon).size(14));
  const rows = choices.map((a) =>
    (a.installed ? item(view, `start-${a.key}`, t, () => view.startAgent(issue, a)) : disabledItem(t))
      .child(icon(a))
      .child(div().flex_1().min_w(0).truncate().child(a.name))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(a.installed ? "" : "not installed")));
  return menu(view, "start", t, trigger(t, "start-trigger", "Start agent ▾"), [
    div().px(8).pt(4).pb(4).text_size(11).text_color(t.dim).child("Start an agent"),
    ...rows,
    ...(choices.length ? [] : [disabledItem(t).child(view.knownFailed ? "Couldn't list agents" : "Checking agents…")]),
  ], (cx) => view.loadAgents(cx));
}

function statusMenu(view, issue, t) {
  const current = issue.state;
  return menu(view, "status", t,
    trigger(t, "status-trigger", [dot(current.color, t), current.name, "▾"]),
    statusOptions(issue.team?.states?.nodes ?? []).map((s) =>
      item(view, `status-${s.id}`, t, (cx) => s.id !== current.id && view.update(issue, { stateId: s.id }, cx))
        .child(dot(s.color, t))
        .child(div().flex_1().min_w(0).truncate().child(s.name))
        .when(s.id === current.id, (e) => e.child(div().flex_none().text_color(t.accent).child("✓")))));
}

function assigneeMenu(view, issue, t) {
  const mine = Boolean(view.viewerId) && issue.assignee?.id === view.viewerId;
  const label = mine ? "Unassign" : "Assign to me";
  return menu(view, "assignee", t,
    trigger(t, "assignee-trigger", [issue.assignee?.name ?? "Unassigned", "▾"]),
    [view.viewerId
      ? item(view, "assign", t, (cx) => view.update(issue, { assigneeId: mine ? null : view.viewerId }, cx)).child(label)
      : disabledItem(t).child(label)]);
}

function copyMenu(view, issue, t) {
  const copy = (id, label, text) =>
    item(view, `copy-${id}`, t, (cx) => {
      cx.write_to_clipboard(text);
      notify({ title: "Copied", body: text, timeout: 2000 });
    }).child(label);
  return menu(view, "copy", t, trigger(t, "copy-trigger", "Copy ▾"),
    [copy("id", "ID", issue.identifier), copy("branch", "Branch name", issue.branchName), copy("link", "Link", issue.url)]);
}

function comment(c, t, now, actions) {
  return v_flex().px(12).py(10).gap(4)
    .child(h_flex().gap(8).items_center().text_size(12)
      .child(div().min_w(0).truncate().font_semibold().child(c.user?.name ?? "Integration"))
      .child(div().flex_none().text_color(t.dim).child(relativeTime(c.createdAt, now)))
      .child(div().flex_1())
      .child(h_flex().id(`comment-actions-${c.id}`).flex_none().gap(6).children(actions)))
    .child(markdown(`c-${c.id}`, c.body));
}

// The comment box: under the thread it replies to, else after the last thread. ⌘Enter sends.
function composer(view, key, t) {
  const d = view.drafts[key];
  if (!d) return null;
  return v_flex().gap(6)
    .when(Boolean(d.parent), (e) => e.child(h_flex().gap(6).items_center().text_size(11.5)
      .child(div().min_w(0).truncate().child(`Replying to ${d.parent.name}`))
      .child(boxy(t, "reply-cancel", "×", { ...SMALL, onClick: (_e, cx) => {
        d.parent = null;
        cx.notify();
      } }))))
    .child(Textarea.new(d.input).w_full().px(8).py(6).rounded(6).border_1().border_color(t.input).bg(t.background).text_size(13))
    .child(h_flex().gap(6).items_center()
      .child(div().flex_1().text_size(11).text_color(t.dim).child("⌘↵"))
      .child(boxy(t, "comment-send", d.sending ? spinner() : "Send", { kind: "primary", onClick: (_e, cx) => view.sendComment(key, cx) })));
}

// Each thread is one card: the comment, its replies under rules, and the comment box when it replies to this thread.
function comments(view, key, issue, t, agent) {
  const list = issue.comments?.nodes ?? [];
  const now = Date.now();
  const threads = buildThreads(list);
  const replyTo = view.drafts[key]?.parent?.id;
  const send = (c) => toAgent(view, agent, `send-${c.id}`, t, "Send", commentText(issue, c), SMALL);
  const reply = (c) => boxy(t, `reply-${c.id}`, "Reply", { ...SMALL, onClick: (_e, cx) => view.reply(key, c, cx) });
  const rule = (el) => el.border_t(1).border_color(t.border);
  // A reply whose thread is gone keeps the box at the end.
  const under = threads.some((x) => x.comment.id === replyTo);
  return section(t, list.length ? `Comments ${list.length}` : "Comments", [
    ...threads.map(({ comment: c, replies }) =>
      v_flex().mx(8).mt(8).rounded(8).border_1().border_color(t.border).bg(t.raised)
        .child(comment(c, t, now, [reply(c), send(c)]))
        .children(replies.map((r) => rule(comment(r, t, now, [send(r)]).pl(28))))
        .when(c.id === replyTo, (e) => e.child(rule(composer(view, key, t).px(12).py(10))))),
    !under && composer(view, key, t)?.mx(8).mt(12),
  ].filter(Boolean));
}

function sections(view, key, issue, t, agent) {
  const subs = issue.children?.nodes ?? [];
  const done = subs.filter((s) => s.state.type === "completed").length;
  const rel = relationsOf(issue);
  return [
    section(t, `Sub-issues ${done}/${subs.length}`, subs.map((s) => issueRow(view, t, `sub-${s.identifier}`, s, s.state.name))),
    section(t, "Links", (issue.attachments?.nodes ?? []).map((a, i) =>
      // Only a web link opens: an attachment can carry any scheme.
      (/^https?:\/\//i.test(a.url) ? row(`link-${i}`, t, (_e, cx) => cx.open_url(a.url)) : disabledItem(t))
        .child(div().min_w(0).truncate().child(a.title))
        // Integrations put markdown, code fences and line breaks in the subtitle.
        .when(Boolean(a.subtitle), (e) => e.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(oneLine(a.subtitle)))))),
    ...RELATIONS.map(([kind, label]) => section(t, label, rel[kind].map((x, i) => issueRow(view, t, `rel-${kind}-${i}-${x.identifier}`, x)))),
    comments(view, key, issue, t, agent),
  ].filter(Boolean);
}

export function renderTicket(view, cx) {
  const t = theme();
  const entry = view.top();
  const res = view.results[view.key(entry)] ?? { loading: true };
  const issue = res.data?.issue;
  // A ticket pane sits in Herdr's pane frame, so it draws no card of its own.
  const shell = frame(t, Boolean(view.ticket)).child(bar(view, entry, res, t));
  if (res.error && (res.error.kind !== "offline" || !issue)) return shell.child(renderProblem(view, res.error));
  if (!issue) return shell.child(res.loading ? loadingLine(t) : div().p(14).text_color(t.dim).child(`${entry.key} not found`));
  const agent = view.agent(issue);
  return shell
    .when(res.error?.kind === "offline", (e) => e.child(renderProblem(view, res.error)))
    .child(v_flex().id(`ticket-${issue.identifier}`).flex_1().min_h(0).overflow_y_scrollbar()
      .child(v_flex().w_full().max_w(COLUMN).mx_auto()
        .child(header(view, issue, t, agent))
        .when(Boolean(issue.description?.trim()), (e) => e.child(div().px(14).pt(16).child(markdown(`desc-${issue.identifier}`, issue.description))))
        .children(sections(view, entry.key, issue, t, agent))
        .child(div().h(24).flex_none())));
}
