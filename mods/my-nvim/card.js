// my-nvim's two cards, a dialog of this mod with props {card}:
// - "nvim": Neovim isn't there (or too old) when a tab's nvim has to start.
//   my-nvim says so (exit 3, `nvim_missing`, lib.js). Install opens a
//   terminal tab running `my-nvim app-install-nvim`, so the person sees
//   what runs; nothing installs without that press.
// - "welcome": once, the first time the tab's nvim opens (`welcome`): just
//   the keys, as the person's keys.json binds them, and where they live.
//   `my-nvim.welcome` shows it again (`welcome({ again: true })`).
// Enter does the main button, Esc closes.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { boxy } from "./boxy.js";
import { appHome, closeOverlay, openOverlay, props, readTextFile, run, setShared, shared, theme } from "herdr";
import { appConfig } from "./ops.js";

// The last time the "Neovim is needed" card opened: several requests failing
// at once (the tree and the controller) open one.
const OPENED = "my-nvim.card-at";
const SEEN = "my-nvim.welcomed";

export function openCard(card) {
  if (card.kind === "nvim") {
    if (Date.now() - (shared(OPENED) || 0) < 3000) return;
    setShared(OPENED, Date.now());
  }
  openOverlay({ mod: "my-nvim", kind: "dialog", width: 520, props: { card } });
}

// The key bound to `command` in the person's keys.json (any section), or null.
function keyFor(keys, command) {
  for (const section of Object.values(keys ?? {})) {
    if (!section || typeof section !== "object") continue;
    const hit = Object.entries(section).find(([, bound]) => bound === command);
    if (hit) return hit[0];
  }
  return null;
}

// Pure: the welcome's rows, [key, what], from keys.json. The comment keys
// are lua/my-nvim/init.lua's defaults; they work while typing.
export function welcomeRows(keys) {
  return [
    [keyFor(keys, "mod.open:my-nvim"), "open or close nvim"],
    [keyFor(keys, "my-nvim.pick"), "open a file the agent touched"],
    ["ctrl-k c", "comment the line or selection"],
    ["ctrl-k l", "list comments"],
    ["ctrl-k s", "paste comments into the agent's input"],
    ["ctrl-k shift-s", "send comments to the agent"],
    ["ctrl-k i", "put path:line at the agent's cursor"],
  ].filter(([key]) => key);
}

// Once: the first time a tab's nvim opened; `again`: whenever asked.
export async function welcome({ again = false } = {}) {
  if (shared(SEEN) === true && !again) return;
  setShared(SEEN, true);
  const text = await readTextFile(`${appHome()}/keys.json`).catch(() => null);
  let keys = {};
  try { keys = JSON.parse(text ?? "{}"); } catch {}
  const config = await appConfig().catch(() => ({ tree: "native" }));
  openCard({ kind: "welcome", rows: welcomeRows(keys), config: config.path ?? "~/.config/my-nvim/config.toml" });
}

export class Card {
  constructor(cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  close() {
    closeOverlay(props().overlay);
  }

  // The main button: Install, or Got it.
  submit() {
    const card = props().card;
    this.close();
    if (card.kind === "nvim") {
      run("terminal.open", {
        argv: [`${appHome()}/mods/my-nvim/bin/my-nvim`, "app-install-nvim", "--pause"],
        place: "tab", name: "Install Neovim",
      });
    }
  }

  render() {
    const card = props().card, t = theme();
    const button = (id, label, primary, onClick) =>
      boxy(t, id, label, { kind: primary ? "primary" : "secondary", onClick, h: 28, px: 14, size: 12.5 });
    const mono = (text) => div().text_color(t.accent).font_medium().child(text);
    const shell = v_flex().id("my-nvim-card").track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape") this.close();
        else if (e.key === "enter") this.submit();
        else return;
        cx.stop_propagation();
      })
      .w_full().p(18).gap(10).bg(t.popover).text_color(t.foreground).text_size(13);
    const title = (text) => h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().child(text))
      .child(div().text_size(11).text_color(t.dim).child("Esc"));
    if (card.kind === "nvim") {
      const what = card.found ? `\`${card.bin}\` is Neovim ${card.found}` : `\`${card.bin}\` was not found`;
      return shell
        .child(title(`Neovim ${card.need ?? "0.10"} or newer is needed`))
        .child(div().text_color(t.foreground).child(`my-nvim runs each tab's nvim with it, and ${what}.`))
        .child(div().text_size(11.5).text_color(t.dim).child(
          "Install opens a terminal tab that installs it: with Homebrew (brew install neovim), else Neovim's own release into ~/.local/share/my-nvim/nvim, no sudo. Then press cmd-e again."))
        .child(h_flex().pt(8).gap(8).justify_end()
          .child(button("card-cancel", "Not now", false, () => this.close()))
          .child(button("card-install", "Install Neovim", true, () => this.submit())));
    }
    return shell
      .child(title("nvim is ready"))
      .child(v_flex().gap(6).pt(4).children(card.rows.map(([key, what]) => h_flex().gap(12)
        .child(div().w(130).flex_none().child(mono(key)))
        .child(div().flex_1().min_w(0).child(what)))))
      .child(div().pt(4).text_size(11.5).text_color(t.dim).child(
        `Keys: ~/.config/herdr-app/keys.json · Settings: ${card.config.replace(/^\/Users\/[^/]+|^\/home\/[^/]+/, "~")}`))
      .child(h_flex().pt(8).justify_end().child(button("card-ok", "Got it", true, () => this.submit())));
  }
}
