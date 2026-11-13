// The row under the Files header: the find row (cmd-f) or the move-terminal row (the header button, the pane menu).
import { div, svg } from "gpui-kit";
import { h_flex, v_flex, Input } from "gpui-base";
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

// The folders under the move row's input; the highlighted one is a card. The matched part of each name is semibold.
function suggestions(t, { items, at }, prefix, onPick) {
  return v_flex().id("files-move-suggest").w_full().gap(2)
    .children(items.map((name, i) => {
      const range = matchRange(name, prefix);
      const label = range
        ? h_flex().child(div().child(name.slice(0, range[0]))).child(div().font_semibold().child(name.slice(range[0], range[1]))).child(div().child(name.slice(range[1])))
        : div().child(name);
      return card(t, h_flex().id(`files-move-suggest-${i}`).flex_none().h(30).px(8).gap(8).items_center().rounded(8).cursor_pointer().text_size(12.5)
        .on_click((_e, cx) => onPick(name, cx)), i === at)
        .child(svg(`${BASE}/folder.svg`).size(14).flex_none().text_color(t.foreground))
        .child(div().flex_1().min_w(0).truncate().child(label));
    }));
}

// The row that types `cd <folder>` into one terminal.
// state: { input, target: { name, shell, program }, error, suggest: { items, at } | null, prefix (the typed folder name) };
// handlers: { onGo(cx), onClose(cx), onKey(e, cx) (Tab, up, down; true when it took the key), onPick(name, cx) }
export function moveRow(t, state, handlers) {
  const { target } = state;
  const note = state.error ?? (target.shell ? null : `${target.name} is running ${target.program}: nothing will be typed`);
  return v_flex().id("files-move-row").flex_none().min_h(38).px(10).py(6).gap(4).border_b(1).border_color(t.border)
    .on_key_down((e, cx) => {
      if (e.key === "escape") handlers.onClose(cx);
      else if (!handlers.onKey(e, cx)) return;
      cx.stop_propagation();
    })
    .child(h_flex().w_full().gap(6).items_center()
      .child(h_flex().id("files-move-chip").flex_none().max_w(160).h(26).px(8).gap(5).items_center().rounded(6).border_1().border_color(t.border).bg(t.raised).text_size(12)
        .child(svg(`${BASE}/square-terminal.svg`).size(13).flex_none().text_color(t.foreground))
        .child(div().min_w(0).truncate().child(`cd · ${target.name}`)))
      .child(field(t, state.input))
      .child(boxy(t, "files-move-go", "Move terminal", { kind: "primary", h: 20, px: 8, size: 11.5, disabled: !target.shell, onClick: target.shell ? (_e, cx) => handlers.onGo(cx) : undefined }))
      .child(iconButton(t, "files-move-close", "x", "Close", (cx) => handlers.onClose(cx))))
    .when(Boolean(note), (el) => el.child(div().w_full().text_size(11.5).text_color(t.ansi1).child(note)))
    .when(Boolean(state.suggest?.items.length), (el) => el.child(suggestions(t, state.suggest, state.prefix, handlers.onPick)));
}
