// A pane's header, for layouts that frame their panes:
//   { "tab": "active", "pane": { "header": { "content": { "mod": "my-pane" } } } }
// Shows the program's icon (the app's program table), the agent's name or
// the terminal's title, the folder, and the agent's status; buttons split, zoom and close
// this pane. Props from the app: { pane, terminal }. Click: focus the pane.
// On my-nvim's nvim pane, while nvim's file is markdown, an image or an SVG, a
// Preview key renders it in nvim's place; on that preview, Source (nvim for an
// image) brings nvim back. my-nvim's controller does the swap (sync.js
// `startSwap`).

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { appHome, exec, panes, props, readTextFile, run, shared, spaces, terminals, theme, home, layout, watchFolder } from "herdr";
import { boxy } from "./boxy.js";

// Match the first visible tab frame, including the active child of a stack.
function paneFrame(node) {
  if (!node || node.hidden) return null;
  if (node.content?.tab && node.content.pane) return node.content.pane;
  let children = node.children ?? [];
  if (node.type === "stack") {
    const visible = children.filter(child => !child.hidden);
    children = [visible.find(child => child.id === node.active) ?? visible[0]];
  }
  for (const child of children) {
    const frame = paneFrame(child);
    if (frame) return frame;
  }
  return null;
}

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

const KINDS = {
  md: "markdown", markdown: "markdown", mdx: "markdown",
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", bmp: "image", ico: "image", svg: "image",
};
const kindOf = (path) => KINDS[/\.([^./]+)$/.exec(path ?? "")?.[1]?.toLowerCase()] ?? null;
const basename = (p) => p.replace(/^.*\//, "");
const dirname = (p) => p.replace(/\/[^/]*$/, "") || "/";

// How long a failed first look at nvim's file waits before asking again.
const RETRY_MS = 2000;

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

export default class Pane extends View {
  init() {
    this.hovered = false;
    this.file = null; // nvim's file, on my-nvim's nvim pane
    this.watching = null;
  }

  // The view is gone: the watch loop ends.
  async close() {
    this.closed = true;
  }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  // What this pane is to my-nvim: {role: "nvim", tab, terminal},
  // {role: "preview", tab, file}, or null.
  nvimRole() {
    const { pane, terminal } = props() ?? {};
    if (terminal) {
      const tab = terminals().find((t) => t.address === terminal)?.labels?.["my-nvim.sidebar"];
      return tab ? { role: "nvim", tab, terminal } : null;
    }
    const p = panes().find((x) => x.pane === pane);
    if (p?.terminal !== null || p?.mod !== "my-nvim") return null;
    return { role: "preview", tab: p.tab, file: (shared("my-nvim.previews") ?? {})[p.tab] ?? null };
  }

  // nvim's file, followed: `app-current` says where the tab's nvim writes it
  // (lua/my-nvim/app.lua `write_state`), then that file is watched.
  follow(r, cx) {
    if (this.watching) return;
    this.watching = "starting";
    cx.spawn(async (cx) => {
      const space = spaces().find((s) => s.tabs.some((t) => t.id === r.tab))?.id;
      const ctx = JSON.stringify({ space, tab: r.tab, terminal: r.terminal, cwd: null });
      const out = await exec(`${appHome()}/mods/my-nvim/bin/my-nvim`, ["app-current", "--ctx", ctx]).catch(() => null);
      let at = null;
      try { at = out?.code === 0 ? JSON.parse(out.stdout) : null; } catch {}
      this.file = at?.file ?? null;
      cx.notify();
      if (!at?.watch) {
        await cx.sleep(RETRY_MS);
        this.watching = null;
        return cx.notify();
      }
      this.watching = at.watch;
      while (!this.closed) {
        // The folder holds every tab's file: only this tab's matters.
        const changed = await watchFolder(dirname(at.watch));
        if (this.closed) return;
        if (changed.length && !changed.some((p) => p.startsWith(at.watch) || p === dirname(at.watch))) continue;
        const text = await readTextFile(at.watch).catch(() => null);
        let file = null;
        try { file = (text && JSON.parse(text).file) || null; } catch {}
        if (file !== this.file) { this.file = file; cx.notify(); }
      }
    });
  }

  // The Preview / Source key, or null on panes that aren't my-nvim's.
  swapKey(t, pane, cx) {
    const r = this.nvimRole();
    if (r?.role === "nvim") this.follow(r, cx);
    const label =
      r?.role === "nvim" ? (kindOf(this.file) ? "Preview" : null)
      : r?.role === "preview" ? (kindOf(r.file) === "image" ? "nvim" : "Source")
      : null;
    if (!label) return null;
    return boxy(t, `ph-swap-${pane}`, label, {
      h: 18,
      size: 11.5,
      onClick: (_e, cx) => {
        cx.stop_propagation();
        const file = r.role === "nvim" ? this.file : "";
        run(`my-nvim.swap:${r.tab}:${encodeURIComponent(file ?? "")}`);
      },
    });
  }

  button(t, id, icon, command, args) {
    return boxy(t, id, svg(`mods/my-pane/${icon}.svg`).size(14), {
      h: 18,
      px: 4,
      onClick: (_e, cx) => {
        cx.stop_propagation();
        run(command, args);
      },
    });
  }

  render(cx) {
    const t = theme();
    const p = this.me();
    if (!p) return div();
    const r0 = p.terminal === null && p.mod === "my-nvim" ? this.nvimRole() : null;
    const name = r0?.file ? `Preview · ${basename(r0.file)}`
      : ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell";
    const swap = this.swapKey(t, p.pane, cx);
    const pic = icon(p.program, 14, t.dim);
    const st = p.status;
    const pane = p.pane;
    const frame = paneFrame(layout());
    const bottom = frame?.header?.position === "bottom";
    // Header fill sits inside the frame border, so it follows the border's inner curve.
    const r = Math.max(0, (frame?.radius ?? 0) - (frame?.border?.width ?? 0));
    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .px(10)
      .gap(8)
      .items_center()
      .bg(t.background)
      .when(bottom, el => el.border_t(1).rounded_b(r))
      .when(!bottom, el => el.border_b(1).rounded_t(r))
      .border_color(t.border)
      .text_size(12)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_none().truncate().max_w(260).font_medium().text_color(t.foreground).child(name))
      .child(div().flex_1().truncate().text_color(t.dim).child(folder(p.cwd)))
      .when(st === "working", el => el.child(svg("mods/my-workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
      .when(st === "blocked", el => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).child("Needs you")))
      .when(st === "done", el => el.child(div().size(7).flex_none().rounded(4).bg(t.done)))
      .when(Boolean(swap), el => el.child(swap))
      .when(this.hovered, el => el
        .child(this.button(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
        .child(this.button(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
        .child(this.button(t, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
        .child(this.button(t, `ph-x-${pane}`, "close", "pane.close", { pane })));
  }
}
