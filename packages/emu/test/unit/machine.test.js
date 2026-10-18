/**
 * The spec §3 Machine facade over TRS80System, with synthetic ROMs: stepping, running, state
 * access, the shared RTC schedule, construction rules, and the in-package SHA-256.
 */
import { createHash } from 'node:crypto';
import { decode } from '@fugloy/z80';
import { describe, expect, it } from 'vitest';
import { Machine, ROM_HASHES, RTC_INTERVAL_TSTATES, TRS80System } from '../../src/index.js';
import { sha256Hex } from '../../src/machine/sha256.js';

/** A 14K ROM with `bytes` at $0000 (and `at` maps more addresses to bytes). */
function romWith(bytes, at = {}) {
  const rom = new Uint8Array(0x3800);
  rom.set(bytes, 0);
  for (const [addr, more] of Object.entries(at)) rom.set(more, Number(addr));
  return rom;
}

const machine = (bytes, at) => new Machine({ roms: { level2: romWith(bytes, at) } });

// LD A,1 / LD B,2 / ADD A,B / INC A / INC A / HALT
const COUNT_TO_5 = [0x3e, 0x01, 0x06, 0x02, 0x80, 0x3c, 0x3c, 0x76];

/** Unmask the RTC, EI, HALT, loop; the ISR at $0038 counts ticks at $4000 (as system.test.js). */
const RTC_COUNTER = romWith([0x31, 0x00, 0x80, 0x3e, 0x04, 0xd3, 0xe0, 0xed, 0x56, 0xfb, 0x76, 0x18, 0xfc], {
  0x38: [0xf5, 0x21, 0x00, 0x40, 0x34, 0xdb, 0xec, 0xf1, 0xfb, 0xed, 0x4d],
});

describe('Machine', () => {
  it('step(3) executes exactly three instructions, costing what @fugloy/z80 says', () => {
    const m = machine(COUNT_TO_5);
    const rom = romWith(COUNT_TO_5);
    let at = 0;
    let expected = 0;
    for (let k = 0; k < 3; k++) {
      const ins = decode((i) => rom[at + i]);
      expected += ins.cycles;
      at += ins.length;
    }
    const r = m.step(3);
    expect(m.cpu.regs.pc).toBe(at);
    expect(m.cycles).toBe(expected);
    expect(r).toEqual({ cycles: expected, halted: false });
  });

  it('step() defaults to one instruction and reports a HALT', () => {
    const m = machine([0x76]);
    expect(m.step()).toEqual({ cycles: 4, halted: true });
  });

  it("run({ cycles }) stops with 'cycles', overshooting by less than one instruction", () => {
    const m = machine([0x00, 0x00, 0xc3, 0x00, 0x00]); // NOP / NOP / JP 0000H (4, 4, 10)
    const r = m.run({ cycles: 1000 });
    expect(r.reason).toBe('cycles');
    expect(r.cycles).toBeGreaterThanOrEqual(1000);
    expect(r.cycles).toBeLessThan(1010);
    expect(m.cycles).toBe(r.cycles);
  });

  it.each([['a string', '1000'], ['NaN', NaN], ['negative', -1], ['Infinity', Infinity]])('run rejects a %s cycles budget, naming it', (_, bad) => {
    const m = machine([0x00, 0x00, 0xc3, 0x00, 0x00]);
    expect(() => m.run({ cycles: bad })).toThrow(/cycles/);
    expect(() => m.run({ cycles: bad })).toThrow(String(bad));
    expect(m.cycles).toBe(0);
  });

  it('run({ cycles: 0 }) still runs one instruction', () => {
    const m = machine([0x00, 0x00]);
    expect(m.run({ cycles: 0 })).toEqual({ reason: 'cycles', cycles: 4 });
  });

  it("run({ until: 'halt' }) stops at a HALT", () => {
    const m = machine(COUNT_TO_5);
    const r = m.run({ until: 'halt' });
    expect(r.reason).toBe('halt');
    expect(m.cpu.regs.a).toBe(5);
    expect(r.cycles).toBe(m.cycles);
  });

  it("run({ until: predicate }) stops with 'predicate' at the first boundary where it holds", () => {
    const m = machine(COUNT_TO_5);
    const r = m.run({ until: (mm) => mm.cpu.regs.a === 5 });
    expect(r.reason).toBe('predicate');
    expect(m.cpu.regs.pc).toBe(7); // after the second INC A, before HALT
  });

  it('run() with a budget and a condition stops at whichever comes first', () => {
    expect(machine([0x18, 0xfe]).run({ cycles: 500, until: 'halt' }).reason).toBe('cycles');
    expect(machine(COUNT_TO_5).run({ cycles: 500, until: 'halt' }).reason).toBe('halt');
  });

  it('run() with neither a budget nor a condition throws, rather than running forever', () => {
    expect(() => machine([0x00]).run({})).toThrow(/cycles.*until/);
  });

  it('regs and flags reflect a known state', () => {
    // LD SP,8000H / LD IX,1234H / LD IY,5678H / LD BC,0BCDH / LD DE,0DEFH / LD HL,4321H /
    // EXX / EX AF,AF' / XOR A (S0 Z1 H0 PV1 N0 C0) / IM 2 / LD A,80H / LD I,A / EI / NOP / HALT
    const m = machine([
      0x31, 0x00, 0x80, 0xdd, 0x21, 0x34, 0x12, 0xfd, 0x21, 0x78, 0x56, 0x01, 0xcd, 0x0b, 0x11, 0xef, 0x0d, 0x21, 0x21, 0x43,
      0xd9, 0x08, 0xaf, 0xed, 0x5e, 0x3e, 0x80, 0xed, 0x47, 0xfb, 0x00, 0x76,
    ]);
    m.run({ until: 'halt' });
    const regs = m.cpu.regs;
    expect(regs).toMatchObject({ a: 0x80, sp: 0x8000, ix: 0x1234, iy: 0x5678, b2: 0x0b, c2: 0xcd, d2: 0x0d, e2: 0xef, h2: 0x43, l2: 0x21, i: 0x80, iff1: true, iff2: true, im: 2, pc: 0x20 });
    expect(Object.keys(regs).sort()).toEqual(['a', 'a2', 'b', 'b2', 'c', 'c2', 'd', 'd2', 'e', 'e2', 'f', 'f2', 'h', 'h2', 'i', 'ix', 'iy', 'iff1', 'iff2', 'im', 'l', 'l2', 'pc', 'r', 'sp'].sort());
    expect(m.cpu.flags).toEqual({ s: false, z: true, h: false, pv: true, n: false, c: false });
    expect(regs.f & 0xd7).toBe(0x44);
  });

  it('mem.read returns a copy; mem.write to RAM reads back; mem.ram is the live 48K', () => {
    const m = machine([0x76]);
    m.mem.write(0x4000, [1, 2, 3]);
    const got = m.mem.read(0x4000, 3);
    expect(Array.from(got)).toEqual([1, 2, 3]);
    got[0] = 99;
    expect(m.mem.read(0x4000, 1)[0]).toBe(1);
    expect(m.mem.ram.length).toBe(0xc000);
    m.mem.ram[1] = 0x42;
    expect(m.mem.read(0x4001, 1)[0]).toBe(0x42);
    m.mem.write(0x0000, Uint8Array.of(0x00)); // ROM ignores writes
    expect(m.mem.read(0x0000, 1)[0]).toBe(0x76);
    expect(Array.from(m.mem.read(0xffff, 2))).toEqual([0, 0x76]); // wraps at 64K
  });

  it('io.out(0xEC, 4) sets 32-column mode on the wrapped system; io.in reads a port', () => {
    const m = machine([0x76]);
    expect(m.system.columns32).toBe(false);
    m.io.out(0xec, 4);
    expect(m.system.columns32).toBe(true);
    expect(m.io.in(0xec)).toBe(0xff);
  });

  it('the RTC fires at the same cycle under step, under run, and under TRS80System.runTStates', () => {
    const ticked = (read) => read(0x4000) === 1;
    const viaStep = new Machine({ roms: { level2: RTC_COUNTER } });
    while (!ticked((a) => viaStep.mem.read(a, 1)[0])) viaStep.step();
    const viaRun = new Machine({ roms: { level2: RTC_COUNTER } });
    expect(viaRun.run({ until: (mm) => ticked((a) => mm.mem.read(a, 1)[0]), cycles: 200_000 }).reason).toBe('predicate');
    const sys = new TRS80System({ romData: RTC_COUNTER });
    while (!ticked((a) => sys.memory.readByte(a))) sys.runTStates(1);
    expect(viaStep.cycles).toBe(sys.cpu.cycles);
    expect(viaRun.cycles).toBe(sys.cpu.cycles);
    expect(sys.cpu.cycles).toBeGreaterThan(RTC_INTERVAL_TSTATES);
    expect(sys.cpu.cycles).toBeLessThan(RTC_INTERVAL_TSTATES + 60);
  });

  it('reset() restarts the CPU at $0000 and the cycle count at 0', () => {
    const m = machine(COUNT_TO_5);
    m.run({ until: 'halt' });
    m.reset();
    expect(m.cycles).toBe(0);
    expect(m.cpu.regs.pc).toBe(0);
    expect(m.step().halted).toBe(false);
  });

  it('rejects models and RAM sizes that are not built (the Model I and Model 4 have their own tests in model1.test.js and model4.test.js)', () => {
    const roms = { level2: romWith([0x76]) };
    expect(() => new Machine({ model: 5, roms })).toThrow(/^model must be 1 /);
    expect(() => new Machine({ ram: 16, roms })).toThrow(/^The Model III takes ram: 48 \(K\), not 16; /);
    expect(() => new Machine({ model: 3, ram: 48, roms })).not.toThrow();
  });

  it('reports the ROM: its size, its SHA-256, and no recognized name for an unknown image', () => {
    const level2 = romWith([0x76]);
    const m = new Machine({ roms: { level2 } });
    expect(m.rom).toEqual({ bytes: 0x3800, sha256: createHash('sha256').update(level2).digest('hex'), recognized: null });
  });

  it('needs roms.level2', () => {
    expect(() => new Machine({ roms: {} })).toThrow(/roms\.level2/);
  });

  it('ROM_HASHES maps lowercase SHA-256 hex to a name', () => {
    expect(Object.keys(ROM_HASHES).length).toBeGreaterThan(0);
    for (const [hash, name] of Object.entries(ROM_HASHES)) {
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(name).toMatch(/^model[134]-/);
    }
  });
});

describe('sha256Hex', () => {
  it('matches the FIPS 180-4 test vectors', () => {
    const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
    expect(sha256Hex(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex(ascii('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex(ascii('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  it('agrees with node:crypto across block-boundary lengths', () => {
    for (const len of [55, 56, 63, 64, 65, 119, 120, 0x3800]) {
      const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 31 + 7) & 0xff);
      expect(sha256Hex(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
    }
  });
});
