import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, spaces, panes, knownAgents, run, openOverlay, closeOverlay, props, window, keys, shared, setShared, exec } from "herdr";

// The last agents each machine reported, shown at once while knownAgents() checks again.
const KNOWN = "new-menu.agents";

// Past sessions started in a folder ($1, else home), newest first, up to 40, as
// lines of id, when (seconds) and title.
const SESSIONS = {
  // Claude Code keeps them in ~/.claude/projects/<folder, each character that
  // isn't a letter or digit a dash>; the title is the one given with /rename,
  // else the one it made up, else its summary, else the first message. Ones
  // with none of those have nothing to resume.
  claude: String.raw`[ -n "$1" ] || set -- "$HOME"
named() { q='"'; grep -o "$q$2$q:$q[^$q]*$q" "$1" 2>/dev/null | tail -n 1 | cut -d "$q" -f 4; }
ls -t "$HOME/.claude/projects/$(printf %s "$1" | sed 's/[^a-zA-Z0-9]/-/g')"/*.jsonl 2>/dev/null | head -n 40 | while read -r f; do
  t=$(named "$f" customTitle)
  [ -n "$t" ] || t=$(named "$f" aiTitle)
  [ -n "$t" ] || t=$(grep -m 1 '"type":"summary"' "$f" | jq -r '.summary // empty' 2>/dev/null)
  [ -n "$t" ] || t=$(grep -m 30 '"type":"user"' "$f" | jq -r 'select(.isMeta != true) | .message.content | if type == "string" then . else (map(select(.type == "text") | .text) | join(" ")) end' 2>/dev/null | grep -v '^\s*<' | grep -v '^\s*$' | head -n 1 | cut -c1-90)
  [ -n "$t" ] || continue
  printf '%s\t%s\t%s\n' "$(basename "$f" .jsonl)" "$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f")" "$t"
done`,
  // Codex keeps its threads in a database; only ones a person started (not its
  // reviewers or sub-agents), not archived. While Codex runs, a -wal file beside
  // it holds the newest writes; without one the file holds everything and is read
  // as immutable, which takes no lock and leaves no files beside it.
  codex: String.raw`db="$HOME/.codex/state_5.sqlite"; [ -f "$db" ] || exit 0
[ -n "$1" ] || set -- "$HOME"
q="select id, updated_at, replace(replace(substr(coalesce(nullif(name, ''), nullif(title, ''), first_user_message), 1, 90), char(10), ' '), char(9), ' ') from threads
  where archived = 0 and coalesce(thread_source, '') in ('', 'user') and source not like '{%' and cwd = '$(printf %s "$1" | sed "s/'/''/g")'
  order by updated_at desc limit 40"
if [ -f "$db-wal" ]; then set -- -readonly "$db"; else set -- "file:$db?immutable=1"; fi
sqlite3 -separator "$(printf '\t')" "$@" "$q"`,
};
const RESUME = { claude: (id) => ["claude", "--resume", id], codex: (id) => ["codex", "resume", id] };

// How long ago a session was last used: "3m", "2h", "1d".
const ago = (secs) => {
  const m = Math.max(0, Math.round((Date.now() / 1000 - secs) / 60));
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};

function shortcut(name) {
  const k = keys().find(b => b.section === "global" && b.action === name);
  if (!k?.keys.trim()) return "";
  const mac = window()?.platform === "macos";
  const names = mac ? { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘", fn: "fn" } : { ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: "Super", fn: "Fn" };
  const alias = { secondary: mac ? "cmd" : "ctrl", super: "cmd", win: "cmd" };
  return k.keys.trim().split(/\s+/).map(stroke => {
    const parts = stroke.split("-");
    let key = parts.pop();
    if (key === "") { key = "-"; parts.pop(); }
    const held = new Set(parts.map(m => alias[m.toLowerCase()] ?? m.toLowerCase()));
    if (/^[A-Z]$/.test(key)) held.add("shift");
    const label = key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1).toLowerCase();
    return [...Object.keys(names).filter(m => held.has(m)).map(m => names[m]), label].join(mac ? "" : "+");
  }).join(" ");
}

export default class NewMenu extends View {
  init(_props, cx) {
    const space = spaces().find(s => s.active);
    const machine = space?.machine;
    const where = machine ?? "";
    // The shown space's past sessions, every agent's together, newest first.
    this.sessions = [];
    for (const [key, script] of Object.entries(SESSIONS)) cx.spawn(async cx => {
      const r = await exec("sh", ["-c", script, "sh", (space?.folder ?? "").replace(/\/+$/, "")], { on: machine }).catch(() => null);
      const found = (r?.stdout ?? "").split("\n").filter(Boolean).map(l => {
        const [id, when, ...title] = l.split("\t");
        return { key, id, when: Number(when), title: title.join(" ") || "Untitled session" };
      });
      this.sessions = [...this.sessions, ...found].sort((a, b) => b.when - a.when);
      cx.notify();
    });
    this.agents = shared(KNOWN)?.[where] ?? [];
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.spawn(async cx => {
      try {
        this.agents = await knownAgents({ on: machine });
        setShared(KNOWN, { ...shared(KNOWN), [where]: this.agents });
      }
      catch { this.failed = true; }
      cx.notify();
    });
  }
  row(id, icon, name, action, hint = "", enabled = true) {
    const t = theme();
    return h_flex().id(id).h(31).px(9).gap(10).rounded(7).items_center().flex_none()
      .text_color(enabled ? t.foreground : t.dim).when(enabled, el => el.hover(s => s.bg(t.selected)))
      .on_click(() => { if (enabled) { closeOverlay(props().overlay); action(); } })
      .child(icon).child(div().flex_1().min_w(0).truncate().child(name)).child(div().flex_none().text_size(11).text_color(t.dim).child(hint));
  }
  render() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const installed = this.agents.filter(a => a.installed);
    const choices = this.failed ? installed : [...installed, ...this.agents.filter(a => !a.installed).slice(0, 2)];
    // The popup is 512 px tall: up to 6 agent rows show, and the sessions take the rest, scrolling.
    const agentRows = Math.min(6, Math.max(1, choices.length + (this.failed ? 1 : 0)));
    const sessionsHeight = this.sessions.length ? 22 + this.sessions.length * 31 : 0;
    return v_flex().min_h(0).w_full().h(Math.min(491, 167 + agentRows * 31 + sessionsHeight)).bg(t.popover).p(5).text_size(12.8)
      .id("new-menu").track_focus(this.handle)
      .on_key_down((e) => {
        if (e.modifiers.control || e.modifiers.platform || e.modifiers.alt) return;
        const agent = /^[1-9]$/.test(e.key) ? installed[Number(e.key) - 1] : null;
        if (!agent) return;
        closeOverlay(props().overlay);
        run("tab.new", { name: agent.name, space: space?.id, argv: agent.run });
      })
      .child(this.row("terminal", svg("icons/shell.svg").size(14), "Terminal", () => run("tab.new", { space: space?.id }), shortcut("tab.new")))
      .child(div().px(9).pt(8).pb(4).text_size(11).text_color(t.dim).child("Start an agent"))
      .child(v_flex().id("agents").flex_none().max_h(6 * 31).overflow_y_scrollbar()
        .children(choices.map((a, i) => this.row(a.key, a.tint ? svg(a.icon).size(14).text_color(t.foreground) : image(a.icon).size(14), a.name,
          () => run("tab.new", { name: a.name, space: space?.id, argv: a.run }), a.installed ? (i < 9 ? String(i + 1) : "") : "not installed", a.installed)))
        .when(this.failed || this.agents.length === 0, el => el.child(div().px(9).py(6).text_color(t.dim).child(this.failed ? "Could not check installed agents" : "Checking installed agents…"))))
      // No tab name: the agent titles its terminal with the session's name.
      .when(this.sessions.length > 0, el => el
        .child(div().px(9).pt(8).pb(4).text_size(11).text_color(t.dim).child("Resume a session"))
        .child(v_flex().id("sessions").flex_1().min_h(0).overflow_y_scrollbar()
          .children(this.sessions.map(x => this.row(`resume-${x.key}-${x.id}`, image(`icons/${x.key}.svg`).size(14), x.title,
            () => run("tab.new", { space: space?.id, argv: RESUME[x.key](x.id) }), ago(x.when))))))
      .when(this.sessions.length === 0, el => el.child(div().flex_1()))
      .child(div().h(1).mx(4).my(5).bg(t.border))
      .child(this.row("space", div().w(14).child("+"), "New space", () => run("space.new"), shortcut("space.new")))
      .child(this.row("worktree", svg("mods/my-workspace-chrome/branch.svg").size(14), "New worktree…", () => openOverlay({ mod: "my-worktree", kind: "dialog", width: 460, height: 280, props: { space: space?.id, folder: panes().find(p => p.focused)?.cwd, action: "new" } }), "", Boolean(space)))
      .child(this.row("worktree-open", svg("mods/my-workspace-chrome/branch.svg").size(14), "Open worktree\u2026", () => openOverlay({ mod: "my-worktree", kind: "dialog", width: 560, height: 480, props: { space: space?.id, folder: panes().find(p => p.focused)?.cwd, action: "open" } }), "", Boolean(space)));
  }
}
