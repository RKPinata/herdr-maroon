// The row under the Files header: the find row (cmd-f) or the go-to row (the folder button, the pane menu).
import { div, svg } from "gpui-kit";
import { h_flex, Input } from "gpui-base";
import { boxy } from "../boxy.js";
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

// state: { input, error }; handlers: { onGo(cx), onClose(cx) }
export function gotoRow(t, state, handlers) {
  return h_flex().id("files-goto-row").flex_none().min_h(38).px(10).py(6).gap(6).items_center().flex_wrap().border_b(1).border_color(t.border)
    .on_key_down((e, cx) => { if (e.key === "escape") { handlers.onClose(cx); cx.stop_propagation(); } })
    .child(svg(`${BASE}/folder-input.svg`).size(13).flex_none().text_color(t.foreground))
    .child(field(t, state.input))
    .child(boxy(t, "files-goto-go", "Go", { h: 20, px: 8, size: 11.5, onClick: (_e, cx) => handlers.onGo(cx) }))
    .child(iconButton(t, "files-goto-close", "x", "Close", (cx) => handlers.onClose(cx)))
    .when(Boolean(state.error), (el) => el.child(div().w_full().text_size(11.5).text_color(t.ansi1).child(state.error)));
}
