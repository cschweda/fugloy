/**
 * The census (M2 Task 3): plays a program's scripted sessions on @fugloy/emu and writes down what the
 * recompiler cannot work out from its bytes, as a port trace (src/trace.ts; docs/port-trace-format.md).
 * It needs emu, so it lives in tools/, never in src/; `pnpm census` (census-cli.ts) runs it.
 *
 * Each session starts on a fresh machine at the program's entry (the port's `entryAddr`: for a relocated
 * program, after its loader has moved it; the loader's copy is not self-modification), and from there
 * `m.debug` watches it:
 *   - coverage: every byte an instruction ran from (its opcode and operands, emu's EXEC and OPERAND bits);
 *   - a write hook: each byte written, by which instruction and with what value; a CALL's (or RST's) two
 *     writes mark the return address it pushed, and any other write over a marked byte unmarks it;
 *   - a read hook: a `POP` that reads a marked byte took that CALL's return address off the stack (a drop),
 *     a `POP` or a `RET` that reads one unmarks it, and a read of the ROM's space by an instruction outside
 *     it is a ROM byte read as data.
 * A code byte is one inside the hinted IR's code (at run addresses, the loader's left out) or one that ran
 * in a session. The ROM's space ($0000-$37FF on the Model III, $0000-$2FFF on the Model I) is never a
 * code byte here: what runs there is the ROM's, or the stub's stand-ins.
 */
import { programHash } from '@fugloy/disasm';
import type { Machine } from '@fugloy/emu';
import { prepare } from '../src/port.js';
import { TRACE_VERSION } from '../src/trace.js';
import type { PortTrace, TracePatch } from '../src/trace.js';
import { machineAtEntry } from '../test/sessions/sea-dragon.js';
import type { Session, SessionRom } from '../test/sessions/sea-dragon.js';

export interface CensusOptions {
  /** The program, a .CMD. */
  cmd: Uint8Array;
  /** Its file name, for the trace's `program.name`. */
  name: string;
  /** Its hint file's text, which names its entry and relocation. */
  hints: string;
  /** M2 runs the Model III only. */
  model: 3;
  /** 'game', Fugløy's game stub ROM (the trace's `rom` is then `stub`), or a Model III ROM's bytes (`user`). */
  rom: SessionRom;
  sessions: readonly Session[];
}

/** Where the ROM's space ends, by model. */
const ROM_END: Readonly<Record<1 | 3, number>> = { 1: 0x3000, 3: 0x3800 };
/** emu's coverage bits (packages/emu/src/debug/debugger.js, COVERAGE): an instruction's first byte, and its others. */
const EXEC = 1;
const OPERAND = 2;

/** The opcode at `pc` (past a DD, FD or ED prefix, with the prefix in bits 8-15) on `m`, read without a side effect. */
function opcodeAt(m: Machine, pc: number): number {
  const peek = (a: number): number => m.system.memory.peekByte(a & 0xffff);
  const op = peek(pc);
  return op === 0xdd || op === 0xfd || op === 0xed ? (op << 8) | peek(pc + 1) : op;
}
/** CALL nn, CALL cc,nn and RST n: what pushes a return address. */
const isCall = (op: number): boolean => op === 0xcd || (op <= 0xff && ((op & 0xc7) === 0xc4 || (op & 0xc7) === 0xc7));
/** POP BC, DE, HL, AF, IX and IY. */
const isPop = (op: number): boolean => (op <= 0xff && (op & 0xcf) === 0xc1) || op === 0xdde1 || op === 0xfde1;
/** RET, RET cc, RETN and RETI. */
const isRet = (op: number): boolean => op === 0xc9 || (op <= 0xff && (op & 0xc7) === 0xc0) || (op >> 8 === 0xed && (op & 0xc7) === 0x45);

/** `on` (1 where set) as inclusive ranges, by address. */
function ranges(on: Uint8Array): [number, number][] {
  const out: [number, number][] = [];
  for (let a = 0; a < on.length; a++) {
    if (on[a] !== 1) continue;
    const last = out[out.length - 1];
    if (last !== undefined && last[1] === a - 1) last[1] = a;
    else out.push([a, a]);
  }
  return out;
}

const byNumber = (x: number, y: number): number => x - y;

/** Plays each session and returns what they saw; see the header. */
export function census(opts: CensusOptions): PortTrace {
  const { cmd, model, rom, sessions } = opts;
  const p = prepare(cmd, { model, hints: opts.hints, runtimeImport: '@fugloy/runtime/ops' });
  if (!p.ok) throw new Error(`the program did not analyse: ${p.errors.join(' ')}`);
  const { entry } = p.prepared;
  const romEnd = ROM_END[model];
  const irCode = new Uint8Array(0x10000);
  for (const r of p.prepared.code) irCode.fill(1, r.start, r.end + 1);

  const executed = new Uint8Array(0x10000);
  const writes = new Map<number, { writers: Set<number>; values: Set<number> }>();
  const drops = new Map<number, number>();
  const romReads = new Map<number, number>();
  const played: { name: string; cycles: number }[] = [];

  for (const s of sessions) {
    const m = machineAtEntry(rom, cmd, entry);
    const start = m.cycles;
    /** Per stack byte: the number of the CALL whose return address it holds, or 0. */
    const pushedBy = new Int32Array(0x10000);
    let callWrites = 0;
    let lastDrop = 0;
    m.debug.hooks.onMemWrite = (addr: number, value: number, _prev: number, pc: number): void => {
      if (addr >= romEnd) {
        let w = writes.get(addr);
        if (w === undefined) writes.set(addr, (w = { writers: new Set(), values: new Set() }));
        w.writers.add(pc);
        w.values.add(value);
      }
      // A taken CALL or RST writes its return address's two bytes and nothing else: each pair one number.
      if (isCall(opcodeAt(m, pc))) pushedBy[addr] = (callWrites++ >> 1) + 1;
      else pushedBy[addr] = 0;
    };
    m.debug.hooks.onMemRead = (addr: number, value: number, pc: number): void => {
      if (addr < romEnd && pc >= romEnd) romReads.set(addr, value);
      const call = pushedBy[addr]!;
      if (call === 0) return;
      const op = opcodeAt(m, pc);
      if (isPop(op)) {
        // One drop per return address, whichever of its bytes the POP reads first.
        if (call !== lastDrop) drops.set(pc, (drops.get(pc) ?? 0) + 1);
        lastDrop = call;
        pushedBy[addr] = 0;
      } else if (isRet(op)) pushedBy[addr] = 0;
    };
    m.debug.coverage.enable();
    s.play(m);
    m.debug.hooks.onMemWrite = null;
    m.debug.hooks.onMemRead = null;
    const bits = m.debug.coverage.bits;
    for (let a = romEnd; a < 0x10000; a++) if (bits[a]! & (EXEC | OPERAND)) executed[a] = 1;
    played.push({ name: s.name, cycles: m.cycles - start });
  }

  const code = (a: number): boolean => irCode[a] === 1 || executed[a] === 1;
  const patches: TracePatch[] = [...writes]
    .filter(([a]) => code(a))
    .sort(([x], [y]) => x - y)
    .map(([addr, w]) => ({ addr, writers: [...w.writers].sort(byNumber), values: [...w.values].sort(byNumber) }));
  const entered = new Uint8Array(0x10000);
  for (let a = 0; a < 0x10000; a++) if (executed[a] === 1 && irCode[a] !== 1) entered[a] = 1;
  return {
    'fugloy-trace': TRACE_VERSION,
    program: { name: opts.name, sha256: programHash(cmd) },
    model,
    rom: rom === 'game' ? 'stub' : 'user',
    sessions: played,
    patches,
    entered: ranges(entered),
    drops: [...drops].sort(([x], [y]) => x - y).map(([at, count]) => ({ at, count })),
    romReads: [...romReads].sort(([x], [y]) => x - y).map(([addr, value]) => ({ addr, value })),
  };
}
