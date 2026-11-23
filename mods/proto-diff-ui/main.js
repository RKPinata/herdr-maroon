// PROTOTYPE for "Diff mod UI" (herdr-maroon#9). Throwaway: fake session, real diffs from fixture.js, Send is a stub.
// props().variant: "panel" (side panel block, follows focus) or "full" (the panel's full view, a large dialog).
import { View, div } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, v_virtual_list } from "gpui-base";
import { theme, settings, props, openOverlay, closeOverlay, nextCommand } from "herdr";
import { boxy } from "./boxy.js";
import { parseDiff } from "./diff.js";
import * as fx from "./fixture.js";

const mono = () => settings().font_family ?? "JetBrains Mono";
const ROW = 20;

const files = (text) => [...new Map(parseDiff(text).map((f) => [f.path, f])).values()];
const SESSION = { title: "Session diffs in Herdr", id: "23b97dd7" };
const TARGETS = [
  { kind: "dir", name: "maroon", path: "~/Repo/Tooling/Herdr/maroon", branch: "feat/diff-mod", base: "main", source: "declared", pr: "PR #1234 · open", files: files(fx.A) },
  { kind: "dir", name: "annotator", path: "~/Repo/Tooling/Herdr/annotator", branch: "fix/rows", base: "origin/main", source: "default branch", pr: null, files: files(fx.B) },
  { kind: "pr", name: "herdr-linear #57", path: "RKPinata/herdr-linear", branch: "fold-tests", base: "main", source: "PR base", pr: null, files: files(fx.C) },
];
const QUEUE = [
  { kind: "board", where: 'Whiteboard, "Plan"', text: "- Move the queue to globalThis", comment: "do this before the diff mod" },
  { kind: "diff", where: "maroon/scripts/sandbox.sh:21-22", text: 'home=$HOME/.cache/herdr-sandbox/$name', comment: "why not under $TMPDIR?" },
];

const split = (p) => { const i = p.lastIndexOf("/"); return { dir: i < 0 ? "" : p.slice(0, i + 1), name: p.slice(i + 1) }; };
const total = (fs) => fs.reduce((a, f) => [a[0] + f.added, a[1] + f.removed], [0, 0]);
const stat = (t, a, r) => h_flex().flex_none().gap(5).text_size(11).child(div().text_color(t.ansi2).child(`+${a}`)).child(div().text_color(t.ansi1).child(`−${r}`));

export default class ProtoDiff extends View {
  init(_p, cx) {
    this.variant = props()?.variant ?? "panel";
    this.target = props()?.target ?? 0; this.file = props()?.file ?? 0; this.picked = null;
    this.queue = [...QUEUE]; this.sent = null;
    // `herdr-app do proto-diff-ui.full` opens the full view, as the button does.
    if (this.variant === "panel") cx.spawn(async () => { for (;;) if (await nextCommand() === "full") this.openFull(); });
  }

  // One diff line; `gutters` is 1 (new-side number only, narrow) or 2 (old and new).
  line(l, t, key, gutters) {
    if (l.kind === "hunk" || l.kind === "meta") return h_flex().w_full().h(ROW).flex_none().px(10).items_center().bg(t.raised).text_color(t.dim).child(div().truncate().child(`@@ ${l.text || ""}`));
    const add = l.kind === "add", del = l.kind === "del", on = this.picked === key;
    const num = (n) => div().w(34).flex_none().text_right().pr(4).text_color(t.dim).child(n === undefined ? "" : String(n));
    return h_flex().w_full().h(ROW).flex_none().items_center().cursor_pointer()
      .when(on, (e) => e.bg(t.selected)).when(!on && add, (e) => e.bg(t.ansi2 + "18")).when(!on && del, (e) => e.bg(t.ansi1 + "18"))
      .when(gutters === 2, (e) => e.child(num(l.oldNo)))
      .child(num(gutters === 2 ? l.newNo : (l.newNo ?? l.oldNo)))
      .child(div().w(14).flex_none().text_center().text_color(add ? t.ansi2 : del ? t.ansi1 : t.dim).child(add ? "+" : del ? "−" : ""))
      .child(div().whitespace_nowrap().child(l.text || " "));
  }

  // A scrolling, horizontally pannable list of rows: [{h, key, el(t)}].
  rows(id, rows, t) {
    const w = Math.max(300, ...rows.map((r) => (r.len ?? 0) * 7 + 70));
    return div().flex_1().min_h(0).w_full().relative().font_family(mono()).text_size(11.5)
      .child(div().id(`${id}-x`).size_full().overflow_x_scrollbar().child(div().w_full().min_w(w).h_full().child(
        v_virtual_list(id, rows.length, rows.map((r) => r.h), (i) => rows[i].key, (r) => rows.slice(r.start, r.end).map((x) => x.el(t)))
          .on_item_click((key, cx) => { const r = rows.find((x) => x.key === key); r?.click?.(cx); }).size_full())))
      .child(Scrollbar.vertical(id).viewport_from_layout().absolute().inset_0());
  }

  fileRows(ti, fi, gutters) {
    const f = TARGETS[ti].files[fi];
    return f.lines.map((l, i) => {
      const key = `${ti}:${fi}:${i}`;
      return { h: ROW, key, len: l.text?.length, el: (t) => this.line(l, t, key, gutters), click: (cx) => this.comment(ti, f, l, key, cx) };
    });
  }

  // Stub: a click on a line queues a canned comment, to show where it lands.
  comment(ti, f, l, key, cx) {
    if (l.kind === "hunk" || l.kind === "meta") return;
    this.picked = key;
    if (this.queue.length < 20) this.queue.push({ kind: "diff", where: `${TARGETS[ti].name}/${f.path}:${l.newNo ?? l.oldNo}`, text: l.text, comment: "(prototype comment)" });
    cx.notify();
  }

  openFull() {
    openOverlay({ mod: "proto-diff-ui", props: { variant: "full", target: this.target, file: this.file }, kind: "dialog", width: 0.92, height: 0.92 });
  }

  // Header: whose scope this is, and how the mod chose that session.
  header(t, how, button) {
    return h_flex().h(36).flex_none().px(10).gap(8).items_center().border_b(1).border_color(t.border)
      .child(div().w(8).h(8).rounded(4).bg(t.ansi2).flex_none())
      .child(div().min_w(0).truncate().font_medium().child(SESSION.title))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(how))
      .child(div().flex_1())
      .child(boxy(t, "refresh", "↻", { h: 20, px: 6 }))
      .child(button);
  }

  // Branch → base (where the base came from) · PR line.
  meta(t, x) {
    return h_flex().w_full().gap(6).items_center().text_size(11).text_color(t.dim).overflow_hidden()
      .child(div().flex_none().text_color(t.muted).child(x.kind === "pr" ? x.path : x.branch))
      .child(div().flex_none().child("→"))
      .child(div().flex_none().text_color(t.muted).child(x.base))
      .child(div().flex_none().child(`(${x.source}) ▾`))
      .when(Boolean(x.pr), (e) => e.child(div().flex_none().child("·")).child(div().flex_none().text_color(t.accent).cursor_pointer().child(`${x.pr} ↗`)));
  }

  queueList(t, max) {
    if (this.sent) return div().p(10).text_size(11.5).text_color(t.dim).child(this.sent);
    return v_flex().w_full().flex_none().border_t(1).border_color(t.border).bg(t.raised)
      .child(h_flex().h(32).px(10).gap(8).items_center().flex_none()
        .child(div().font_medium().text_size(12).child(`Comments · ${this.queue.length}/20`))
        .child(div().flex_1())
        .child(boxy(t, "send", "Send to session", { h: 20, kind: "primary", onClick: (_e, cx) => { this.sent = `Sent ${this.queue.length} comments (stub; nothing sent).`; this.queue = []; cx.notify(); } })))
      .child(v_flex().id("queue").max_h(max).overflow_y_scrollbar().px(10).pb(8).gap(6).children(this.queue.map((q, i) =>
        v_flex().id(`q-${i}`).w_full().p(8).gap(3).rounded(6).bg(t.background).border_1().border_color(t.border).text_size(11.5)
          .child(h_flex().gap(6).child(div().flex_none().text_color(q.kind === "board" ? t.accent : t.ansi4).child(q.kind === "board" ? "board" : "diff")).child(div().min_w(0).truncate().text_color(t.dim).child(q.where)).child(div().flex_1()).child(div().text_color(t.dim).cursor_pointer().child("×")))
          .child(div().font_family(mono()).text_size(11).text_color(t.muted).truncate().child(`> ${q.text}`))
          .child(div().child(q.comment)))));
  }

  // Panel: a summary that follows the focused session. Every target with its files; a file click opens the full view there.
  panel(t) {
    return v_flex().size_full()
      .child(this.header(t, "· follows focus", boxy(t, "full", "⤢", { h: 20, px: 6, onClick: () => this.openFull() })))
      .child(v_flex().id("tree").flex_1().min_h(0).p(6).overflow_y_scrollbar()
        .children(this.tree(t, false, (ti, fi) => { this.target = ti; this.file = fi; this.openFull(); }))
        .child(div().px(8).py(8).text_size(11.5).text_color(t.dim).cursor_pointer().child("+ Add a folder or PR")))
      .child(this.queueList(t, 220));
  }

  // Every target, then its files. `mark` highlights the open file.
  tree(t, mark, pick) {
    return TARGETS.flatMap((y, ti) => {
      const [a, r] = total(y.files);
      const head = v_flex().id(`tt-${ti}`).w_full().flex_none().px(8).py(6).gap(2).mt(ti ? 6 : 0)
        .child(h_flex().gap(6).items_center().child(div().text_color(t.dim).child(y.kind === "pr" ? "⇄" : "▸")).child(div().font_medium().text_size(12.5).child(y.name)).child(div().flex_1()).child(stat(t, a, r)))
        .child(this.meta(t, y));
      return [head, ...y.files.map((g, fi) => {
        const { dir, name } = split(g.path), on = mark && ti === this.target && fi === this.file;
        return h_flex().id(`tf-${ti}-${fi}`).w_full().h(24).flex_none().pl(22).pr(6).gap(6).items_center().rounded(5).cursor_pointer().text_size(12)
          .when(on, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover)).on_click((_e, cx) => { pick(ti, fi); cx.notify(); })
          .child(div().flex_none().child(name)).child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(dir)).child(stat(t, g.added, g.removed));
      })];
    });
  }

  // Full view: a large dialog over the window, opened from the panel on the panel's session and file. Targets and files as one tree, diff in the middle, queue on the right.
  full(t) {
    const x = TARGETS[this.target], f = x.files[this.file];
    const tree = this.tree(t, true, (ti, fi) => { this.target = ti; this.file = fi; });
    return v_flex().size_full()
      .child(this.header(t, "· from the panel", boxy(t, "close", "✕  Esc", { h: 20, px: 6, onClick: () => closeOverlay(props().overlay) })))
      .child(h_flex().flex_1().min_h(0).items_start()
        .child(v_flex().id("tree").w(300).flex_none().h_full().p(6).border_r(1).border_color(t.border).overflow_y_scrollbar().children(tree)
          .child(div().px(8).py(8).text_size(11.5).text_color(t.dim).cursor_pointer().child("+ Add a folder or PR")))
        .child(v_flex().flex_1().min_w(0).h_full()
          .child(h_flex().h(30).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border).text_size(12)
            .child(div().text_color(t.dim).child(`${x.name} /`)).child(div().min_w(0).truncate().child(f.path)).child(div().flex_1()).child(stat(t, f.added, f.removed)))
          .child(this.rows(`b-${this.target}-${this.file}`, this.fileRows(this.target, this.file, 2), t)))
        .child(v_flex().w(300).flex_none().h_full().border_l(1).border_color(t.border).child(this.queueList(t, 2000))));
  }

  render() {
    const t = theme();
    const body = this.variant === "full" ? this.full(t) : this.panel(t);
    return v_flex().id("proto-diff").size_full().min_h(0).overflow_hidden().bg(t.background).text_color(t.foreground).text_size(13)
      .child(div().flex_none().px(10).py(2).bg(t.ansi3 + "30").text_size(10.5).text_color(t.muted).child(`PROTOTYPE · variant: ${this.variant}`))
      .child(div().flex_1().min_h(0).child(body));
  }
}
