// my-nvim for the Herdr app: the tab's nvim (a real nvim terminal, a
// full-height pane of the tab backed by that tab's persistent daemon). Files
// stay in my-filer-pro, which opens text files here.
//
// One mod, four roles, chosen by where it is shown:
// - an empty floating block, props {role: "sync"}: the controller that takes
//   my-nvim's commands (pick, swap, welcome; sync.js);
// - a pane with props {preview, tab}: the file rendered in the tab's nvim's
//   place (preview.js; the controller's swap puts it there, sync.js);
// - a dialog with props {bar}: the title of cmd-o's picker (pick.js); with
//   props {card}: the welcome and "Neovim is needed" (card.js);
// - an overlay, `mod.open:my-nvim` (cmd-e): opens or closes the tab's nvim,
//   then closes.

import { View, div } from "gpui-kit";
import { closeOverlay, props } from "herdr";
import { nvim, place } from "./lib.js";
import { Card } from "./card.js";
import { PickBar } from "./pick.js";
import { Preview } from "./preview.js";
import { Sync } from "./sync.js";

export default class MyNvim extends View {
  init(_props, cx) {
    const { overlay, role, bar, preview, card } = props() ?? {};
    if (preview) this.part = new Preview(props(), cx);
    else if (bar) this.part = new PickBar();
    else if (card) this.part = new Card(cx);
    else if (overlay) {
      cx.spawn(async () => {
        await nvim("toggle", [], place());
        closeOverlay(overlay);
      });
    } else if (role === "sync") this.sync = new Sync(cx);
  }

  // The view is gone: its part's loops end (the preview's).
  async close() {
    this.part?.close?.();
  }

  render(cx) {
    if (this.part) return this.part.render(cx);
    this.sync?.look(cx);
    return div();
  }
}
