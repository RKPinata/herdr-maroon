// An agent's name from its terminal title. Claude Code titles its terminal with
// the task; Codex with "<thread title> | <model> <effort> | Context N% used"
// (tui.terminal_title in ~/.codex/config.toml; a new thread's title is its id
// until its first answer). A title that's only a folder, a path, the program or
// the terminal's address names nothing.

export const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}[(]+/u, "").trim();
export const isCodex = (a) => a.app === "codex" || a.program?.key === "codex";
const base = (path) => path.replace(/\/+$/, "").split("/").pop();

export function codexTitle(title) {
  const out = {}, rest = [];
  for (const part of (title ?? "").split(" | ")) {
    const ctx = /^Context (\d+)% used$/.exec(part), model = /^(\S+) (none|minimal|low|medium|high|xhigh|max)$/.exec(part);
    if (ctx) out.context = Number(ctx[1]);
    else if (model) { out.model = model[1]; out.effort = model[2]; }
    else if (!/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(part)) rest.push(part);
  }
  if (out.model || out.context != null) out.task = clean(rest.join(" | "));
  return out;
}

export function agentTask(a, cwd) {
  if (isCodex(a)) return codexTitle(a.title).task ?? "";
  const live = clean(a.title);
  if (cwd && live === base(cwd)) return "";
  // Herdr titles an untitled terminal by its address ("t14f"): no name either.
  if (live === a.address || live === a.address?.split("/").pop()) return "";
  const telling = live && live !== a.program?.name && !/^[~/]/.test(live) && !live.includes("@") && live.toLowerCase() !== a.program?.key;
  return telling ? live : "";
}
