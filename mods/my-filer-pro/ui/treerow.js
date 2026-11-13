// The row under the Files header: the find row (cmd-f) or the move-terminal row (the header button, the pane menu).
import { div, svg } from "gpui-kit";
import { h_flex, v_flex, Input, Popup, v_virtual_list, Scrollbar } from "gpui-base";
import { boxy, card } from "../boxy.js";
import { matchRange } from "../lib/treefind.js";
import { BASE } from "../lib/icons.js";

const iconButton = (t, id, glyph, label, onClick) => boxy(t, id, svg(`${BASE}/${glyph}.svg`).size(13), { h: 20, px: 5, onClick: (_e, cx) => onClick(cx) })
  .tooltip(label).accessibility_label(label);

const field = (t, input) => h_flex().flex_1().min_w(0).h(26).px(8).items_center().rounded(6).border_1().border_color(t.accent).bg(t.background)
  .child(Input.new(input).flex_1().h_full().text_size(12.5).text_color(t.foreground));

// state: { input, count ("n/m"), none (no match) }; handlers: { onStep(dir, cx), onClose(cx) }
export function findRow(t, state, handlers) {
  return h_flex().id("files-find-row").flex_none().h(38).px(10).gap(6).items_center().border_b(1).border_color(t.border)
    .on_key_down((e, cx) => {
      if (e.key === "escape") handlers.onClose(cx);
      else if (e.key === "down") handlers.onStep(1, cx);
      else if (e.key === "up") handlers.onStep(-1, cx);
      else return;
      cx.stop_propagation();
    })
    .child(svg(`${BASE}/search.svg`).size(13).flex_none().text_color(t.foreground))
    .child(field(t, state.input))
    .child(div().flex_none().w(44).text_right().text_size(11.5).text_color(state.none ? t.ansi1 : t.foreground).child(state.count))
    .child(iconButton(t, "files-find-prev", "chevron-up", "Previous match", (cx) => handlers.onStep(-1, cx)))
    .child(iconButton(t, "files-find-next", "chevron-down", "Next match", (cx) => handlers.onStep(1, cx)))
    .child(iconButton(t, "files-find-close", "x", "Close", (cx) => handlers.onClose(cx)));
}

// The folders under the move row's input, floating over the tree at the input's width: up to SHOWN rows, the rest scroll.
// The highlighted one is a card; the typed part of each name is semibold.
const ROW = 28, SHOWN = 10;
function suggestions(t, { items, at }, prefix, width, scroll, onPick) {
  const row = (name, i) => {
    const range = matchRange(name, prefix);
    const label = range
      ? h_flex().child(div().child(name.slice(0, range[0]))).child(div().font_semibold().child(name.slice(range[0], range[1]))).child(div().child(name.slice(range[1])))
      : div().child(name);
    return card(t, h_flex().id(`files-move-suggest-${i}`).flex_none().h(ROW).px(8).gap(8).items_center().rounded(8).cursor_pointer().text_size(12.5).text_color(t.foreground), i === at)
      .child(svg(`${BASE}/folder.svg`).size(14).flex_none().text_color(t.foreground))
      .child(div().flex_1().min_w(0).truncate().child(label));
  };
  return v_flex().id("files-move-suggest").w(width).mt(4).p(4).rounded(8).border_1().border_color(t.border).bg(t.popover).shadow_md()
    .child(v_flex().id("files-move-suggest-box").relative().flex_none().h(Math.min(SHOWN, items.length) * ROW)
      .child(v_virtual_list("files-move-suggest-list", items.length, items.map(() => ROW), (i) => items[i],
        (range) => items.slice(range.start, range.end).map((name, k) => row(name, range.start + k)))
        .track_scroll(scroll).size_full()
        .on_item_click((name, cx) => onPick(name, cx)))
      .child(Scrollbar.vertical("files-move-suggest-list").absolute().inset_0()));
}

// The row that types `cd <folder>` into one terminal: what moves where, the input with its folder dropdown and the
// button. The message (error, or the not-a-shell note) sits on line 1, so the dropdown never covers it.
// state: { input, target: { name, shell, program }, error, suggest: { items, at } | null, prefix (the typed folder name),
// width (the input's in style px, for the dropdown), scroll (the dropdown's VirtualListScrollHandle) };
// handlers: { onGo(cx), onClose(cx), onKey(e, cx) (true when it took the key), onPick(name, cx), onWidth(px, cx) }
export function moveRow(t, state, handlers) {
  const { target, suggest } = state;
  const note = state.error ?? (target.shell ? null : `${target.name} is running ${target.program}: nothing will be typed`);
  const input = field(t, state.input).id("files-move-field").w_full();
  return v_flex().id("files-move-row").flex_none().px(10).py(8).gap(6).border_b(1).border_color(t.border).text_color(t.foreground)
    .on_key_down((e, cx) => {
      if (handlers.onKey(e, cx)) cx.stop_propagation();
      else if (e.key === "escape") { handlers.onClose(cx); cx.stop_propagation(); }
    })
    .child(h_flex().w_full().gap(6).items_center().text_size(12.5)
      .child(svg(`${BASE}/square-terminal.svg`).size(14).flex_none().text_color(t.foreground))
      .child(div().flex_none().child("Move terminal"))
      .child(div().min_w(0).truncate().font_semibold().child(target.name))
      .child(div().flex_none().child("to"))
      .child(note ? div().id("files-move-note").flex_1().min_w(0).truncate().text_size(11.5).text_color(t.ansi1).child(note).tooltip(note) : div().flex_1())
      .child(iconButton(t, "files-move-close", "x", "Close", (cx) => handlers.onClose(cx))))
    .child(h_flex().w_full().gap(6).items_center()
      .child(div().id("files-move-slot").flex_1().min_w(0).on_size_change((size, cx) => handlers.onWidth(size.width, cx))
        .child(Popup.new("files-move-popup", input).w_full().anchor("top_left")
          .when(Boolean(suggest?.items.length && state.width), (el) => el.content(suggestions(t, suggest, state.prefix, state.width, state.scroll, handlers.onPick)))))
      .child(boxy(t, "files-move-go", "Move terminal", { kind: "primary", h: 22, px: 8, size: 11.5, disabled: !target.shell, onClick: target.shell ? (_e, cx) => handlers.onGo(cx) : undefined })));
}
