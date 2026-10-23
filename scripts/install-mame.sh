#!/usr/bin/env bash
# Checks MAME and assembles its trs80l2 ROM set for the trace reference of emu phase 7's Model I
# differential harness (packages/emu/test/diff/mame-trace.js). Idempotent.
#
# MAME is not installed by this script: it must be Homebrew's MAME 0.289 (`brew install mame`),
# whose `mame -version` prints `0.289 (unknown)`. The ROM set is built from your own Level II ROM
# (roms.model1 in fugloy.mcp.json): its three 4K pieces become the trs80l2 files with the names and
# CRCs MAME 0.289's driver lists (`mame -listroms trs80l2`), either the `level2` set or the `rsl2`
# set, in the gitignored tools/mame/roms/trs80l2/. The character generator (mcm6670p.z29) is not
# among your files, so a 1,024-byte file of zeros stands in for it; MAME then warns of a wrong
# checksum and runs, and with -video none it never shows a character. A real one you put there is
# kept. Nothing of MAME or the ROM is committed
# (docs/superpowers/notes/2026-10-19-model1-references-spike.md).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
exec node --input-type=module - "$ROOT" <<'EOF'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.argv[2];
const { checkMame, checkRomSet, MAME_ROMS, ROM_SETS, CHARGEN, pieceCrcs } = await import(pathToFileURL(join(root, 'packages/emu/test/diff/mame-trace.js')).href);
const { configuredRom } = await import(pathToFileURL(join(root, 'packages/emu/test/rom.js')).href);

const fail = (msg) => {
  console.error(`install-mame: ${msg}`);
  process.exit(1);
};
let mame;
try {
  mame = checkMame();
} catch (e) {
  fail(e.message);
}
const rom = configuredRom('model1');
if (rom === null) fail('fugloy.mcp.json names no Model I ROM: add roms.model1 (docs/fugloy-mcp-spec.md §3), then run pnpm mame:install again');
const crcs = pieceCrcs(rom);
const bios = Object.keys(ROM_SETS).find((b) => ROM_SETS[b].every((f, k) => f.crc === crcs[k]));
if (bios === undefined) {
  fail(`your Model I ROM (roms.model1) splits into 4K pieces with CRCs ${crcs.join(', ')}, which match neither of MAME 0.289's trs80l2 sets (${Object.entries(ROM_SETS).map(([b, fs]) => `${b}: ${fs.map((f) => f.crc).join(', ')}`).join('; ')}), so MAME cannot run it`);
}
const dir = join(MAME_ROMS, 'trs80l2');
mkdirSync(dir, { recursive: true });
ROM_SETS[bios].forEach((f, k) => writeFileSync(join(dir, f.name), rom.subarray(k * 4096, (k + 1) * 4096)));
const chargen = join(dir, CHARGEN.name);
if (!existsSync(chargen) || readFileSync(chargen).length !== CHARGEN.size) writeFileSync(chargen, new Uint8Array(CHARGEN.size));
checkRomSet({ rom });
console.log(`MAME ${mame.version} (${mame.path}); trs80l2 ROM set "${bios}" assembled from your Level II ROM in ${dir}`);
EOF
