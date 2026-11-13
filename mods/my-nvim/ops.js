// my-nvim's settings, as the binary reads them (`my-nvim app-config`).

import { exec, readTextFile, setShared, shared } from "herdr";
import { bin } from "./lib.js";

// my-nvim's `tree` setting ("native" or "nvim"), read at the moment it
// matters and shared with every copy of the mod ("my-nvim.tree"), so a
// change applies without reinstalling. `app-config` runs again only when the
// config file's text changed (read, not run), not on every action.
let config = null; // {path, text, tree, across}

// The settings the mod uses: {tree, across, beside} (across: the direction
// a Preview / Source swap splits in, `sidebar::swap_direction`; beside: the
// one nvim opens beside the tab in, `sidebar::direction`).
export async function appConfig() {
  const text = config?.path ? await readTextFile(config.path).catch(() => null) : undefined;
  if (config && text === config.text) return config;
  const r = await exec(bin(), ["app-config"]).catch(() => null);
  let out = {};
  try { out = r?.code === 0 ? JSON.parse(r.stdout) : {}; } catch {}
  const tree = out.tree ?? "native";
  const path = out.config ?? null;
  const read = { path, tree, tree_key: out.tree_key ?? "<leader>e", across: out.across ?? "down", beside: out.beside ?? "right", text: path ? await readTextFile(path).catch(() => null) : undefined };
  config = r?.code === 0 ? read : null;
  if (shared("my-nvim.tree") !== tree) setShared("my-nvim.tree", tree);
  return read;
}

export async function treeMode() {
  return (await appConfig()).tree;
}
