// The registers panel's data (phase 5C Ruling 11), DOM-free: a snapshot of the Z80's registers,
// and rows for the panel with what changed since the previous pause. PC and R move with every
// instruction, so they are never marked changed.
import type { Machine } from '@fugloy/emu';

export interface RegSnap {
  af: number;
  bc: number;
  de: number;
  hl: number;
  ix: number;
  iy: number;
  sp: number;
  pc: number;
  af2: number;
  bc2: number;
  de2: number;
  hl2: number;
  i: number;
  r: number;
  im: number;
  iff1: boolean;
  iff2: boolean;
}

export interface RegisterRow {
  name: string;
  value: string;
  changed: boolean;
}

export interface FlagRow {
  name: string;
  value: 0 | 1;
  changed: boolean;
}

const pair = (hi: number, lo: number): number => ((hi & 0xff) << 8) | (lo & 0xff);
const hex = (n: number, digits: number): string => `$${n.toString(16).toUpperCase().padStart(digits, '0')}`;

export function readRegisters(m: Machine): RegSnap {
  const r = m.cpu.regs;
  return {
    af: pair(r.a, r.f),
    bc: pair(r.b, r.c),
    de: pair(r.d, r.e),
    hl: pair(r.h, r.l),
    ix: r.ix & 0xffff,
    iy: r.iy & 0xffff,
    sp: r.sp & 0xffff,
    pc: r.pc & 0xffff,
    af2: pair(r.a2, r.f2),
    bc2: pair(r.b2, r.c2),
    de2: pair(r.d2, r.e2),
    hl2: pair(r.h2, r.l2),
    i: r.i & 0xff,
    r: r.r & 0xff,
    im: r.im,
    iff1: r.iff1,
    iff2: r.iff2,
  };
}

const ROWS: readonly [string, (s: RegSnap) => string][] = [
  ['AF', (s) => hex(s.af, 4)],
  ['BC', (s) => hex(s.bc, 4)],
  ['DE', (s) => hex(s.de, 4)],
  ['HL', (s) => hex(s.hl, 4)],
  ['IX', (s) => hex(s.ix, 4)],
  ['IY', (s) => hex(s.iy, 4)],
  ['SP', (s) => hex(s.sp, 4)],
  ['PC', (s) => hex(s.pc, 4)],
  ['AF′', (s) => hex(s.af2, 4)],
  ['BC′', (s) => hex(s.bc2, 4)],
  ['DE′', (s) => hex(s.de2, 4)],
  ['HL′', (s) => hex(s.hl2, 4)],
  ['I', (s) => hex(s.i, 2)],
  ['R', (s) => hex(s.r, 2)],
  ['IM', (s) => String(s.im)],
  ['IFF1', (s) => (s.iff1 ? 'interrupts on' : 'interrupts off')],
  ['IFF2', (s) => (s.iff2 ? 'interrupts on' : 'interrupts off')],
];
const NEVER_CHANGED: ReadonlySet<string> = new Set(['PC', 'R']);

/** The panel's rows; `changed` against `prev`, the snapshot at the previous pause (null: none). */
export function registerRows(now: RegSnap, prev: RegSnap | null): RegisterRow[] {
  return ROWS.map(([name, show]) => {
    const value = show(now);
    return { name, value, changed: prev !== null && !NEVER_CHANGED.has(name) && show(prev) !== value };
  });
}

const FLAGS: readonly [string, number][] = [
  ['Sign', 7],
  ['Zero', 6],
  ['Half-carry', 4],
  ['Parity/Overflow', 2],
  ['Add/Subtract', 1],
  ['Carry', 0],
];

/** The flags in F, spelled out, each 0 or 1; `changed` against `prev` (null: none). */
export function flagRows(f: number, prev: number | null): FlagRow[] {
  return FLAGS.map(([name, bit]) => {
    const value = ((f >> bit) & 1) as 0 | 1;
    return { name, value, changed: prev !== null && ((prev >> bit) & 1) !== value };
  });
}
