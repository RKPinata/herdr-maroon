// Context menus (Herdr's items). Opened as a popup with
// props { tab: "pane" | "tab" | "space" | "global", target }.
// ↑/↓ move, Enter runs, Esc closes. An item is [label, command, args];
// a command "worktree" opens the worktree dialog instead.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, openOverlay, theme, keys, terminals, spaces, panes, exec, hc, notify, setShared } from "herdr";

// Where a space is now: its first terminal's live folder, else where it was made.
function place(s) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}

// A space's checkout: "main" (a repo's own), "linked" (a worktree), or null.
async function checkout(folder, on) {
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on });
  const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder, on });
  if (top.code !== 0 || common.code !== 0) return null;
  return common.stdout.trim() === `${top.stdout.trim()}/.git` ? "main" : "linked";
}

// An id Herdr doesn't know yet: a terminal labeled with it starts a new tab or space.
const freshId = (kind) => kind + Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");

// Labels on a machine use its ids without the app's `<machine>/` prefix.
const bare = (id) => id.split("/").pop();

// Herdr gives a terminal a pane in the tab its herdr.space/herdr.tab labels name
// only when the terminal has no pane, so the pane is parked first.
async function moveTerminal({ terminal, space, tab }, cx) {
  run("terminal.park", { terminal });
  // The park clears the labels once its machine applies it; labels set before then are lost.
  let parked = false;
  for (let i = 0; i < 100 && !parked; i++) {
    const r = await hc(["get", terminal, "--json"]);
    parked = r.code === 0 && !JSON.parse(r.stdout).labels?.["herdr.tab"];
    if (!parked) await cx.sleep(50);
  }
  const r = parked && (await hc(["label", terminal, `herdr.space=${bare(space)}`, `herdr.tab=${bare(tab)}`]));
  if (!r || r.code !== 0)
    notify({ title: `Could not move ${terminal}`, body: `It may have no pane now. Bring it back: herdr-app do terminal.keep --terminal ${terminal}`, level: "error" });
}

// A mod pane has no terminal to relabel. A mod that opens this menu for its own pane puts `mod` and `props` in the
// target, so the pane opens again from them in the other tab, then closes here.
function moveModPane({ pane, mod, props: modProps, space, tab }) {
  const there = panes().find((p) => p.tab === tab);
  if (there) run("pane.split", { direction: "right", pane: there.pane, mod, props: modProps });
  else run("tab.new", { space, mod, props: modProps });
  run("pane.close", { pane });
}

function items(p, git) {
  p = p ?? {};
  const tg = p.target ?? {};
  switch (p.tab) {
    case "pane": {
      // A kept sub-agent can go back under its parent, still running.
      const all = terminals();
      const term = all.find((t) => t.address === tg.terminal);
      const parent = term?.parent && all.find((t) => t.address === term.parent);
      // Once they go to the program, Shift+right-click still opens this menu.
      const toProgram = term?.labels?.["herdr.right-click"] === "program";
      // A terminal shown outside a tab (a layout terminal block, a window) has
      // no pane to split, zoom or close: its pane is the block's id.
      const inTab = panes().some((pane) => pane.pane === tg.pane);
      const cwd = panes().find((pane) => pane.pane === tg.pane)?.cwd;
      return [
        ...(inTab
          ? [
              ["Split right", "pane.split", { direction: "right", pane: tg.pane }],
              ["Split down", "pane.split", { direction: "down", pane: tg.pane }],
              ["Zoom", "pane.zoom", { pane: tg.pane }],
            ]
          : []),
        ...(term
          ? [
              toProgram
                ? ["Use Herdr right-click menu", "terminal.right_click", { terminal: term.address, to: "menu" }]
                : ["Send right-clicks to pane", "terminal.right_click", { terminal: term.address, to: "program" }],
            ]
          : []),
        ...(parent ? [[`Send back to ${parent.name || parent.address}`, "terminal.park", { terminal: term.address }]] : []),
        ...(term && cwd ? [["Go to Folder in Files…", "files-goto", { machine: term.address.includes("/") ? term.address.split("/")[0] : null, cwd }]] : []),
        ...(inTab && (term || tg.mod) ? [["Move to…", "move-menu", tg]] : []),
        ...(inTab ? [["Close pane", "pane.close", { pane: tg.pane }]] : []),
      ];
    }
    case "move": {
      // Without a space in the target: the spaces; with one: that space's tabs.
      const from = panes().find((x) => x.pane === tg.pane)?.tab;
      const all = spaces();
      const to = (space, tab) => ({ ...tg, space, tab });
      const space = tg.space && all.find((s) => s.id === tg.space);
      if (space)
        return [
          ...space.tabs.filter((c) => c.id !== from).map((c) => [c.name, "move", to(space.id, c.id)]),
          ["New tab", "move", to(space.id, freshId("tb"))],
        ];
      // A terminal stays on its machine, so only that machine's spaces can take it.
      const machine = all.find((s) => s.tabs.some((c) => c.id === from))?.machine ?? null;
      return [
        ...all.filter((s) => s.machine === machine).map((s) => [s.name, "move-menu", { ...tg, space: s.id }]),
        // space.new takes no mod, so a mod pane moves only into spaces that exist.
        ...(tg.mod ? [] : [["New space", "move", to(freshId("sp"), freshId("tb"))]]),
      ];
    }
    case "tab":
      return [
        ["Rename", "tab.rename", { id: tg.id }],
        ["New tab", "tab.new", { space: tg.space }],
        ["Close", "tab.close", { id: tg.id }],
      ];
    case "space":
      return [
        ["Rename", "space.rename", { id: tg.id }],
        ...(git ? [["New worktree", "worktree", { space: tg.id, action: "new" }], ["Open worktree", "worktree", { space: tg.id, action: "open" }]] : []),
        ...(git === "linked" ? [["Remove worktree", "worktree", { space: tg.id, action: "remove" }]] : []),
        ["Close", "space.close", { id: tg.id }],
      ];
    default:
      return [
        ["New space", "space.new", {}],
        ["Keybinds", "app.help", {}],
        ["Theme: graphite", "app.theme", { name: "graphite" }],
        ["Theme: ink", "app.theme", { name: "ink" }],
        ["Theme: moss", "app.theme", { name: "moss" }],
        ["Theme: atom one dark", "app.theme", { name: "atom-one-dark" }],
      ];
  }
}

function menuIcon(command) {
  const name = command === "move-menu" || command === "move" ? "layers" : command.endsWith(".close") ? "x" : command.endsWith(".rename") ? "square-pen" : command.endsWith(".new") ? "plus" : command === "worktree" ? "git-branch" : command === "app.help" ? "terminal" : command === "app.theme" ? "settings" : command === "pane.split" ? "panel-right" : command === "pane.zoom" ? "square" : "terminal";
  return `mods/my-workspace-chrome/${name}.svg`;
}

// The key bound to a command, for the hint on the right.
function shortcut(name, args) {
  // `pane.split:right` binds pane.split with { direction: "right" }.
  const value = args && Object.values(args)[0];
  const k = keys().find((b) => b.section === "global" && (b.action === name || b.action === `${name}:${value}`));
  return k ? k.keys : "";
}

export default class Menu extends View {
  init(_props, cx) {
    this.at = 0;
    this.git = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    const p = props();
    const space = p?.tab === "space" && spaces().find((s) => s.id === p.target?.id);
    const folder = space && place(space);
    if (folder)
      cx.spawn(async (cx) => {
        this.git = await checkout(folder, space.machine).catch(() => null);
        cx.notify();
      });
  }

  choose(i, cx) {
    const it = items(props(), this.git)[i];
    if (!it || this.moving) return;
    // Closing the popup cancels its tasks, so it stays open until the move is done.
    if (it[1] === "move" && it[2].mod) {
      moveModPane(it[2]);
      closeOverlay(props()?.overlay);
      return;
    }
    if (it[1] === "move") {
      this.moving = true;
      cx.spawn(async (cx) => {
        await moveTerminal(it[2], cx).catch((e) => notify({ title: "Could not move the terminal", body: String(e), level: "error" }));
        closeOverlay(props()?.overlay);
      });
      return;
    }
    closeOverlay(props()?.overlay);
    if (it[1] === "move-menu") {
      const n = items({ tab: "move", target: it[2] }).length;
      openOverlay({ mod: "my-menu", kind: "popup", width: 280, height: Math.min(31 * n + 12, 420), props: { tab: "move", target: it[2] } });
    } else if (it[1] === "worktree") openOverlay({ mod: "my-worktree", kind: "dialog", ...(it[2].action === "open" ? { width: 560, height: 480 } : { width: 440, height: 260 }), props: it[2] });
    // Files opens its go-to row with this folder (my-filer-pro pollGotoRow); mod commands carry no arguments, so the
    // folder goes through shared state and the command only puts the panel on screen.
    else if (it[1] === "files-goto") {
      setShared("filer-pro.goto-row", { id: Math.random().toString(36).slice(2, 10), machine: it[2].machine, cwd: it[2].cwd, at: Date.now() });
      run("my-filer-pro.show");
    }
    else run(it[1], it[2]);
  }

  render(cx) {
    const t = theme();
    const list = items(props(), this.git);
    return v_flex()
      .id("menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      // A scroll area has no height of its own, so only the long move list scrolls, at the height its opener asks for.
      .when(props()?.tab === "move", (el) => el.h(Math.min(31 * list.length + 12, 420)).overflow_y_scrollbar())
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") this.choose(this.at, cx);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .children(
        list.map((it, i) =>
          v_flex()
            .when(i > 0 && (it[1].endsWith(".close") || it[1] === "app.help" || (it[1] === "app.theme" && list[i - 1][1] !== "app.theme")), el => el.child(div().mx(7).my(4).h(1).bg(t.border)))
            .child(h_flex()
            .id(`mi-${i}`)
            .h(31)
            .px(8)
            .gap(9)
            .rounded(7)
            .items_center()
            .justify_between()
            .text_color(t.foreground)
            .when(i === this.at, (el) => el.bg(t.selected))
            // The pointer moves the selection, so only one row is ever shaded.
            .on_hover((on, cx) => { if (on && this.at !== i) { this.at = i; cx.notify(); } })
            .on_click((_e, cx) => this.choose(i, cx))
            .child(svg(menuIcon(it[1])).size(14).flex_none().text_color(t.muted))
            .child(div().flex_1().child(it[0]))
            .child(it[1] === "move-menu"
              ? svg("mods/my-workspace-chrome/chevron-right.svg").size(12).flex_none().text_color(t.foreground)
              : div().text_size(11).text_color(t.dim).child(shortcut(it[1], it[2])))),
        ),
      );
  }
}
