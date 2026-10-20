#!/usr/bin/env bash
# Builds xtrs's Model I core headless into tools/xtrs/build/fugloy-xtrs, the lockstep reference of
# emu phase 7's Model I differential harness (packages/emu/test/diff/xtrs-adapter.js). Idempotent.
#
# Clones https://github.com/TimothyPMann/xtrs (Tim Mann's xtrs, under its own licence: Clarendon
# Hill Software and Timothy P. Mann) into the gitignored tools/xtrs/src at the pinned commit,
# applies Fugløy's patch (packages/emu/scripts/xtrs/xtrs-fugloy.patch, which only exports what a
# stepping driver needs) with git apply, checks the patched tree's SHA-256, and builds xtrs's core
# out of tree with our driver (packages/emu/scripts/xtrs/fugloy-xtrs.c): no X11, no readline, no
# KBWAIT, no SIGALRM timer (docs/superpowers/notes/2026-10-19-model1-references-spike.md).
# Nothing it builds is committed. Needs git, a C compiler, and zmac (pnpm zmac:install; run for
# you if missing) for xtrs's built-in ROM stand-ins.
set -euo pipefail
REPO=https://github.com/TimothyPMann/xtrs.git
PIN=3a2180c063811a715faa28d39a94739c33e0abd0
# The SHA-256 of the patched tree (tree_sha below); xtrs-adapter.js pins the same.
WANT=8f94e3d99b7fe8d9b4b421a29e495d4e5b95fe615a823da7a2a6a8786dde1618
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SRC="$ROOT/tools/xtrs/src"
OUT="$ROOT/tools/xtrs/build"
HERE="$ROOT/packages/emu/scripts/xtrs"
PATCH="$HERE/xtrs-fugloy.patch"
DRIVER="$HERE/fugloy-xtrs.c"
BIN="$OUT/fugloy-xtrs"
ZMAC="$ROOT/tools/zmac/zmac"

sha() { shasum -a 256 "$1" | cut -d' ' -f1; }
# Every file of the tree but .git, by path in byte order, as `shasum -a 256` lists it; then the
# SHA-256 of that list. xtrs-adapter.js computes the same.
tree_sha() {
  (cd "$1" && find . -type f -not -path './.git/*' | sed 's|^\./||' | LC_ALL=C sort | while IFS= read -r f; do shasum -a 256 "$f"; done) | shasum -a 256 | cut -d' ' -f1
}

if [ ! -d "$SRC/.git" ]; then
  mkdir -p "$(dirname "$SRC")"
  git clone -q "$REPO" "$SRC"
  git -C "$SRC" checkout -q "$PIN"
fi
HEAD=$(git -C "$SRC" rev-parse HEAD)
if [ "$HEAD" != "$PIN" ]; then
  echo "install-xtrs: tools/xtrs/src is at $HEAD, not the pinned $PIN; delete tools/xtrs/src and run pnpm xtrs:install again" >&2
  exit 1
fi
if git -C "$SRC" apply --reverse --check "$PATCH" 2>/dev/null; then
  : # already applied
elif git -C "$SRC" apply --check "$PATCH" 2>/dev/null; then
  git -C "$SRC" apply "$PATCH"
else
  echo "install-xtrs: Fugløy's patch does not apply to tools/xtrs/src (it has other changes); delete tools/xtrs/src and run pnpm xtrs:install again" >&2
  exit 1
fi
GOT=$(tree_sha "$SRC")
if [ "$GOT" != "$WANT" ]; then
  echo "install-xtrs: tools/xtrs/src has SHA-256 $GOT after the patch, expected $WANT (the tree has other changes); delete tools/xtrs/src and run pnpm xtrs:install again" >&2
  exit 1
fi
# The stamp names what the binary was built from: the tree, the driver, and this script (its
# build flags); xtrs-adapter.js refuses a binary whose stamp is not this checkout's.
STAMP="tree $WANT
driver $(sha "$DRIVER")
script $(sha "$ROOT/scripts/install-xtrs.sh")"
if [ -x "$BIN" ] && [ "$(cat "$BIN.stamp" 2>/dev/null || true)" = "$STAMP" ]; then
  echo "xtrs $PIN with Fugløy's patch already built at $BIN"
  exit 0
fi
[ -x "$ZMAC" ] || bash "$ROOT/scripts/install-zmac.sh"

mkdir -p "$OUT"
rm -f "$BIN" "$BIN.stamp"
CF="-O2 -Wall -Wno-unused-parameter -Wno-deprecated-declarations -Wno-unused-variable -Wno-unused-but-set-variable -D_DARWIN_C_SOURCE -DDISKDIR=\".\" -I$SRC"
CC=${CC:-cc}
for f in fakerom esfrom xtrsrom4p; do (cd "$OUT" && "$ZMAC" -P -o $f.hex "$SRC/$f.z80" >/dev/null); done
$CC $CF -o "$OUT/compile_rom" "$SRC/compile_rom.c" "$SRC/error.c" "$SRC/load_cmd.c" "$SRC/load_hex.c"
"$OUT/compile_rom" 1 "$OUT/fakerom.hex" > "$OUT/trs_rom1.c"
"$OUT/compile_rom" 1x "$OUT/esfrom.hex" > "$OUT/trs_rom1x.c"
"$OUT/compile_rom" 3 "$OUT/fakerom.hex" > "$OUT/trs_rom3.c"
"$OUT/compile_rom" 4p "$OUT/xtrsrom4p.hex" > "$OUT/trs_rom4p.c"
OBJS=""
for m in load_cmd load_hex trs_memory trs_keyboard error debug dis trs_io trs_cassette trs_chars trs_printer trs_disk trs_interrupt trs_imp_exp trs_hard trs_uart trs_stringy common; do
  $CC $CF -c -o "$OUT/$m.o" "$SRC/$m.c"; OBJS="$OBJS $OUT/$m.o"
done
for m in trs_rom1 trs_rom1x trs_rom3 trs_rom4p; do $CC $CF -c -o "$OUT/$m.o" "$OUT/$m.c"; OBJS="$OBJS $OUT/$m.o"; done
# Every CPU write, the interrupt push included, goes through the driver's logger.
$CC $CF -Dmem_write=fg_mem_write -Dmem_write_word=fg_mem_write_word -c -o "$OUT/z80.o" "$SRC/z80.c"
# shellcheck disable=SC2086
$CC $CF -o "$BIN" "$DRIVER" "$OUT/z80.o" $OBJS
printf '%s\n' "$STAMP" > "$BIN.stamp"
echo "built xtrs $PIN with Fugløy's patch at $BIN"
