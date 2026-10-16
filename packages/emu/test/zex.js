/**
 * ZEXDOC and ZEXALL, from tools/zex/ (pnpm zex:install). Each .COM begins JP start, and start
 * loads HL with the address of a table of test-group pointers that ends at a 0000H word. A group
 * descriptor is a flag-mask byte, three 20-byte machine states (base, counter mask, shifter
 * mask), and the expected 4-byte CRC: 65 bytes. The group's name follows, padded with dots to
 * 30 characters and ended by $; the exerciser prints it, then "  OK" or "  ERROR ...".
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runCpm } from './cpm.js';

const TOOLS = new URL('../../../tools/zex/', import.meta.url);

/** A Vitest timeout per group: the largest takes about 3 minutes on a 2024 laptop. */
export const ZEX_TIMEOUT = 30 * 60_000;

/** The largest group needs about 2×10^10 T-states; one still running at this many has hung. */
const GROUP_TSTATES = 5e10;

export function zexBinary(name) {
  const path = fileURLToPath(new URL(name, TOOLS));
  if (existsSync(path)) return new Uint8Array(readFileSync(path));
  if (process.env.FUGLOY_REQUIRE_ZEX === '1') throw new Error(`${path} is missing: run pnpm zex:install`);
  return null;
}

/** The little-endian word at address `a` of a program loaded at 0100H. */
const word = (p, a) => p[a - 0x100] | (p[a - 0x100 + 1] << 8);

/** The group table: the first LD HL,nn after start whose nn is a run of 60 or more pointers ending at 0000H. */
function tableAddress(p) {
  if (p[0] !== 0xc3) throw new Error('not an exerciser: it does not begin with JP');
  const start = word(p, 0x101);
  for (let a = start; a < start + 64; a++) {
    if (p[a - 0x100] !== 0x21) continue;
    const t = word(p, a + 1);
    let n = 0;
    while (t + 2 * n + 1 - 0x100 < p.length && word(p, t + 2 * n) !== 0) n++;
    if (n >= 60) return t;
  }
  throw new Error('no group table after start');
}

export function zexGroups(p) {
  const t = tableAddress(p);
  const groups = [];
  for (let i = 0; word(p, t + 2 * i) !== 0; i++) {
    const pointer = word(p, t + 2 * i);
    const label = String.fromCharCode(...p.subarray(pointer + 65 - 0x100, pointer + 95 - 0x100));
    groups.push({ pointer, name: label.replace(/\.+$/, ''), label });
  }
  return groups;
}

/** Runs group `index` alone, the table cut to that one entry, and returns the line it printed. */
export function runZexGroup(p, index) {
  const t = tableAddress(p);
  const { pointer, label } = zexGroups(p)[index];
  const alone = p.slice();
  alone.set([pointer & 0xff, pointer >> 8, 0, 0], t - 0x100);
  const { output, exited } = runCpm(alone, { maxTStates: GROUP_TSTATES });
  if (!exited) throw new Error(`group ${index + 1} (${label}) did not finish in ${GROUP_TSTATES} T-states`);
  // This build ends its lines LF CR. A whole label, dots and all, cannot match another group's line.
  const line = output.split(/[\r\n]+/).find((l) => l.startsWith(label));
  if (line === undefined) throw new Error(`group ${index + 1} printed no result line: ${JSON.stringify(output)}`);
  return line;
}
