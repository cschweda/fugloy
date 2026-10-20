#!/bin/sh
# Emu phase 7 (Model I) spike: turn boot.lua's MAME trace into the line format of `fugloy-xtrs --trace`
# (drops MAME's disassembly lines and the W/K/L lines; numbers the records from 0).
# usage: sh mame-to-lines.sh trace.log > mame.txt
grep -E '^[0-9A-F]{4} [0-9A-F]{4} ' "$1" | awk '{printf "%d %s %s %s %s %s %s %s %s %s %s\n", NR-1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10}'
