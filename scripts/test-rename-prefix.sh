#!/usr/bin/env bash
# Runs rename-prefix.sh my- -> zz- on a temp copy of the package and checks the result.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
pkg=$tmp/pkg
mkdir "$pkg"
(cd "$root" && tar --exclude .git -cf - .) | (cd "$pkg" && tar -xf -)

# Reference forms the package may not use yet, decoys that must not change, and a clone of a my- mod.
python3 -I - "$pkg" <<'PY'
import json, sys
pkg = sys.argv[1]
p = f"{pkg}/keys.json"
k = json.load(open(p))
k["global"].update({"f13": "mod.open:my-pane", "f14": "dummy-menu", "f15": "my-menu-extra"})
k["mod:my-menu"] = {"enter": "my-menu.open"}
json.dump(k, open(p, "w"), indent=2)
p = f"{pkg}/mods/my-new-menu/mod.json"
m = json.load(open(p))
m["cloned_from"] = {"name": "my-menu", "version": "1.0.0"}
json.dump(m, open(p, "w"), indent=2)
PY

ls "$pkg/mods" | grep '^my-' > "$tmp/before"
for f in "$pkg"/mods/*/mod.json; do
  python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1])).get("cloned_from"))' "$f"
done > "$tmp/cloned-before"

# A clash must stop the script before it changes anything.
mkdir "$pkg/mods/qq-pane"
if bash "$root/scripts/rename-prefix.sh" my- qq- "$pkg" 2>/dev/null; then
  echo "FAIL: rename into an existing folder did not refuse"; exit 1
fi
[ -d "$pkg/mods/my-pane" ] || { echo "FAIL: refused run changed folders"; exit 1; }
rmdir "$pkg/mods/qq-pane"

bash "$root/scripts/rename-prefix.sh" my- zz- "$pkg"

for f in "$pkg"/mods/*/mod.json; do
  python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1])).get("cloned_from"))' "$f"
done > "$tmp/cloned-after"

python3 -I - "$pkg" "$tmp" <<'PY'
import json, pathlib, re, subprocess, sys
pkg, tmp = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
fails = []
def check(ok, msg):
    if not ok: fails.append(msg)

before = (tmp / "before").read_text().split()
mods = sorted(p.name for p in (pkg / "mods").iterdir())
check(not [m for m in mods if m.startswith("my-")], "my- folders remain")
check(all("zz-" + n[3:] in mods for n in before), "zz- folders missing")
check("agent-switcher" in mods, "shipped mod without prefix was renamed")

old = re.compile(r"(?<![A-Za-z0-9_-])(" + "|".join(map(re.escape, sorted(before, key=len, reverse=True))) + r")(?![A-Za-z0-9_-])")
clone = re.compile(r'"cloned_from"\s*:\s*\{[^}]*\}')
for f in pkg.rglob("*"):
    if not f.is_file() or f.relative_to(pkg).parts[0] == "scripts": continue
    try: s = f.read_text()
    except UnicodeDecodeError: continue
    for m in old.finditer(clone.sub("", s)):
        fails.append(f"{f.relative_to(pkg)}: still has {m.group(1)}")

lay = json.load(open(pkg / "layouts/maroon.json"))
check(lay.get("terminal_menu") == "zz-menu", "layout terminal_menu")
check(lay.get("toast") == "zz-toast", "layout toast")
check('"mod": "zz-filer-pro"' in (pkg / "layouts/maroon.json").read_text(), "layout mod")

k = json.load(open(pkg / "keys.json"))
g = k["global"]
check(g["f13"] == "mod.open:zz-pane", "keys mod.open")
check(k.get("mod:zz-menu") == {"enter": "zz-menu.open"}, "keys section and command")
check(g["f14"] == "dummy-menu" and g["f15"] == "my-menu-extra", "decoys changed")
check(g["ctrl-tab"] == "mod.open:agent-switcher", "unprefixed binding changed")

check((tmp / "cloned-before").read_text() == (tmp / "cloned-after").read_text(), "cloned_from changed")
check(json.load(open(pkg / "mods/zz-new-menu/mod.json"))["cloned_from"]["name"] == "my-menu", "cloned_from my- name changed")

for f in pkg.rglob("*.json"):
    r = subprocess.run([sys.executable, "-m", "json.tool", str(f)], capture_output=True)
    check(r.returncode == 0, f"invalid JSON: {f.relative_to(pkg)}")

if fails:
    print("FAIL"); [print("  " + x) for x in fails]; sys.exit(1)
print(f"PASS: {len(before)} mods renamed, references, keys, layout, cloned_from and JSON checked")
PY
