// Text and colors for an agent row's details, kept apart from main.js so format-test.mjs can run them in node.

// "<1m", "4m", "1h 4m" ("2h" on the hour), "2d".
export function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d`;
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

// Context used: green, yellow from 50%, red from 80%.
export const contextColor = (t, pct) => (pct >= 80 ? t.ansi1 : pct >= 50 ? t.ansi3 : t.ansi2);
