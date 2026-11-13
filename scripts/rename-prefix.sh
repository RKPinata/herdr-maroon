#!/usr/bin/env bash
# Renames every mod whose folder starts with <old-prefix> to <new-prefix>, and rewrites every
# reference to those mod names in the package: layout "mod", "terminal_menu" and "toast",
# key bindings and sections, and mod names and mods/<name>/ paths in any text file.
# A reference is the whole mod name, so "dummy-menu" or "my-menu-extra" stay as they are.
# The "cloned_from" object in mod.json keeps the name of the original mod. scripts/ is left as it is.
set -euo pipefail

usage() { echo "usage: $0 <old-prefix> <new-prefix> [dir]" >&2; exit 2; }
die() { echo "error: $*" >&2; exit 1; }

[ $# -ge 2 ] && [ $# -le 3 ] || usage
old=$1 new=$2
dir=${3:-$(cd "$(dirname "$0")/.." && pwd)}
dir=${dir%/}
for p in "$old" "$new"; do
  case $p in ''|*[!A-Za-z0-9_-]*) die "prefix '$p' must use only letters, digits, '_' and '-'";; esac
done
[ "$old" != "$new" ] || die "old and new prefix are the same"
[ -d "$dir/mods" ] || die "no mods/ folder in $dir"

names=""
for d in "$dir/mods/$old"*; do
  [ -d "$d" ] || continue
  n=$(basename "$d")
  [ ! -e "$dir/mods/$new${n#"$old"}" ] || die "mods/$new${n#"$old"} already exists; nothing changed"
  names="$names$n
"
done
[ -n "$names" ] || die "no mod folder in $dir/mods starts with '$old'"

export NAMES=$names OLD=$old NEW=$new DIR=$dir

find "$dir" \( -name .git -o -path "$dir/scripts" \) -prune -o -type f -print0 | perl -0 -ne '
  BEGIN {
    my $alt = join "|", map quotemeta, sort { length $b <=> length $a } grep length, split /\n/, $ENV{NAMES};
    $ref = qr/(?<![A-Za-z0-9_-])($alt)(?![A-Za-z0-9_-])/;
    $keep = qr/"cloned_from"\s*:\s*\{[^}]*\}/;
  }
  chomp(my $f = $_);
  next if -l $f || -B $f;
  open my $in, "<", $f or die "$f: $!";
  my $s = do { local $/; <$in> };
  close $in;
  (my $t = $s) =~ s{($keep)|$ref}{defined $1 ? $1 : $ENV{NEW} . substr($2, length $ENV{OLD})}ge;
  next if $t eq $s;
  open my $out, ">", $f or die "$f: $!";
  print $out $t;
  close $out or die "$f: $!";
  print "updated ", substr($f, length($ENV{DIR}) + 1), "\n";
'

printf '%s' "$names" | while IFS= read -r n; do
  mv "$dir/mods/$n" "$dir/mods/$new${n#"$old"}"
  echo "renamed mods/$n -> mods/$new${n#"$old"}"
done

echo "Remaining '$old' at a word start (check each one by hand):"
find "$dir" \( -name .git -o -path "$dir/scripts" \) -prune -o -type f -print0 | perl -0 -ne '
  chomp(my $f = $_);
  next if -l $f || -B $f;
  open my $in, "<", $f or next;
  local $/ = "\n";
  while (<$in>) {
    print substr($f, length($ENV{DIR}) + 1), ":$.: $_" if /(?<![A-Za-z0-9_-])\Q$ENV{OLD}\E/;
  }
  close $in;
'
