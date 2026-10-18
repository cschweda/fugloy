/**
 * The trsjs adapter (emu phase 7, Task 1). The refusal tests always run; the rest run with
 * FUGLOY_TRSJS=1 and then need trsjs (`pnpm trsjs:install`) and, for those that boot it, the
 * Model III ROM (fugloy.mcp.json); either missing fails them (gate.js).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Machine } from '../../src/index.js';
import { ROM_TEST_TIMEOUT } from '../rom.js';
import { compareRun, ourRegs } from './compare.js';
import { requireRom, trsjsSkip } from './gate.js';
import { loadTrsjs, TRSJS_SHA256 } from './trsjs-adapter.js';

describe('loadTrsjs refuses a file it cannot trust', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fugloy-trsjs-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('names pnpm trsjs:install and the pinned hash when the file is missing', () => {
    const path = join(dir, 'missing.js');
    expect(() => loadTrsjs({ path })).toThrow(`no trsjs at ${path}; run \`pnpm trsjs:install\` to fetch trsemu-1.6.js (SHA-256 ${TRSJS_SHA256})`);
  });

  it('refuses a file with another SHA-256 before running any of it', () => {
    const path = join(dir, 'trsemu-1.6.js');
    // Were it run, this file would throw a different error: the hash check must come first.
    writeFileSync(path, 'throw new Error("tampered trsjs ran");\n');
    expect(() => loadTrsjs({ path })).toThrow(/has SHA-256 [0-9a-f]{64}, not the pinned d6e5b270[0-9a-f]+; delete it and run `pnpm trsjs:install`/);
  });
});

/** Record whether our CPU took an interrupt in each step (a test-only wrapper). */
function irqProbe(m) {
  const cpu = m.system.cpu;
  const interrupt = cpu.interrupt.bind(cpu);
  let took = false;
  cpu.interrupt = (bus) => {
    const taken = interrupt(bus);
    if (taken) took = true;
    return taken;
  };
  return () => {
    took = false;
    m.step(1);
    return took;
  };
}

describe.skipIf(trsjsSkip !== null)(`trsjs adapter against @fugloy/emu${trsjsSkip === null ? '' : ` (skipped: ${trsjsSkip})`}`, { timeout: ROM_TEST_TIMEOUT }, () => {
  const newMachine = () => new Machine({ roms: { level2: requireRom() } });

  it('loads in its power-on state: PC $0000, the cycle count 0', () => {
    const ref = loadTrsjs();
    expect(ref.regs().pc).toBe(0);
    expect(ref.cycles).toBe(0);
    expect(ref.writes()).toEqual([]);
  });

  it('boots the ROM 100,000 instructions in step with us, only the known classes differing', () => {
    const m = newMachine();
    const ref = loadTrsjs();
    const r = compareRun({ machine: m, reference: ref, instructions: 100_000 });
    expect(r.divergence).toBeNull();
    expect(ref.cycles).toBe(m.cycles);
    // The ROM boot's exact counts: a class that started to excuse more would change them.
    expect(r.known).toEqual({
      'BIT: S and P/V': 642,
      'flags 3 and 5 (X/Y)': 2806,
      'interrupt held while DI: trsjs drops it': 1,
      'interrupt response: R not counted': 13,
    });
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
    const r = compareRun({ machine: m, reference: ref, instructions: 20_000 });
    expect(r.divergence).toBeNull();
    expect(ref.cycles).toBe(m.cycles);
  });

  it('raises the 30 Hz interrupt when we do, after alignRtc', () => {
    const m = newMachine();
    m.step(50_000);
    const ref = loadTrsjs();
    const step = irqProbe(m);
    ref.syncFrom(m);
    let oursAt = -1;
    let refAt = -1;
    for (let k = 0; k < 20_000 && (oursAt < 0 || refAt < 0); k++) {
      if (step() && oursAt < 0) oursAt = k;
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

  it('logs a write to ROM or the keyboard but stores nothing there, as the Model III does', () => {
    const ref = loadTrsjs();
    // LD ($3723),A; LD ($3801),A; LD ($3C00),A
    ref.poke(0x5000, [0x32, 0x23, 0x37, 0x32, 0x01, 0x38, 0x32, 0x00, 0x3c]);
    const before = ref.peek(0x3723, 1)[0];
    const r = ref.z.reg;
    r.PC = 0x5000; r.A = 0x5a;
    ref.step();
    expect(ref.writes()).toEqual([{ addr: 0x3723, value: 0x5a }]);
    expect(ref.peek(0x3723, 1)[0]).toBe(before);
    ref.step();
    expect(ref.writes()).toEqual([{ addr: 0x3801, value: 0x5a }]);
    expect(ref.peek(0x3801, 1)[0]).toBe(0x00); // no key down
    ref.step();
    expect(ref.peek(0x3c00, 1)[0]).toBe(0x5a); // video RAM takes it
  });

  it('stores a byte, not the 12 bits trsjs\'s RLD and RRD shift into it', () => {
    const ref = loadTrsjs();
    const r = ref.z.reg;
    ref.poke(0x5000, [0xed, 0x6f, 0xed, 0x67]); // RLD / RRD
    ref.poke(0x6000, [0x9a]);
    r.PC = 0x5000; r.HL = 0x6000; r.A = 0x35;
    ref.step(); // RLD: (HL) = $A5, A = $39
    expect(ref.writes()).toEqual([{ addr: 0x6000, value: 0xa5 }]);
    expect([ref.z.mem[0x6000], r.A]).toEqual([0xa5, 0x39]);
    ref.step(); // RRD: (HL) = $9A, A = $35
    expect(ref.writes()).toEqual([{ addr: 0x6000, value: 0x9a }]);
    expect([ref.z.mem[0x6000], r.A]).toEqual([0x9a, 0x35]);
  });

  it('counts 21 T-states for a CPDR that repeats and 16 for its last, as for CPIR', () => {
    const ref = loadTrsjs();
    const r = ref.z.reg;
    ref.poke(0x5000, [0xed, 0xb9, 0xed, 0xb1]); // CPDR / CPIR
    ref.poke(0x6000, [0x00, 0x00]);
    r.PC = 0x5000; r.HL = 0x6001; r.BC = 2; r.A = 0x99;
    expect(ref.step().cycles).toBe(21);
    expect(r.PC).toBe(0x5000);
    expect(ref.step().cycles).toBe(16);
    expect(r.PC).toBe(0x5002);
    r.HL = 0x6000; r.BC = 2;
    expect(ref.step().cycles).toBe(21);
    expect(ref.step().cycles).toBe(16);
  });

  it('wraps PC and (IX+d) at 16 bits, as the Z80 does', () => {
    const ref = loadTrsjs();
    const r = ref.z.reg;
    ref.poke(0xffff, [0x00]); // NOP at $FFFF
    r.PC = 0xffff;
    ref.step();
    expect(r.PC).toBe(0x0000);
    ref.poke(0xffff, [0x3e]); // LD A,n with n at $0000
    ref.poke(0x0000, [0x42]);
    r.PC = 0xffff;
    expect(ref.step().cycles).toBe(7);
    expect([r.PC, r.A]).toEqual([0x0001, 0x42]);
    ref.poke(0x0000, [0x18, 0xfc]); // JR $-2 from $0000: $FFFE
    r.PC = 0x0000;
    ref.step();
    expect(r.PC).toBe(0xfffe);
    ref.poke(0x5000, [0xdd, 0x7e, 0x01]); // LD A,(IX+1) with IX = $FFFF reads $0000
    ref.poke(0x0000, [0x99]);
    r.PC = 0x5000; r.IX = 0xffff;
    ref.step();
    expect(r.A).toBe(0x99);
  });

  it('holds a frame-end request back when asked, and takes it when forced', () => {
    const ref = loadTrsjs();
    ref.poke(0x5000, [0x00, 0x00, 0x00]); // NOPs
    ref.poke(0x0038, [0x00]); // and a NOP for the handler
    const r = ref.z.reg;
    r.PC = 0x5000; r.SP = 0x6000; r.IFF1 = r.IFF2 = 1;
    ref.z.port_latch[0xe0] = 0x04; // the 30 Hz interrupt enabled
    ref.alignRtc(0); // due at the next step
    expect(ref.step({ irq: 'hold' })).toEqual({ cycles: 4, irq: false, raised: true });
    expect(r.PC).toBe(0x5001);
    expect(ref.z.port_status[0xe0] & 0x04).toBe(0); // still raised (active low)
    expect(ref.step({ irq: 'force' })).toEqual({ cycles: 13 + 4, irq: true, raised: false });
    expect(r.PC).toBe(0x0039);
    expect(ref.writes()).toEqual([{ addr: 0x5fff, value: 0x50 }, { addr: 0x5ffe, value: 0x01 }]);
  });

  it('drops a frame-end request while IFF1 is 0, as trsjs does', () => {
    const ref = loadTrsjs();
    ref.poke(0x5000, [0x00]);
    const r = ref.z.reg;
    r.PC = 0x5000; r.IFF1 = r.IFF2 = 0;
    ref.z.port_latch[0xe0] = 0x04;
    ref.alignRtc(0);
    expect(ref.step()).toEqual({ cycles: 4, irq: false, raised: true });
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

  it('syncFrom copies port $FF (input latch, tape level, output) and the NMI mask', () => {
    const m = newMachine();
    const io = m.system.io;
    io.cassette.pulseLatch = true;
    io.cassetteOut = 2;
    io.nmiMask = 0xff;
    const ref = loadTrsjs();
    ref.syncFrom(m);
    expect(ref.z.port_status[0xff]).toBe(0x80 | (io.cassette.inputLevel ? 1 : 0));
    expect(ref.z.port_latch[0xff]).toBe(2);
    expect(ref.z.port_latch[0xe4]).toBe(0xe0); // trsjs keeps the top three bits
  });

  it('syncRegs refreshes the inputs that change without a CPU write: port $E0 status and port $FF', () => {
    const m = newMachine();
    const ref = loadTrsjs();
    ref.syncFrom(m);
    const io = m.system.io;
    io.intLatch = 0x04;
    io.cassette.pulseLatch = true;
    ref.syncRegs(m);
    expect(ref.z.port_status[0xe0]).toBe(0xfb); // active low: the 30 Hz bit raised
    expect(ref.z.port_status[0xff] & 0x80).toBe(0x80);
  });

  it('redoes a DD/FD pair trsjs skipped: the prefix as one M1, then the instruction unprefixed', () => {
    const ref = loadTrsjs();
    ref.poke(0x5000, [0xdd, 0x41, 0xdd, 0xdd]); // LD B,C (DD-prefixed), then a lone DD
    const r = ref.z.reg;
    r.PC = 0x5000; r.R = 0; r.BC = 0x0011;
    expect(ref.step().cycles).toBe(0); // trsjs skips both bytes
    expect(ref.redoDroppedPrefix(0x5000, 0)).toBe(8);
    expect([r.PC, r.R, r.BC]).toEqual([0x5002, 2, 0x1111]);
    expect(ref.step().cycles).toBe(0);
    expect(ref.redoDroppedPrefix(0x5002, 2)).toBe(4); // a lone prefix runs nothing more
    expect([r.PC, r.R]).toEqual([0x5003, 3]);
  });

  it('lists the DD/FD opcodes trsjs implements: (IX+d) and IX forms, not LD B,C or a second prefix', () => {
    const ops = loadTrsjs().prefixedOps;
    for (const op of [0x09, 0x21, 0x36, 0x46, 0x77, 0x86, 0xcb, 0xe1, 0xe9]) expect(ops.has(op)).toBe(true);
    for (const op of [0x00, 0x41, 0xdd, 0xfd, 0xed, 0x76]) expect(ops.has(op)).toBe(false);
  });
});
