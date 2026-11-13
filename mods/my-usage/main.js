// Usage limits, a row per service: its fullest limit's used % (green, yellow from 50%,
// red from 80%) and the time until that limit resets. Click a row to see every limit
// as a bar. The layout block holding this mod (it needs an id) resizes to fit the rows.
//   Claude  ~/.cache/herdr-mods/usage/claude.json, {at, five_hour, seven_day}, written by
//           claude-statusline.sh: Claude Code gives its limits only to a status line.
//           With the account rotator plugin holding 2+ accounts, a row per account instead, from
//           the rotator's last readings; the one whose readings match the status line's is in use,
//           shown first with the status line's (fresher) numbers.
//   Codex   the last rate_limits in its newest session file that has one.
// Each is as fresh as that program's last run; a limit past its reset time shows 0%.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, exec, home, run, layout, readTextFile } from "herdr";

const MOD = "my-usage";
const ROW = 28, LIMIT = 20;
// Codex's last token_count event with rate_limits, from the newest of its last 5 sessions that has one.
const CODEX = `for f in $(ls -t "$HOME"/.codex/sessions/*/*/*/*.jsonl 2>/dev/null | head -n 5); do
  grep '"rate_limits":{' "$f" | tail -n 1 | grep . && exit 0
done; exit 0`;
// The account rotator plugin's store: its accounts, their usage readings, and their sign-ins.
const ROTATOR = `ls -t "$HOME"/.claude/plugins/store/account-rotator_*.json 2>/dev/null | head -n 1`;

// The rotator's accounts with their last readings; only these fields leave the file, never its sign-ins.
async function rotatorAccounts() {
  try {
    const path = (await exec("sh", ["-c", ROTATOR])).stdout.trim();
    const store = path ? JSON.parse((await readTextFile(path)) ?? "null") : null;
    return (store?.accounts ?? []).map((a) => {
      const r = store[`reading:${a.id}`];
      // resetsAt has microseconds ("…:59.751992+00:00"); keep milliseconds so any Date.parse reads it.
      const time = (s) => { const ms = s ? Date.parse(String(s).replace(/(\.\d{3})\d+/, "$1")) : NaN; return Number.isFinite(ms) ? ms / 1000 : null; };
      const window = (w) => w && { pct: w.pct, resetsAt: time(w.resetsAt) };
      return { id: a.id, email: a.email ?? "", plan: a.plan ?? "", at: r?.at ? r.at / 1000 : null, fiveHour: window(r?.fiveHour), sevenDay: window(r?.sevenDay) };
    });
  } catch { return []; }
}

// The id of the layout block showing mod, or null.
function blockId(node, mod) {
  if (node?.content?.mod === mod) return node.id ?? null;
  for (const child of node?.children ?? []) {
    const id = blockId(child, mod);
    if (id) return id;
  }
  return null;
}
// Seconds as "3h 54m", "6d 23h", "12m".
function left(s) {
  s = Math.max(0, Math.round(s));
  return s < 3600 ? `${Math.max(1, Math.floor(s / 60))}m` : s < 86400 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}
// A window's length: 300 minutes is "5h", 10080 is "7d".
const windowName = (min) => (!min ? "Limit" : min % 1440 === 0 ? `${min / 1440}d` : min % 60 === 0 ? `${min / 60}h` : `${min}m`);

export default class Usage extends View {
  init(_props, cx) {
    this.rows = [];
    this.open = new Set();
    this.height = 0;
    this.refresh(cx);
    cx.timer.every(30000, (cx) => this.refresh(cx));
  }

  refresh(cx) {
    cx.spawn(async (cx) => {
      const now = Date.now() / 1000;
      // label, used % (0 once it has reset), seconds to its reset.
      const limit = (label, used, resetsAt) => (resetsAt && resetsAt <= now ? { label, used: 0, left: null }
        : { label, used: Math.max(0, Math.min(100, used ?? 0)), left: resetsAt ? resetsAt - now : null });
      const rows = [];
      let claude = null;
      try { claude = JSON.parse((await readTextFile(`${home()}/.cache/herdr-mods/usage/claude.json`)) ?? "null"); } catch {}
      const statusLimits = (claude?.five_hour || claude?.seven_day) ? [
        claude.five_hour && limit("5h", claude.five_hour.used_percentage, claude.five_hour.resets_at),
        claude.seven_day && limit("7d", claude.seven_day.used_percentage, claude.seven_day.resets_at),
      ].filter(Boolean) : null;
      const accounts = await rotatorAccounts();
      if (accounts.length >= 2) {
        // shortcut: the account in use is told by matching percentages; two accounts at the same numbers pick the first. Upgrade if the rotator records the account in use.
        const inUse = statusLimits ? accounts.find((a) => a.fiveHour?.pct === claude.five_hour?.used_percentage && a.sevenDay?.pct === claude.seven_day?.used_percentage) : null;
        const ordered = inUse ? [inUse, ...accounts.filter((a) => a !== inUse)] : accounts;
        for (const a of ordered) rows.push({
          key: `claude-${a.id}`, name: `Claude · ${a.email.split("@")[0] || a.id}`, inUse: a === inUse,
          tip: `${a.email}${a.plan ? ` (${a.plan})` : ""}${a === inUse ? " · in use" : a.at ? ` · read ${left(now - a.at)} ago` : ""}`,
          limits: a === inUse ? statusLimits : [
            a.fiveHour && limit("5h", a.fiveHour.pct, a.fiveHour.resetsAt),
            a.sevenDay && limit("7d", a.sevenDay.pct, a.sevenDay.resetsAt),
          ].filter(Boolean),
        });
      } else if (statusLimits) rows.push({ key: "claude", name: "Claude", limits: statusLimits });
      let codex = null;
      try { codex = JSON.parse((await exec("sh", ["-c", CODEX])).stdout || "null")?.payload?.rate_limits; } catch {}
      if (codex) rows.push({ key: "codex", name: "Codex", limits: [codex.primary, codex.secondary].filter(Boolean)
        .map((w) => limit(windowName(w.window_minutes), w.used_percent, w.resets_at)) });
      this.rows = rows;
      this.fit();
      cx.notify();
    });
  }

  // The block's height: every row, the open ones' limits, or one line saying there is none.
  fit() {
    const id = blockId(layout(), MOD);
    if (!id) return;
    const h = 6 + (this.rows.length ? this.rows.reduce((n, s) => n + ROW + (this.open.has(s.key) ? Math.max(1, s.limits.length) * LIMIT + 4 : 0), 0) : ROW);
    if (h !== this.height) { this.height = h; run("layout.resize", { id, px: h }); }
  }

  toggle(key, cx) {
    if (this.open.has(key)) this.open.delete(key); else this.open.add(key);
    this.fit();
    cx.notify();
  }

  color(t, used) {
    return used >= 80 ? t.ansi1 : used >= 50 ? t.ansi3 : t.ansi2;
  }

  render(cx) {
    const t = theme();
    const dim = (s) => div().text_size(11).text_color(t.dim).child(s);
    return v_flex().id("usage").w_full().pt(3).px(10).border_t(1).border_color(t.border).bg(t.chrome).text_size(12.5)
      .when(!this.rows.length, (el) => el.child(h_flex().h(ROW).px(4).items_center().child(dim("No usage yet: start Claude Code or Codex"))))
      .children(this.rows.map((s, i) => {
        const open = this.open.has(s.key);
        const top = s.limits.length ? s.limits.reduce((a, b) => (b.used > a.used ? b : a)) : null;
        return v_flex().w_full()
          .when(i > 0, (el) => el.border_t(1).border_color(t.border))
          .child(h_flex().id(`usage-${s.key}`).h(ROW).px(4).gap(6).items_center().rounded(6).cursor_pointer()
            .hover((x) => x.bg(t.hover))
            .on_click((_e, cx) => this.toggle(s.key, cx))
            .when(Boolean(s.tip), (el) => el.tooltip(s.tip))
            .child(div().min_w(0).flex_shrink(1).truncate().text_color(s.inUse ? t.foreground : t.muted).when(Boolean(s.inUse), (el) => el.font_semibold()).child(s.name))
            // The reset time gives way first when the column is narrow; the % and the arrow stay put.
            .child(h_flex().flex_1().min_w(0).justify_end().overflow_hidden()
              .when(Boolean(top) && !open && top.left != null, (el) => el.child(h_flex().id(`reset-${s.key}`).min_w(0).items_center()
                .tooltip(`${top.label} resets in ${left(top.left)}`).child(dim(left(top.left)).min_w(0).truncate()))))
            .when(Boolean(top) && !open, (el) => el
              .child(div().w(32).flex_none().flex().justify_end().text_color(this.color(t, top.used)).child(`${Math.round(top.used)}%`)))
            .child(svg(`mods/my-workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(8).flex_none().flex_shrink_0().text_color(t.dim)))
          .when(open, (el) => el.child(v_flex().px(4).pb(4).children(s.limits.map((l) =>
            h_flex().h(LIMIT).items_center().gap(7).text_size(11.5)
              .child(div().w(30).flex_none().text_color(t.muted).child(l.label))
              .child(div().flex_1().h(3).rounded(2).bg(t.raised)
                .child(div().h(3).rounded(2).bg(this.color(t, l.used)).w(`${Math.max(l.used > 0 ? 3 : 0, l.used)}%`)))
              .child(div().w(30).flex_none().flex().justify_end().text_color(this.color(t, l.used)).child(`${Math.round(l.used)}%`))
              .child(div().w(44).flex_none().flex().justify_end().text_size(10.5).text_color(t.dim).child(l.left != null ? left(l.left) : ""))))));
      }));
  }
}
