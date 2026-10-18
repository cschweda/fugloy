/**
 * The trsjs adapter (emu phase 7, Task 1). The refusal tests always run; the rest need trsjs
 * (`pnpm trsjs:install`), the Model III ROM (fugloy.mcp.json), and FUGLOY_TRSJS=1.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Machine } from '../../src/index.js';
import { configuredRom, ROM_TEST_TIMEOUT } from '../rom.js';
import { loadTrsjs, TRSJS_PATH, TRSJS_SHA256 } from './trsjs-adapter.js';

describe('loadTrsjs refuses a file it cannot trust', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fugloy-trsjs-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('names pnpm trsjs:install and the pinned hash when the file is missing', () => {
    const path = join(dir, 'missing.js');
    expect(() => loadTrsjs({ path })).toThrow(`no trsjs at ${path}; run \`pnpm trsjs:install\` to fetch trsemu-1.6.js (SHA-256 ${TRSJS_SHA256})`);
  });

  it('refuses a file with another SHA-256 before running any of it', () => {
    const path = join(dir, 'trsemu-1.6.js');
    // Run, this would throw a different error; the hash check must come first.
    writeFileSync(path, 'throw new Error("tampered trsjs ran");\n');
    expect(() => loadTrsjs({ path })).toThrow(/has SHA-256 [0-9a-f]{64}, not the pinned d6e5b270[0-9a-f]+; delete it and run `pnpm trsjs:install`/);
  });
});

const rom = configuredRom('model3');
const skipReason =
  process.env.FUGLOY_TRSJS !== '1' ? 'set FUGLOY_TRSJS=1 to run'
  : !existsSync(TRSJS_PATH) ? `no ${TRSJS_PATH}; run pnpm trsjs:install`
  : rom === null ? 'no Model III ROM in fugloy.mcp.json'
  : null;

/** F with bits 3 and 5 (the undocumented X/Y copies) cleared. */
const F_MASK = 0xd7;
const REGS = ['a', 'f', 'b', 'c', 'd', 'e', 'h', 'l', 'a2', 'f2', 'b2', 'c2', 'd2', 'e2', 'h2', 'l2', 'ix', 'iy', 'sp', 'pc', 'i', 'r', 'iff1', 'iff2', 'im'];

/** Our registers in the reference's terms: R as 7 bits, IFF set during EI's one-instruction delay. */
function ourRegs(m) {
  const o = { ...m.cpu.regs, r: m.cpu.regs.r & 0x7f };
  if (m.system.cpu.pendingEI > 0) o.iff1 = o.iff2 = true;
  return o;
}

/** Registers that differ, F and F' compared with bits 3 and 5 masked. */
function diffRegs(o, s) {
  return REGS.filter((k) => (k === 'f' || k === 'f2' ? (o[k] ^ s[k]) & F_MASK : o[k] !== s[k]));
}

/** True when the instruction at `pc` in our memory is a BIT (CB, DDCB, or FDCB). */
function isBit(m, pc) {
  const b = m.mem.read(pc, 4);
  if (b[0] === 0xcb) return (b[1] & 0xc0) === 0x40;
  return (b[0] === 0xdd || b[0] === 0xfd) && b[1] === 0xcb && (b[3] & 0xc0) === 0x40;
}

/**
 * The known trsjs inaccuracies the spike found (plan, Architecture), as a minimal predicate for
 * this test; Task 2's known.js is the full table. Null when the difference is none of them.
 */
function knownClass(m, pc, d, o, s, ours, ref) {
  const onlyF = d.every((k) => k === 'f');
  if (onlyF && isBit(m, pc) && ((o.f ^ s.f) & ~0xac) === 0) return 'BIT: S, P/V';
  if (d.length === 1 && d[0] === 'r' && ref.irq) return 'IRQ response: R';
  const b = m.mem.read(pc, 2);
  if (d.length === 1 && d[0] === 'r' && (b[0] === 0xdd || b[0] === 0xfd) && b[1] === 0xcb) return 'DDCB/FDCB: R';
  if (ours.irq && !ref.irq) return 'interrupt held while DI: trsjs drops it';
  return null;
}

/** Record our memory writes and interrupt responses, step by step (test-only wrappers). */
function instrument(m) {
  const mem = m.system.memory;
  const cpu = m.system.cpu;
  const log = { writes: /** @type {{addr: number, value: number}[]} */ ([]), irq: false };
  const write = mem.writeByte.bind(mem);
  mem.writeByte = (addr, value) => {
    log.writes.push({ addr: addr & 0xffff, value: value & 0xff });
    write(addr, value);
  };
  const interrupt = cpu.interrupt.bind(cpu);
  cpu.interrupt = (bus) => {
    const taken = interrupt(bus);
    if (taken) log.irq = true;
    return taken;
  };
  return {
    step() {
      log.writes = [];
      log.irq = false;
      const { cycles } = m.step(1);
      return { cycles, irq: log.irq, writes: log.writes };
    },
  };
}

/**
 * Lockstep `n` instructions from the reference synced to `m`. Every instruction must agree on its
 * T-states, its PC, and its memory writes; any register difference must be a known class, after
 * which the reference is resynced from our state. Returns the class counts and the first
 * unexplained difference.
 */
function lockstep(m, ref, n) {
  const ours = instrument(m);
  ref.syncFrom(m);
  /** @type {Record<string, number>} */
  const known = {};
  for (let k = 0; k < n; k++) {
    const pc = m.cpu.regs.pc;
    const a = ours.step();
    const b = ref.step();
    const o = ourRegs(m);
    const s = ref.regs();
    const d = diffRegs(o, s);
    const writesMatch = JSON.stringify(a.writes) === JSON.stringify(ref.writes());
    if (d.length === 0 && a.cycles === b.cycles && writesMatch) continue;
    const cls = knownClass(m, pc, d, o, s, a, b);
    if (cls === null || (cls !== 'interrupt held while DI: trsjs drops it' && (a.cycles !== b.cycles || !writesMatch))) {
      return { known, unexplained: { k, pc, d, cycles: [a.cycles, b.cycles], writes: [a.writes, ref.writes()], o, s } };
    }
    known[cls] = (known[cls] ?? 0) + 1;
    ref.syncFrom(m);
  }
  return { known, unexplained: null };
}

describe.skipIf(skipReason !== null)(`trsjs adapter against @fugloy/emu${skipReason === null ? '' : ` (skipped: ${skipReason})`}`, { timeout: ROM_TEST_TIMEOUT }, () => {
  const newMachine = () => new Machine({ roms: { level2: /** @type {Uint8Array} */ (rom) } });

  it('loads in its power-on state: PC $0000, the cycle count 0', () => {
    const ref = loadTrsjs();
    expect(ref.regs().pc).toBe(0);
    expect(ref.cycles).toBe(0);
    expect(ref.writes()).toEqual([]);
  });

  it('boots the ROM 100,000 instructions in step with us, only the known classes differing', () => {
    const m = newMachine();
    const ref = loadTrsjs();
    const { known, unexplained } = lockstep(m, ref, 100_000);
    expect(unexplained).toBeNull();
    expect(ref.cycles).toBe(m.cycles);
    // The spike's counts for the ROM boot; flag bits 3/5 are masked, so they are not counted here.
    expect(known['BIT: S, P/V']).toBeGreaterThan(0);
    expect(known['IRQ response: R']).toBeGreaterThan(0);
    // Video RAM and RAM agree at the end.
    expect(ref.peek(0x3c00, 0xc400)).toEqual(m.mem.read(0x3c00, 0xc400));
  });

  it('after syncFrom, stepping matches our step: registers, T-states, writes, and memory', () => {
    const m = newMachine();
    m.step(50_000);
    const ref = loadTrsjs();
    ref.syncFrom(m);
    expect(ref.regs()).toEqual(ourRegs(m));
    expect(ref.cycles).toBe(m.cycles);
    expect(ref.peek(0x0000, 0x3800)).toEqual(m.mem.read(0x0000, 0x3800));
    const { unexplained } = lockstep(m, ref, 20_000);
    expect(unexplained).toBeNull();
    expect(ref.cycles).toBe(m.cycles);
  });

  it('raises the 30 Hz interrupt when we do, after alignRtc', () => {
    const m = newMachine();
    m.step(50_000);
    const ref = loadTrsjs();
    const ours = instrument(m);
    ref.syncFrom(m);
    let oursAt = -1;
    let refAt = -1;
    for (let k = 0; k < 20_000 && (oursAt < 0 || refAt < 0); k++) {
      if (ours.step().irq && oursAt < 0) oursAt = k;
      if (ref.step().irq && refAt < 0) refAt = k;
    }
    expect(oursAt).toBeGreaterThanOrEqual(0);
    expect(refAt).toBe(oursAt);
  });

  it('logs the last step\'s memory writes: a PUSH writes the two stack bytes', () => {
    const ref = loadTrsjs();
    ref.poke(0x5000, [0xc5]); // PUSH BC
    const r = ref.z.reg;
    r.PC = 0x5000; r.SP = 0x6000; r.BC = 0x1234;
    expect(ref.step().cycles).toBe(11);
    expect(ref.writes()).toEqual([{ addr: 0x5fff, value: 0x12 }, { addr: 0x5ffe, value: 0x34 }]);
    expect(ref.peek(0x5ffe, 2)).toEqual(new Uint8Array([0x34, 0x12]));
  });

  it('presses a matrix key: the keyboard row reads it', () => {
    const ref = loadTrsjs();
    ref.setKeyBit(0, 1, true); // row 0 bit 1 is A
    expect(ref.peek(0x3801, 1)[0]).toBe(0x02);
    ref.setKeyBit(0, 1, false);
    expect(ref.peek(0x3801, 1)[0]).toBe(0x00);
  });

  it('syncFrom copies our keyboard matrix', () => {
    const m = newMachine();
    m.system.keyboard.pressKey(6, 0); // ENTER
    const ref = loadTrsjs();
    ref.syncFrom(m);
    expect(ref.peek(0x3840, 1)[0]).toBe(0x01);
    expect(ref.peek(0x3840, 1)).toEqual(m.mem.read(0x3840, 1));
  });
});
