// Quick open (cmd-k, the header's search button): a popup that finds files under the Files root by name, ranked
// like VS Code (lib/finder.js), and hands the pick to the panel. State lives in createQuickOpen (init), the view
// in quickOpenView (render).
import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, v_virtual_list, Scrollbar, VirtualListScrollHandle } from "gpui-base";
import { boxy, card } from "../boxy.js";
import { icon, BASE } from "../lib/icons.js";
import { recentUnder, stepRow } from "../lib/finder.js";

const ROW = 30, HEAD = 24;

// The list rows of a result: a header, then items, per group.
function rowsOf(result) {
  const rows = [];
  if (result.recent.length) {
    rows.push({ kind: "head", key: "h-recent", text: "recently opened" });
    for (const item of result.recent) rows.push({ kind: "item", key: `r-${item.path}`, item });
  }
  if (result.files.length) {
    rows.push({ kind: "head", key: "h-files", text: "file results" });
    for (const item of result.files) rows.push({ kind: "item", key: `f-${item.path}`, item });
  }
  return rows;
}

// target: { root, on, hide } (root null: no folder); deps: { finder, onPick(item, open, at, cx) }, at: { line, column }.
export function createQuickOpen(target, deps, cx) {
  const state = { target, query: "", result: null, rows: [], at: 0, error: null, loading: Boolean(target.root), seq: 0, recent: [] };
  state.input = InputState.new({ placeholder: "Go to file…" });
  state.handle = cx.focus_handle();
  state.scroll = VirtualListScrollHandle.new();
  state.entry = target.root ? deps.finder.files(target) : null;

  // Runs the current query; a reply for an older query is dropped. A machine waits 120 ms for more typing first.
  state.run = (cx) => {
    if (!state.entry) return;
    const seq = ++state.seq, text = state.query;
    cx.spawn(async (cx) => {
      try {
        if (target.on) { await cx.sleep(120); if (seq !== state.seq) return; }
        if (state.entry.loading) await state.entry.ready;
        if (seq !== state.seq) return;
        if (state.entry.state === "error") throw new Error(state.entry.error);
        const result = await deps.finder.search(state.entry, text, { on: target.on, recent: state.recent, hide: target.hide });
        if (seq !== state.seq) return;
        state.result = result;
        state.rows = rowsOf(result);
        state.at = Math.max(0, state.rows.findIndex((r) => r.kind === "item"));
        state.error = null;
      } catch (e) {
        if (seq !== state.seq) return;
        state.error = String(e?.message ?? e);
        state.rows = [];
      }
      state.loading = false;
      state.scroll.scroll_to_item(0);
      cx.notify();
    });
  };
  // Lists the root again (after an error), then runs the query.
  state.retry = (cx) => {
    state.entry = deps.finder.files(target);
    state.error = null; state.loading = true;
    state.run(cx);
    cx.notify();
  };
  // open false: reveal in the tree only (cmd-enter).
  state.pick = (i, open, cx) => {
    const r = state.rows[i];
    if (r?.kind === "item") deps.onPick(r.item, open, { line: state.result?.line ?? null, column: state.result?.column ?? null }, cx);
  };
  state.input.on("change", (_e, cx) => { state.query = state.input.value(); state.run(cx); });
  state.input.on("submit", (e, cx) => state.pick(state.at, !e.secondary, cx));
  cx.spawn(async (cx) => {
    const { doc } = await deps.finder.readRecent();
    state.recent = target.root ? recentUnder(doc, target.on, target.root) : [];
    state.run(cx);
  });
  state.input.focus();
  cx.timer.after(600, () => state.input.focus());
  return state;
}

// text with the [start, end) ranges in the accent, semibold.
function highlighted(t, text, ranges, size) {
  const parts = [];
  let at = 0;
  for (const [start, end] of ranges ?? []) {
    if (start > at) parts.push(div().flex_none().child(text.slice(at, start)));
    parts.push(div().flex_none().text_color(t.accent).font_semibold().child(text.slice(start, end)));
    at = end;
  }
  if (at < text.length) parts.push(div().flex_none().child(text.slice(at)));
  return h_flex().text_size(size).children(parts);
}

function rowView(t, row, on, dark) {
  if (row.kind === "head") return div().id(row.key).h(HEAD).px(8).flex().items_end().pb(3).text_size(10.5).font_semibold().text_color(t.foreground).child(row.text);
  const { item } = row;
  return card(t, h_flex().id(row.key).h(ROW).px(8).gap(8).items_center().rounded(8).cursor_pointer(), on)
    .child(image(icon(item.path, false, false, dark)).size(16).flex_none())
    .child(highlighted(t, item.label, item.labelHits, 13).flex_none())
    .child(highlighted(t, item.dir, item.dirHits, 11.5).flex_1().min_w(0).overflow_hidden());
}

// handlers: { onClose() }
export function quickOpenView(t, state, dark, rootLabel, handlers) {
  const { rows } = state;
  const move = (delta, cx) => { state.at = stepRow(rows, state.at, delta); state.scroll.scroll_to_item(state.at); cx.notify(); };
  const message = state.error ?? (!state.target.root ? "No folder to search" : state.loading ? "Listing files…" : state.query.trim() ? "No matching files" : "Type to find a file");
  return v_flex().id("quick-open").track_focus(state.handle).size_full().p(12).gap(8).bg(t.popover).text_color(t.foreground).text_size(13)
    .on_key_down((e, cx) => {
      const k = e.key;
      if (k === "escape") { handlers.onClose(); cx.stop_propagation(); return; }
      if (k === "down" || (k === "n" && e.modifiers.control)) move(1, cx);
      else if (k === "up" || (k === "p" && e.modifiers.control)) move(-1, cx);
      else if (k === "pagedown") move(10, cx);
      else if (k === "pageup") move(-10, cx);
      else return;
      cx.stop_propagation();
    })
    .child(h_flex().items_center().gap(8)
      .child(div().flex_none().text_size(14).font_semibold().child("Go to file"))
      .child(div().flex_1().min_w(0).truncate().text_size(12).child(rootLabel))
      .child(boxy(t, "quick-open-esc", "Esc", { h: 16, px: 6, size: 11, onClick: () => handlers.onClose() }).tooltip("Close")))
    .child(h_flex().h(34).flex_none().px(10).gap(8).items_center().rounded(8).border_1().border_color(t.accent).bg(t.background)
      .child(svg(`${BASE}/search.svg`).size(14).text_color(t.foreground))
      .child(Input.new(state.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)))
    .child(rows.length
      ? v_flex().id("quick-open-box").relative().flex_1().min_h(0)
        .child(v_virtual_list("quick-open-list", rows.length, rows.map((r) => (r.kind === "head" ? HEAD : ROW)), (i) => rows[i].key,
          (range) => rows.slice(range.start, range.end).map((r, k) => rowView(t, r, range.start + k === state.at, dark)))
          .track_scroll(state.scroll).size_full()
          .on_item_click((key, cx) => { const i = rows.findIndex((r) => r.key === key); if (i >= 0) state.pick(i, true, cx); }))
        .child(Scrollbar.vertical("quick-open-list").absolute().inset_0())
      : h_flex().flex_1().px(8).gap(8).items_start()
        .child(div().text_size(12).text_color(state.error ? t.ansi1 : t.foreground).child(message))
        .when(Boolean(state.error), (el) => el.child(boxy(t, "quick-open-retry", "Retry", { h: 20, px: 8, size: 11.5, onClick: (_e, cx) => state.retry(cx) }))))
    .when(Boolean(state.entry?.truncated), (el) => el.child(div().flex_none().text_size(11).child(`Listed the first ${state.entry.count} files`)));
}
