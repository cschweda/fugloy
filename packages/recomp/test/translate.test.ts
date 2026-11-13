/**
 * @fugloy/recomp, M1 Task 2: translate() turns one Z80 instruction into JavaScript statements over
 * @fugloy/runtime's machine state. Every instruction @fugloy/z80 decodes (every table, documented or
 * not) runs here twice from the same seeded state: once on emu's CPU (packages/emu/src/cpu/z80cpu.js,
 * the oracle) over a flat 64K bus, as emu's unit tests build it (packages/emu/test/unit/bare.js), and
 * once as its translation on the runtime's flat machine. The registers, F, MEMPTR, the interrupt
 * state, the PC the transfer reaches, the 64K, every memory write in order, every port access (with
 * the T-state of each OUT), the T-states and R must all be equal, and `writesFlags` must be emu's own
 * Q (`flagsWritten`).
 *
 * Ports: emu's bare bus and the runtime's flat `z.in` both float to FFH, which would leave IN's flags
 * untested, so both sides here read the same seeded list of values instead (the test replaces flat
 * `z.in` on its own instance; what a real port does is untouched).
 */
import { Buffer } from 'node:buffer';
import { Z80CPU } from '@fugloy/emu';
import { createZ } from '@fugloy/runtime';
import type { Z } from '@fugloy/runtime';
import * as ops from '@fugloy/runtime/ops';
import { TABLES, decodeAt, formatInstruction } from '@fugloy/z80';
import type { Instruction, Template } from '@fugloy/z80';
import { describe, expect, it } from 'vitest';
import { translate } from '../src/index.js';
import type { Translation } from '../src/index.js';

const STATES = 64;

/** A seeded PRNG (mulberry32): 32 random bits a call, so a failure repeats. */
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

const hex = (n: number, width: number): string => n.toString(16).toUpperCase().padStart(width, '0');

// The prefix bytes and NOP, found in z80's tables rather than named.
const prefixByte = (p: 'CB' | 'DD' | 'ED' | 'FD'): number => TABLES.base.findIndex((t) => t.prefix === p);
const CB = prefixByte('CB');
const DD = prefixByte('DD');
const ED = prefixByte('ED');
const FD = prefixByte('FD');
/** The unprefixed opcode whose instruction formats as `text` (`ADD A,B`). */
const baseOp = (text: string): number => {
  const op = TABLES.base.findIndex((_, i) => formatInstruction(decodeAt([i, 0, 0], 0)) === text);
  if (op < 0) throw new Error(`no unprefixed ${text}`);
  return op;
};
const NOP = baseOp('NOP');

type TableName = 'base' | 'cb' | 'ed' | 'dd' | 'fd' | 'ddcb' | 'fdcb';
const TABLE_NAMES: readonly TableName[] = ['base', 'cb', 'ed', 'dd', 'fd', 'ddcb', 'fdcb'];

/** The bytes that select `op` in `table`; `d` is the displacement DD CB and FD CB put before it. */
function opcodeBytes(table: TableName, op: number, d: number): number[] {
  switch (table) {
    case 'base': return [op];
    case 'cb': return [CB, op];
    case 'ed': return [ED, op];
    case 'dd': return [DD, op];
    case 'fd': return [FD, op];
    case 'ddcb': return [DD, CB, d, op];
    case 'fdcb': return [FD, CB, d, op];
  }
}

/** Every opcode the tables decode to an instruction: not a prefix's slot, and not a DB fallback. */
const OPCODES: { table: TableName; op: number; t: Template }[] = TABLE_NAMES.flatMap((table) =>
  TABLES[table].map((t, op) => ({ table, op, t })).filter(({ t }) => t.prefix === undefined && t.mnemonic !== 'DB'),
);

const REPEATS_BC = new Set(['LDIR', 'LDDR', 'CPIR', 'CPDR']);
const REPEATS_B = new Set(['INIR', 'INDR', 'OTIR', 'OTDR']);
/** Ruling 5: the instructions whose lines read or replace the time, IN and OUT in every form, LD A,R and LD R,A. */
const READS_TIME = new Set(['IN', 'OUT', 'INI', 'IND', 'INIR', 'INDR', 'OUTI', 'OUTD', 'OTIR', 'OTDR']);
const readsTime = (ins: Instruction): boolean =>
  READS_TIME.has(ins.mnemonic) || (ins.mnemonic === 'LD' && ins.operands.some((o) => o.kind === 'reg' && o.reg === 'R'));

// ---- the state both machines are seeded with and compared by

const R8 = ['a', 'f', 'b', 'c', 'd', 'e', 'h', 'l', 'i', 'r', 'ixh', 'ixl', 'iyh', 'iyl'] as const;
type R8 = (typeof R8)[number];
const EMU8: Record<R8, string> = {
  a: 'A', f: 'F', b: 'B', c: 'C', d: 'D', e: 'E', h: 'H', l: 'L', i: 'I', r: 'R', ixh: 'IXH', ixl: 'IXL', iyh: 'IYH', iyl: 'IYL',
};
const ALT = [['af_', 'A_', 'F_'], ['bc_', 'B_', 'C_'], ['de_', 'D_', 'E_'], ['hl_', 'H_', 'L_']] as const;

interface State extends Record<R8, number> {
  sp: number; wz: number; af_: number; bc_: number; de_: number; hl_: number;
  iff1: boolean; iff2: boolean; im: number; cycles: number;
}

/**
 * A random state. The first four are edges, where writes wrap: all ones, SP at $0000 and $0001, all
 * zeros. The fifth has B = 1, so a DJNZ falls through.
 */
function randomState(rand: () => number, k: number): State {
  const s = {} as State;
  const fill = k === 3 ? 0 : k < 3 ? 0xff : -1;
  for (const r of R8) s[r] = fill < 0 ? rand() & 0xff : fill;
  if (k === 4) s.b = 1;
  s.sp = k === 1 ? 0x0000 : k === 2 ? 0x0001 : fill < 0 ? rand() & 0xffff : fill * 0x101;
  s.wz = fill < 0 ? rand() & 0xffff : fill * 0x101;
  for (const [pair] of ALT) s[pair] = rand() & 0xffff;
  s.iff1 = (rand() & 1) === 1;
  s.iff2 = (rand() & 1) === 1;
  s.im = rand() % 3;
  s.cycles = rand() & 0xfffffff;
  return s;
}

function setEmu(cpu: Z80CPU, s: State, q: 0 | 1): void {
  for (const r of R8) cpu.registers[EMU8[r]] = s[r];
  for (const [pair, hi, lo] of ALT) {
    cpu.registers[hi] = s[pair] >> 8;
    cpu.registers[lo] = s[pair] & 0xff;
  }
  cpu.registers.SP = s.sp;
  cpu.wz = s.wz;
  cpu.IFF1 = s.iff1;
  cpu.IFF2 = s.iff2;
  cpu.interruptMode = s.im;
  cpu.cycles = s.cycles;
  cpu.halted = false;
  cpu.pendingEI = 0;
  cpu.flagsWritten = q === 1; // emu's Q for the instruction before
}

function setZ(z: Z, s: State, q: 0 | 1): void {
  for (const r of R8) z[r] = s[r];
  z.sp = s.sp;
  z.wz = s.wz;
  z.af_ = s.af_;
  z.bc_ = s.bc_;
  z.de_ = s.de_;
  z.hl_ = s.hl_;
  z.iff1 = s.iff1;
  z.iff2 = s.iff2;
  z.im = s.im;
  z.cycles = s.cycles;
  z.q = q;
}

function emuState(cpu: Z80CPU): State {
  const s = {} as State;
  for (const r of R8) s[r] = cpu.registers[EMU8[r]]!;
  for (const [pair, hi, lo] of ALT) s[pair] = (cpu.registers[hi]! << 8) | cpu.registers[lo]!;
  s.sp = cpu.registers.SP!;
  s.wz = cpu.wz;
  s.iff1 = cpu.IFF1;
  s.iff2 = cpu.IFF2;
  s.im = cpu.interruptMode;
  s.cycles = cpu.cycles;
  return s;
}

function zState(z: Z): State {
  const s = {} as State;
  for (const r of R8) s[r] = z[r];
  s.sp = z.sp;
  s.wz = z.wz;
  s.af_ = z.af_;
  s.bc_ = z.bc_;
  s.de_ = z.de_;
  s.hl_ = z.hl_;
  s.iff1 = z.iff1;
  s.iff2 = z.iff2;
  s.im = z.im;
  s.cycles = z.cycles;
  return s;
}

// ---- the two machines, built once and reseeded for each case

interface Log { writes: number[]; ins: number[]; outs: number[] }
const newLog = (): Log => ({ writes: [], ins: [], outs: [] });

const cpu = new Z80CPU();
cpu.strictMode = true;
const emem = new Uint8Array(0x10000);
const z = createZ({ model: 'flat' });
const zmem = z.mem;
const ebuf = Buffer.from(emem.buffer);
const zbuf = Buffer.from(zmem.buffer);
const zproto = Object.getPrototypeOf(z) as Z;

let elog = newLog();
let zlog = newLog();
let ports: number[] = [0xff];
let eport = 0;
let zport = 0;
/** Each repeating iteration's state, PC and 64K, on each side. */
let eIter: { s: State; mem: Buffer }[] = [];
let zIter: { s: State; mem: Buffer }[] = [];

cpu.readMemory = (a) => emem[a & 0xffff]!;
cpu.writeMemory = (a, v) => {
  elog.writes.push(a & 0xffff, v & 0xff);
  emem[a & 0xffff] = v & 0xff;
};
cpu.readPort = (p) => {
  elog.ins.push(p & 0xff);
  return ports[eport++ % ports.length]!;
};
cpu.writePort = (p, v) => {
  elog.outs.push(p & 0xff, v & 0xff, cpu.cycles); // emu's cycles stand at the instruction's start
};
cpu.reset();

z.write = (a, v) => {
  zlog.writes.push(a & 0xffff, v & 0xff);
  zproto.write.call(z, a, v);
};
z.in = (p) => {
  zlog.ins.push(p & 0xff);
  return ports[zport++ % ports.length]!;
};
z.out = (p, v) => {
  zlog.outs.push(p & 0xff, v & 0xff, z.cycles);
};
/** A tick the lines make themselves (a repeating instruction's iterations) records the iteration. */
z.tick = (t, r) => {
  zproto.tick.call(z, t, r);
  zIter.push({ s: zState(z), mem: Buffer.from(zmem) });
};

/** Run statements as a port runs them: `z` the machine, `o` the runtime's helpers. */
const run = (lines: readonly string[]): void => {
  (new Function('z', 'o', lines.join('\n')) as (z: Z, o: unknown) => void)(z, ops);
};
const evaluate = (expr: string): unknown => (new Function('z', `return ${expr};`) as (z: Z) => unknown)(z);

/** The first address where the two 64Ks differ, or null. */
function firstDiff(a: Uint8Array, b: Uint8Array): string | null {
  for (let i = 0; i < 0x10000; i++) if (a[i] !== b[i]) return `$${hex(i, 4)}: emu ${hex(a[i]!, 2)}, port ${hex(b[i]!, 2)}`;
  return null;
}

/** Run translation `t` of the instruction at `at` on the runtime, as a block would: lines, transfer, tick. */
function runTranslation(t: Translation, ins: Instruction, at: number): { pc: number; taken: boolean } {
  run(t.lines);
  let taken = true;
  if (t.cond !== undefined) {
    expect(t.cyclesNotTaken, 'a conditional transfer has a not-taken time').toBeTypeOf('number');
    taken = evaluate(t.cond) === true;
    if (taken && t.taken) run(t.taken);
  }
  zproto.tick.call(z, taken ? t.cycles : t.cyclesNotTaken!, t.r);
  let pc = (at + ins.length) & 0xffff;
  if (t.flow !== 'next' && t.flow !== 'halt' && taken) pc = t.target ?? (evaluate(t.targetExpr!) as number);
  return { pc, taken };
}

interface CaseOpts {
  table: TableName;
  op: number;
  rand: () => number;
  k: number;
  /** Seed BC (or B, for the I/O ones) of a repeating instruction to this count. */
  count?: number;
}

/** For each conditional transfer checked (by its opcode bytes), the ways it went: taken, not taken. */
const ways = new Map<string, Set<boolean>>();

/**
 * One case: seed both machines alike, put the instruction at a random address, run it on emu and its
 * translation on the runtime, and require every field equal.
 */
function check({ table, op, rand, k, count = 1 }: CaseOpts): void {
  const s = randomState(rand, k);
  const filler = k < 3 ? [0xff, 0xff, 0xff] : k === 3 ? [0, 0, 0] : [rand() & 0xff, rand() & 0xff, rand() & 0xff];
  const bytes = [...opcodeBytes(table, op, filler[0]!), ...filler];
  const mnemonic = TABLES[table][op]!.mnemonic;
  const repeatsBC = REPEATS_BC.has(mnemonic);
  const repeatsB = REPEATS_B.has(mnemonic);
  if (repeatsBC) {
    s.b = count >> 8;
    s.c = count & 0xff;
  }
  if (repeatsB) s.b = count;

  // An address for the instruction that a repeating instruction's writes cannot reach (M1 refuses
  // self-modifying code; here it would only make emu run different bytes than were translated).
  let at = 0;
  const near = (v: number): boolean => ((at - v) & 0xffff) < 8 || ((v - at) & 0xffff) < 8;
  do at = rand() % 0xfff0;
  while ((repeatsBC || repeatsB) && (near((s.d << 8) | s.e) || near((s.h << 8) | s.l)));

  emem.fill(0);
  zmem.fill(0);
  ports = [rand() & 0xff, rand() & 0xff, rand() & 0xff, rand() & 0xff];
  eport = zport = 0;
  elog = newLog();
  zlog = newLog();
  eIter = [];
  zIter = [];

  emem.set(bytes, at);
  const ins = decodeAt(emem, at, at);
  const end = at + ins.length + (mnemonic === 'EI' ? 1 : 0);
  // Random bytes wherever the instruction can read: round every register pair, MEMPTR, and the
  // operand's address, but never over the instruction itself
  const reads = [(s.b << 8) | s.c, (s.d << 8) | s.e, (s.h << 8) | s.l, s.sp, s.wz, (s.ixh << 8) | s.ixl, (s.iyh << 8) | s.iyl];
  for (const o of ins.operands) {
    if (o.kind === 'mem') reads.push(o.addr);
    if (o.kind === 'idx') reads.push(((o.reg === 'IX' ? (s.ixh << 8) | s.ixl : (s.iyh << 8) | s.iyl) + o.disp) & 0xffff);
  }
  for (const v of reads) {
    for (let i = -3; i <= 4; i++) {
      const a = (v + i) & 0xffff;
      if (a < at || a >= end) emem[a] = rand() & 0xff;
    }
  }
  if (mnemonic === 'EI') emem[at + 1] = NOP;
  zmem.set(emem);

  const q = (rand() & 1) as 0 | 1;
  setEmu(cpu, s, q);
  setZ(z, s, q);
  cpu.registers.PC = at;

  // emu: one instruction, every iteration of a repeating one, and EI's NOP after it (Ruling 7)
  cpu.executeInstruction();
  while ((repeatsBC || repeatsB) && cpu.registers.PC === at) {
    eIter.push({ s: emuState(cpu), mem: Buffer.from(emem) });
    cpu.executeInstruction();
  }
  const wrote = cpu.flagsWritten;
  if (mnemonic === 'EI') cpu.executeInstruction();

  // the port
  const t = translate(ins, at, { qPrev: null });
  const ran = runTranslation(t, ins, at);
  let { pc } = ran;
  if (t.cond !== undefined) {
    const key = `${table} ${op}`;
    ways.set(key, (ways.get(key) ?? new Set()).add(ran.taken));
  }
  if (mnemonic === 'EI') {
    const nop = decodeAt(zmem, at + 1, at + 1);
    pc = runTranslation(translate(nop, at + 1, { qPrev: t.writesFlags ? 1 : 0 }), nop, at + 1).pc;
  }

  const label = `${formatInstruction(ins)} (${ins.bytes.map((b) => hex(b, 2)).join(' ')}) at $${hex(at, 4)}, state ${k}`;
  const got = {
    label, pc, ...zState(z), iterations: zIter.length, writesFlags: t.writesFlags, halted: t.flow === 'halt',
    repeats: t.repeats === true, readsTime: t.readsTime === true, writes: zlog.writes, ins: zlog.ins, outs: zlog.outs,
  };
  const want = {
    label, pc: cpu.registers.PC, ...emuState(cpu), iterations: eIter.length, writesFlags: wrote, halted: cpu.halted,
    repeats: repeatsBC || repeatsB, readsTime: readsTime(ins), writes: elog.writes, ins: elog.ins, outs: elog.outs,
  };
  expect(got).toEqual(want);
  if (!zbuf.equals(ebuf)) expect(firstDiff(emem, zmem), label).toBeNull();
  for (let i = 0; i < eIter.length; i++) {
    expect({ label, iteration: i, ...zIter[i]!.s }).toEqual({ label, iteration: i, ...eIter[i]!.s });
    if (!zIter[i]!.mem.equals(eIter[i]!.mem)) expect(firstDiff(eIter[i]!.mem, zIter[i]!.mem), `${label}, iteration ${i}`).toBeNull();
  }
}

describe('every opcode matches emu\'s core', () => {
  for (const table of TABLE_NAMES) {
    it(`${table}: ${OPCODES.filter((o) => o.table === table).length} opcodes, ${STATES} states each`, () => {
      for (const { op } of OPCODES.filter((o) => o.table === table)) {
        const rand = prng((TABLE_NAMES.indexOf(table) << 8) | op);
        for (let k = 0; k < STATES; k++) check({ table, op, rand, k });
      }
      for (const { op, t } of OPCODES.filter((o) => o.table === table && o.t.flow.conditional)) {
        expect([...(ways.get(`${table} ${op}`) ?? [])].sort(), `${t.mnemonic} taken and not taken`).toEqual([false, true]);
      }
    });
  }

  it('covers all 800 instructions the tables decode, documented or not', () => {
    const counts = Object.fromEntries(TABLE_NAMES.map((table) => [table, OPCODES.filter((o) => o.table === table).length]));
    expect(counts).toEqual({ base: 252, cb: 256, ed: 58, dd: 85, fd: 85, ddcb: 32, fdcb: 32 });
  });
});

describe('repeating block instructions, a full run of BC = 3 (B = 3 for the I/O ones)', () => {
  for (const mnemonic of [...REPEATS_BC, ...REPEATS_B]) {
    it(`${mnemonic}: every iteration's state, 64K, T-states and R`, () => {
      const op = TABLES.ed.findIndex((t) => t.mnemonic === mnemonic);
      const rand = prng(0x1000 | op);
      let longest = 0;
      for (let k = 0; k < STATES; k++) {
        check({ table: 'ed', op, rand, k, count: 3 });
        longest = Math.max(longest, eIter.length + 1);
      }
      expect(longest, 'some run takes all three iterations').toBe(3);
    });
  }
});

describe('SCF and CCF take bits 3 and 5 by Q', () => {
  // Q: emu's flagsWritten after the instruction before. ADD writes the flags; LD B,C does not, and
  // nor does POP AF, which loads F without writing it as flags.
  const before = ['ADD A,B', 'LD B,C', 'POP AF'];
  for (const text of ['SCF', 'CCF']) {
    for (const prior of before) {
      for (const mode of ['same block', 'block start'] as const) {
        it(`${text} after ${prior}, ${mode === 'same block' ? 'qPrev from it' : 'qPrev null, z.q from it'}`, () => {
          const rand = prng(baseOp(text) * 7 + before.indexOf(prior) * 2 + (mode === 'same block' ? 0 : 1));
          for (let k = 0; k < STATES; k++) {
            const s = randomState(rand, 4 + k);
            const at = rand() % 0xfff0;
            emem.fill(0);
            zmem.fill(0);
            elog = newLog();
            zlog = newLog();
            emem[at] = baseOp(prior);
            emem[at + 1] = baseOp(text);
            for (let i = 0; i < 2; i++) emem[(s.sp + i) & 0xffff] = rand() & 0xff;
            zmem.set(emem);
            setEmu(cpu, s, 1);
            setZ(z, s, 1);
            cpu.registers.PC = at;
            cpu.executeInstruction();
            cpu.executeInstruction();

            const first = translate(decodeAt(zmem, at, at), at, { qPrev: null });
            run(first.lines);
            zproto.tick.call(z, first.cycles, first.r);
            const qPrev = first.writesFlags ? 1 : 0;
            expect(qPrev, `${prior} writes the flags as emu says`).toBe(prior === 'ADD A,B' ? 1 : 0);
            let ctx: { qPrev: 0 | 1 | null } = { qPrev };
            if (mode === 'block start') {
              z.q = qPrev; // the block ended after it
              ctx = { qPrev: null };
            }
            const second = translate(decodeAt(zmem, at + 1, at + 1), at + 1, ctx);
            run(second.lines);
            zproto.tick.call(z, second.cycles, second.r);
            expect({ k, ...zState(z) }).toEqual({ k, ...emuState(cpu) });
          }
        });
      }
    }
  }
});

describe('what it refuses', () => {
  it('a byte sequence @fugloy/z80 decodes only as DB, with a sentence naming its bytes', () => {
    const cases: [number[], string][] = [
      [[DD, NOP], 'DD'], // a prefix on an opcode it does not change
      [[ED, 0x77], 'ED 77'], // an ED slot with no instruction
      [[DD, CB, 0x05, 0x00], 'DD CB 05 00'], // DD CB d with a register other than (IX+d)
    ];
    for (const [bytes, named] of cases) {
      const ins = decodeAt(bytes, 0, 0x5000);
      expect(ins.mnemonic).toBe('DB');
      expect(() => translate(ins, 0x5000, { qPrev: null })).toThrow(new RegExp(`\\$5000.*${named}`));
    }
  });
});
