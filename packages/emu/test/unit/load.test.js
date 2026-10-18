/**
 * m.load.cmd, m.load.cas, and m.cassette with synthetic ROMs: the manifests, the tape put in the
 * deck for the ROM's own loader, the fast path, parseCmd over every example program, and
 * load-over-running (a load while halted or mid-run starts cleanly at the entry).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { casToPulses, fastLoadCmd, fastLoadSystem, Machine, parseCas, parseCmd } from '../../src/index.js';
import { startProgram } from '../../src/loaders/handoff.js';
import { buildBasicCas, buildSystemCas, T_PRINT } from './cas-builders.js';

/** A 14K ROM with `bytes` at $0000 (and `at` maps more addresses to bytes). */
function romWith(bytes, at = {}) {
  const rom = new Uint8Array(0x3800);
  rom.set(bytes, 0);
  for (const [addr, more] of Object.entries(at)) rom.set(more, Number(addr));
  return rom;
}

/** Records in order: { name } → 05, { addr, data } → 01, { type, payload } → any other, then 02 entry. */
function buildCmd(records, entry) {
  const out = [];
  for (const r of records) {
    if (r.name !== undefined) out.push(0x05, r.name.length, ...[...r.name].map((c) => c.charCodeAt(0)));
    else if (r.addr !== undefined) out.push(0x01, (r.data.length + 2) & 0xff, r.addr & 0xff, r.addr >> 8, ...r.data);
    else out.push(r.type, r.payload.length, ...r.payload);
  }
  out.push(0x02, 0x02, entry & 0xff, entry >> 8);
  return new Uint8Array(out);
}

const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
const HALT_ROM = romWith([0x76]);

describe('m.load.cmd', () => {
  it('returns the manifest, writes the blocks, and leaves the PC at the entry', () => {
    const m = new Machine({ roms: { level2: HALT_ROM } });
    const bytes = buildCmd([{ name: 'DEMO' }, { addr: 0x7000, data: [0x3e, 0x41, 0x18, 0xfe] }, { addr: 0x8000, data: new Array(256).fill(0xaa) }], 0x7000);
    const manifest = m.load.cmd(bytes);
    expect(manifest).toEqual({
      format: 'cmd',
      name: 'DEMO',
      entry: 0x7000,
      blocks: [
        { addr: 0x7000, len: 4, why: 'record 01' },
        { addr: 0x8000, len: 256, why: 'record 01' },
      ],
    });
    expect([...m.mem.read(0x7000, 4)]).toEqual([0x3e, 0x41, 0x18, 0xfe]);
    expect(m.mem.read(0x80ff, 1)[0]).toBe(0xaa);
    expect(m.cpu.regs.pc).toBe(0x7000);
    m.step(1);
    expect(m.cpu.regs.a).toBe(0x41);
  });

  it('cmd-record-07: a patch name header is skipped and the patch blocks after it load; a 10 (yanked) block is ignored', () => {
    // LDOS 5.1 manual, Tech Info: File Formats p. 1 (c): 07 = patch name, followed by the patch's 01 blocks; 10 = a yanked block.
    const m = new Machine({ roms: { level2: HALT_ROM } });
    const bytes = buildCmd(
      [
        { addr: 0x7000, data: [0x00, 0x00, 0x00] },
        { type: 0x07, payload: ascii('FIX1') },
        { addr: 0x7001, data: [0xc9] },
        { type: 0x10, payload: [0x02, 0x70, 0xff] },
      ],
      0x7000,
    );
    const manifest = m.load.cmd(bytes);
    expect(manifest.blocks).toEqual([
      { addr: 0x7000, len: 3, why: 'record 01' },
      { addr: 0x7001, len: 1, why: 'record 01' },
    ]);
    expect([...m.mem.read(0x7000, 3)]).toEqual([0x00, 0xc9, 0x00]);
  });

  it('propagates parseCmd errors', () => {
    const m = new Machine({ roms: { level2: HALT_ROM } });
    expect(() => m.load.cmd(new Uint8Array([0x01, 0x05, 0x00, 0x70, 0x00]))).toThrow(/Truncated \/CMD load block/);
  });
});

describe('parseCmd over every example program', () => {
  const root = fileURLToPath(new URL('../../../../examples/', import.meta.url));
  const walk = (dir) => readdirSync(dir).flatMap((e) => (statSync(join(dir, e)).isDirectory() ? walk(join(dir, e)) : [join(dir, e)]));
  const programs = walk(root).filter((f) => /\.(cmd|iii)$/i.test(f));

  it('finds the example programs', () => {
    expect(programs.length).toBeGreaterThan(0);
  });

  it.each(programs.map((f) => [f.slice(root.length), f]))('%s parses, and its entry lies in a loaded block', (_, file) => {
    const parsed = parseCmd(new Uint8Array(readFileSync(file)));
    expect(parsed.blocks.length).toBeGreaterThan(0);
    expect(parsed.blocks.some((b) => parsed.entry >= b.addr && parsed.entry < b.addr + b.data.length)).toBe(true);
  });
});

describe('m.load.cas', () => {
  const PROGRAM = [0x3e, 0x4f, 0x32, 0x00, 0x3c, 0x18, 0xfe];
  const system = () => buildSystemCas([{ addr: 0x7000, data: PROGRAM }, { addr: 0x7100, data: [1, 2, 3] }], 0x7000, { name: 'HELLO' });
  const basic = () => buildBasicCas([{ lineNo: 10, tokens: [T_PRINT, 0x20, 0x22, 0x48, 0x49, 0x22] }, { lineNo: 20, tokens: [0x80] }], { name: 'B' });
  const SYSTEM_BLOCKS = [
    { addr: 0x7000, len: PROGRAM.length, why: 'block 3C' },
    { addr: 0x7100, len: 3, why: 'block 3C' },
  ];

  it("a SYSTEM tape via 'rom' goes into the deck at 500 baud by default and writes nothing", () => {
    const m = new Machine({ roms: { level2: HALT_ROM } });
    const manifest = m.load.cas(system());
    expect(manifest).toEqual({ format: 'cas', kind: 'system', name: 'HELLO', entry: 0x7000, blocks: SYSTEM_BLOCKS.map((b) => ({ ...b, predicted: true })), baud: 500, via: 'rom' });
    const deck = m.system.io.cassette;
    expect(deck.pulseTape.length).toBeGreaterThan(0);
    expect(deck.pulsePos).toBe(0);
    expect(m.mem.read(0x7000, 1)[0]).toBe(0);
    expect(m.cpu.regs.pc).toBe(0);
  });

  it("a SYSTEM tape via 'fast' writes the blocks and jumps to the entry", () => {
    const m = new Machine({ roms: { level2: HALT_ROM } });
    const manifest = m.load.cas(system(), { via: 'fast' });
    expect(manifest).toEqual({ format: 'cas', kind: 'system', name: 'HELLO', entry: 0x7000, blocks: SYSTEM_BLOCKS, baud: null, via: 'fast' });
    expect([...m.mem.read(0x7000, PROGRAM.length)]).toEqual(PROGRAM);
    expect(m.cpu.regs.pc).toBe(0x7000);
    expect(m.system.io.cassette.pulseTape).toBe(null);
  });

  it("a BASIC tape via 'fast' writes the program at TXTTAB; via 'rom' the manifest predicts where CLOAD puts it", () => {
    const fast = new Machine({ roms: { level2: HALT_ROM } });
    fast.mem.write(0x40a4, [0xe9, 0x42]);
    const len = 5 + 6 + 5 + 1 + 2; // two lines and the 00 00 terminator
    expect(fast.load.cas(basic(), { via: 'fast' })).toEqual({ format: 'cas', kind: 'basic', name: 'B', blocks: [{ addr: 0x42e9, len, why: 'BASIC program' }], baud: null, via: 'fast' });
    expect(fast.mem.read(0x42e9 + 4, 1)[0]).toBe(T_PRINT);
    expect([...fast.mem.read(0x40f9, 2)]).toEqual([(0x42e9 + len) & 0xff, (0x42e9 + len) >> 8]);

    const rom = new Machine({ roms: { level2: HALT_ROM } });
    rom.mem.write(0x40a4, [0xe9, 0x42]);
    expect(rom.load.cas(basic(), { baud: 1500 })).toEqual({ format: 'cas', kind: 'basic', name: 'B', blocks: [{ addr: 0x42e9, len, why: 'BASIC program (predicted from TXTTAB; CLOAD not yet run)', predicted: true }], baud: 1500, via: 'rom' });
    expect(rom.mem.read(0x42e9 + 4, 1)[0]).toBe(0);
  });

  it('the tape in the deck carries the leader and sync for its baud, whatever leader the file had', () => {
    const m = new Machine({ roms: { level2: HALT_ROM } });
    const body = [0x55, ...ascii('HELLO '), 0x3c, 0x01, 0x00, 0x70, 0xc9, 0x39, 0x78, 0x00, 0x70];
    const expected = (baud) => {
      const leader = new Array(255).fill(baud === 500 ? 0x00 : 0x55);
      return casToPulses(new Uint8Array([...leader, baud === 500 ? 0xa5 : 0x7f, ...body]), baud);
    };
    // A file with a 1500-baud leader and sync, a bare one, and the builder's 55-leader-then-A5 one.
    for (const file of [[...new Array(40).fill(0x55), 0x7f, ...body], body, [...new Array(64).fill(0x55), 0xa5, ...body]]) {
      for (const baud of [500, 1500]) {
        m.load.cas(new Uint8Array(file), { baud });
        expect(m.system.io.cassette.pulseTape).toEqual(expected(baud));
      }
    }
  });

  it('rejects a bad baud or via, and propagates parseCas errors', () => {
    const m = new Machine({ roms: { level2: HALT_ROM } });
    expect(() => m.load.cas(system(), { baud: 1200 })).toThrow(/baud must be 500 or 1500/);
    expect(() => m.load.cas(system(), { via: 'disk' })).toThrow(/via must be 'rom' or 'fast'/);
    expect(() => m.load.cas(new Uint8Array([1, 2, 3, 4, 5]))).toThrow(/Unrecognized \.cas layout/);
  });
});

describe('m.cassette', () => {
  it('insert puts a pulse tape in the deck, rewind rewinds it, and motor reads the relay', () => {
    const m = new Machine({ roms: { level2: HALT_ROM } });
    const deck = m.system.io.cassette;
    m.cassette.insert(buildSystemCas([{ addr: 0x7000, data: [0xc9] }], 0x7000), { baud: 1500 });
    expect(deck.pulseTape.length).toBeGreaterThan(0);
    expect(m.cassette.motor).toBe(false);
    m.io.out(0xec, 0x02); // Model III port $EC bit 1: cassette motor on
    expect(m.cassette.motor).toBe(true);
    deck.pulsePos = 10;
    m.cassette.rewind();
    expect(deck.pulsePos).toBe(0);
    expect(() => m.cassette.insert(new Uint8Array([0x55]), { baud: 300 })).toThrow(/baud must be 500 or 1500/);
  });
});

describe('load-over-running', () => {
  // SP=$8000, unmask the RTC (OUT $E0,4), IM 1, EI, HALT. The ISR at $0038 never acknowledges:
  // it spins with interrupts off and the RTC request still latched.
  const SPIN_ISR = romWith([0x31, 0x00, 0x80, 0x3e, 0x04, 0xd3, 0xe0, 0xed, 0x56, 0xfb, 0x76, 0x18, 0xfc], { 0x38: [0x18, 0xfe] });
  // EI / NOP / NOP / JR $: once the EI takes effect, a stale request would fire at once.
  const PROG = buildCmd([{ addr: 0x7000, data: [0xfb, 0x00, 0x00, 0x18, 0xfe] }], 0x7000);

  it('startProgram lives in loaders/handoff.js, and with no EI in flight it leaves IFF1 and IFF2 alone', () => {
    const m = new Machine({ roms: { level2: HALT_ROM } });
    expect(startProgram(m.system, 0x7000)).toBe(0x7000);
    expect(m.cpu.regs.iff1).toBe(false);
    expect(m.cpu.regs.iff2).toBe(false);
  });

  it('loading while halted: the CPU leaves HALT and the next instruction is the entry', () => {
    const m = new Machine({ roms: { level2: SPIN_ISR } });
    expect(m.run({ until: 'halt', cycles: 1000 }).reason).toBe('halt');
    m.load.cmd(PROG);
    expect(m.system.cpu.halted).toBe(false);
    m.step(1);
    expect(m.cpu.regs.pc).toBe(0x7001);
  });

  it('loading inside an interrupt handler: no latched request or pending EI carries over to the program', () => {
    const m = new Machine({ roms: { level2: SPIN_ISR } });
    m.run({ until: (mm) => mm.cpu.regs.pc === 0x38, cycles: 200_000 });
    expect(m.cpu.regs.pc).toBe(0x38);
    expect(m.system.io.pendingInterrupt()).toBe(true);
    m.load.cmd(PROG);
    expect(m.system.io.pendingInterrupt()).toBe(false);
    expect(m.cpu.regs.iff1).toBe(false); // no EI in flight inside the ISR: interrupts stay off
    m.step(4); // EI, NOP, NOP, JR: no interrupt until the next RTC tick
    expect(m.cpu.regs.pc).toBe(0x7003);
    expect(m.cpu.regs.iff1).toBe(true);
  });

  it('an EI in flight takes effect at the load (IFF1 and IFF2 set) and a pending prefix is dropped, by fastLoadCmd and fastLoadSystem alike', () => {
    for (const load of [(sys) => fastLoadCmd(sys, parseCmd(PROG)), (sys) => fastLoadSystem(sys, parseCas(buildSystemCas([{ addr: 0x7000, data: [0x00] }], 0x7000)))]) {
      const m = new Machine({ roms: { level2: romWith([0xf3, 0xfb, 0x76]) } }); // DI / EI / HALT
      m.step(2);
      expect(m.system.cpu.pendingEI).toBeGreaterThan(0);
      m.system.cpu.afterPrefix = true;
      m.system.io.intLatch = 0xff;
      load(m.system);
      expect(m.system.cpu.pendingEI).toBe(0);
      expect(m.system.cpu.afterPrefix).toBe(false);
      expect(m.system.io.intLatch).toBe(0);
      expect(m.cpu.regs.iff1).toBe(true);
      expect(m.cpu.regs.iff2).toBe(true);
      expect(m.cpu.regs.pc).toBe(0x7000);
    }
  });
});
