#!/bin/sh
# Emu phase 7 (Model I) spike: build xtrs's Model I core headless, out of tree, with our driver.
# Needs: xtrs cloned at the pinned commit into tools/xtrs/src, and zmac in tools/zmac (pnpm zmac
# install). Output: tools/xtrs/build/fugloy-step. No X11, no readline, no KBWAIT. Run from anywhere:
#   git clone https://github.com/TimothyPMann/xtrs.git tools/xtrs/src
#   git -C tools/xtrs/src checkout 3a2180c063811a715faa28d39a94739c33e0abd0
#   sh packages/emu/scripts/spike-model1/build.sh
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../../../.." && pwd)
SRC=$ROOT/tools/xtrs/src; OUT=$ROOT/tools/xtrs/build; ZMAC=$ROOT/tools/zmac/zmac
PIN=3a2180c063811a715faa28d39a94739c33e0abd0
[ "$(git -C "$SRC" rev-parse HEAD)" = "$PIN" ] || { echo "tools/xtrs/src is not xtrs at $PIN; clone and check it out as this script's header says." >&2; exit 1; }
mkdir -p "$OUT"
CF="-O2 -Wall -Wno-unused-parameter -Wno-deprecated-declarations -Wno-unused-variable -Wno-unused-but-set-variable -D_DARWIN_C_SOURCE -DDISKDIR=\".\" -I$SRC"
for f in fakerom esfrom xtrsrom4p; do (cd "$OUT" && "$ZMAC" -P -o $f.hex "$SRC/$f.z80" >/dev/null); done
cc $CF -o "$OUT/compile_rom" "$SRC/compile_rom.c" "$SRC/error.c" "$SRC/load_cmd.c" "$SRC/load_hex.c"
"$OUT/compile_rom" 1 "$OUT/fakerom.hex" > "$OUT/trs_rom1.c"
"$OUT/compile_rom" 1x "$OUT/esfrom.hex" > "$OUT/trs_rom1x.c"
"$OUT/compile_rom" 3 "$OUT/fakerom.hex" > "$OUT/trs_rom3.c"
"$OUT/compile_rom" 4p "$OUT/xtrsrom4p.hex" > "$OUT/trs_rom4p.c"
OBJS=""
for m in load_cmd load_hex trs_memory trs_keyboard error debug dis trs_io trs_cassette trs_chars trs_printer trs_disk trs_interrupt trs_imp_exp trs_hard trs_uart trs_stringy common; do
  cc $CF -c -o "$OUT/$m.o" "$SRC/$m.c"; OBJS="$OBJS $OUT/$m.o"
done
for m in trs_rom1 trs_rom1x trs_rom3 trs_rom4p; do cc $CF -c -o "$OUT/$m.o" "$OUT/$m.c"; OBJS="$OBJS $OUT/$m.o"; done
cc $CF -Dmem_write=fg_mem_write -Dmem_write_word=fg_mem_write_word -c -o "$OUT/z80.o" "$SRC/z80.c"
cc $CF -o "$OUT/fugloy-step" "$HERE/fugloy-step.c" "$OUT/z80.o" $OBJS
echo built "$OUT/fugloy-step"
