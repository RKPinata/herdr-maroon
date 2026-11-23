// node --test tests/captain/find-captain.test.mjs
// A fake `hc` on PATH and a temp HOME stand in for Herdr and ~/.claude: the real `hc` drives the live window.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = new URL("../../captain/skills/im-a-crew/find-captain.sh", import.meta.url).pathname;

const fakeHc = `#!/bin/bash
case "$1" in
  ls) cat "$FAKE_HC/ls.json" ;;
  get) cat "$FAKE_HC/$2.json" ;;
esac
`;

// terminals: { address: { space, captain?, pid? } }; sessions: { pid: name }
function run(terminals, sessions = {}) {
  const dir = mkdtempSync(join(tmpdir(), "find-captain-"));
  const bin = join(dir, "bin"), hc = join(dir, "hc"), home = join(dir, "home");
  mkdirSync(bin); mkdirSync(hc); mkdirSync(join(home, ".claude", "sessions"), { recursive: true });
  writeFileSync(join(bin, "hc"), fakeHc); chmodSync(join(bin, "hc"), 0o755);
  writeFileSync(join(hc, "ls.json"), JSON.stringify({ terminals: Object.keys(terminals).map((address) => ({ address })) }));
  for (const [address, t] of Object.entries(terminals)) {
    const labels = { "herdr.space": t.space, ...(t.captain && { captain: "1" }) };
    writeFileSync(join(hc, `${address}.json`), JSON.stringify({ address, labels, foreground: t.pid && { pid: t.pid } }));
  }
  for (const [pid, name] of Object.entries(sessions)) {
    writeFileSync(join(home, ".claude", "sessions", `${pid}.json`), JSON.stringify({ pid: Number(pid), name }));
  }
  return spawnSync("bash", [script], {
    encoding: "utf8",
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: home, FAKE_HC: hc, HC_TERMINAL_ID: "w1:t1" },
  });
}

test("prints the session name of the captain in the same space", () => {
  const r = run(
    { "w1:t1": { space: "s1", pid: 111 }, "w1:t2": { space: "s1", captain: true, pid: 999999901 } },
    { 999999901: "captain-web" },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "captain-web\n");
});

test("fails when the only captain is in another space", () => {
  const r = run(
    { "w1:t1": { space: "s1", pid: 111 }, "w1:t2": { space: "s2", captain: true, pid: 999999901 } },
    { 999999901: "captain-other" },
  );
  assert.equal(r.status, 1);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /no captain in this space/);
});

test("fails when no terminal is a captain", () => {
  const r = run({ "w1:t1": { space: "s1", pid: 111 }, "w1:t2": { space: "s1", pid: 222 } });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /no captain in this space/);
});
