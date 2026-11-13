#!/usr/bin/env bash
# Builds my-nvim from nvim/ and installs it into a Herdr app home:
#
#   scripts/install-nvim.sh [--home DIR]
#
# The runtime (binary, lua, plugin) goes to ~/.local/share/my-nvim/app/<stamp>.
# A tab's nvim keeps the runtime it started with, so an upgrade never loads
# new Lua beside old. The mod goes to <home>/mods/my-nvim with a wrapper at
# bin/my-nvim that points at the runtime. Runtimes no running nvim uses are
# removed. Needs cargo (rustup) and Neovim 0.10+.
set -euo pipefail

here=$(cd "$(dirname "$0")/.." && pwd)
home=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
[ "${1:-}" = --home ] && home=$2

die() { echo "my-nvim: $*" >&2; exit 1; }

app_bin=$(command -v herdr-app) || die "herdr-app is not on PATH"
home=$(cd "$home" 2>/dev/null && pwd) || die "no Herdr app home at $home"
export PATH=/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:$PATH
command -v cargo >/dev/null || die "cargo not found: install Rust with rustup"

(cd "$here/nvim" && cargo build --release --quiet) || die "cargo build failed"
built=$here/nvim/target/release/my-nvim
"$built" app-nvim-check >/dev/null || die "Neovim 0.10+ is needed (brew install neovim)"

runtime=${XDG_DATA_HOME:-$HOME/.local/share}/my-nvim/app
mkdir -p "$runtime"
staged=$(mktemp -d "$runtime/.new.XXXXXX")
mkdir -p "$staged/bin"
cp "$built" "$staged/bin/my-nvim"
cp "$here/nvim/install-nvim.sh" "$staged/bin/install-nvim.sh"
cp -R "$here/nvim/lua" "$here/nvim/plugin" "$staged/"
stamp=$(cd "$staged" && find bin lua plugin -type f | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256 | cut -c1-16)
echo "$stamp" > "$staged/runtime-stamp"
root=$runtime/$stamp
if [ -d "$root" ]; then rm -rf "$staged"; else mv "$staged" "$root"; fi

# The mod, made whole beside the live one and checked, then swapped in.
stage=$home/mods/.my-nvim.new
rm -rf "$stage" && mkdir -p "$stage"
cp -R "$here/mods/my-nvim" "$stage/my-nvim"
mkdir -p "$stage/my-nvim/bin"
cat > "$stage/my-nvim/bin/my-nvim" <<WRAPPER
#!/bin/sh
# Written by herdr-maroon scripts/install-nvim.sh; run it again to change this.
export MY_NVIM_HOST=app
export MY_NVIM_SELF='$home/mods/my-nvim/bin/my-nvim'
export MY_NVIM_PLUGIN_ROOT='$root'
export HERDR_APP_BIN='$app_bin'
export HERDR_APP_HOME='$home'
exec '$root/bin/my-nvim' "\$@"
WRAPPER
chmod +x "$stage/my-nvim/bin/my-nvim"
"$app_bin" check "$stage/my-nvim" || { rm -rf "$stage"; die "herdr-app check failed; nothing replaced"; }
rm -rf "$home/mods/.my-nvim.old"
[ -d "$home/mods/my-nvim" ] && mv "$home/mods/my-nvim" "$home/mods/.my-nvim.old"
mv "$stage/my-nvim" "$home/mods/my-nvim"
rm -rf "$stage" "$home/mods/.my-nvim.old"

# A running tab nvim starts with `--cmd set rtp+=<root>`: its runtime stays.
for old in "$runtime"/*/; do
  old=${old%/}
  [ "$old" = "$root" ] && continue
  pgrep -f -- "set rtp\+=$old( |\$)" >/dev/null 2>&1 || rm -rf "$old"
done

echo "my-nvim: installed $stamp into $home/mods/my-nvim"
