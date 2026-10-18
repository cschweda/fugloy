/**
 * Watchpoints, the hit log, and the memory and port hooks (spec §7), on synthetic ROMs. A read
 * is a data read: instruction fetches never count (phase 3 Ruling 2).
 */
import { describe, expect, it } from 'vitest';
import { Machine, RTC_INTERVAL_TSTATES } from '../../src/index.js';
import { Z80CPU } from '../../src/cpu/z80cpu.js';
import { instructionInfo } from '../../src/debug/instr.js';

/** A Machine over a synthetic ROM holding `code` at $0000, and `ram` bytes written at their addresses. */
function machine(code, ram = {}) {
  const rom = new Uint8Array(0x3800);
  rom.set(code, 0);
  const m = new Machine({ roms: { level2: rom } });
  for (const [addr, bytes] of Object.entries(ram)) m.mem.write(Number(addr), bytes);
  return m;
}

// LD SP,8000H / LD A,42H / LD (5000H),A ($0005) / LD A,(5000H) ($0008) / OUT (FFH),A / IN A,(FFH) / HALT
const DATA = [0x31, 0x00, 0x80, 0x3e, 0x42, 0x32, 0x00, 0x50, 0x3a, 0x00, 0x50, 0xd3, 0xff, 0xdb, 0xff, 0x76];
const dataMachine = () => machine(DATA, { 0x5000: [0x99] });
// T-states at the start of each instruction: LD SP 10, LD A,n 7, LD (nn),A 13, LD A,(nn) 13.
const AT_STORE = 17;
const AT_LOAD = 30;

/** JP 5000H from the ROM into `loop` written at $5000. */
const ramLoop = (loop) => machine([0xc3, 0x00, 0x50], { 0x5000: loop });

describe('watchpoints', () => {
  it('logs a write with its pc, value, and prev', () => {
    const m = dataMachine();
    const id = m.debug.watch(0x5000, 1);
    m.run({ until: 'halt' });
    expect(m.debug.hits()).toEqual([{ id, kind: 'write', cycle: AT_STORE, pc: 0x0005, addr: 0x5000, value: 0x42, prev: 0x99 }]);
    expect(m.debug.watches).toEqual([{ id, addr: 0x5000, len: 1, read: false, write: true, stop: false, hits: 1 }]);
  });

  it('logs reads only when asked', () => {
    const m = dataMachine();
    const w = m.debug.watch(0x5000, 1);
    const r = m.debug.watch(0x5000, 1, { read: true, write: false });
    m.run({ until: 'halt' });
    expect(m.debug.hits(w).map((h) => h.kind)).toEqual(['write']);
    expect(m.debug.hits(r)).toEqual([{ id: r, kind: 'read', cycle: AT_LOAD, pc: 0x0008, addr: 0x5000, value: 0x42, prev: 0x42 }]);
    expect(m.debug.hits().map((h) => h.id)).toEqual([w, r]); // oldest first
  });

  it('fetches are not reads', () => {
    // INC B / JR $5000: the watch covers the loop's own bytes.
    const plain = ramLoop([0x04, 0x18, 0xfd]);
    plain.debug.watch(0x5000, 3, { read: true });
    plain.run({ cycles: 10000 });
    expect(plain.debug.hits()).toEqual([]);

    // LD A,(5000H) / JR $5000: each LD reads its own opcode once as data.
    const load = ramLoop([0x3a, 0x00, 0x50, 0x18, 0xfb]);
    const r = load.debug.watch(0x5000, 5, { read: true });
    load.step(1 + 2 * 3);
    expect(load.debug.hits()).toEqual([0, 1, 2].map(() => expect.objectContaining({ id: r, kind: 'read', pc: 0x5000, addr: 0x5000, value: 0x3a })));

    // LD A,18H / LD (5005H),A / JR $5000: each trip rewrites the JR opcode with itself.
    const store = ramLoop([0x3e, 0x18, 0x32, 0x05, 0x50, 0x18, 0xf9]);
    const w = store.debug.watch(0x5000, 7, { read: true, write: true });
    store.step(1 + 3 * 3);
    expect(store.debug.hits()).toEqual([0, 1, 2].map(() => ({ id: w, kind: 'write', cycle: expect.any(Number), pc: 0x5002, addr: 0x5005, value: 0x18, prev: 0x18 })));
  });

  it('every instruction fetches its first len reads at pc + k, before any data read', () => {
    // The fetch rule counts reads; it holds only if the core fetches every opcode's bytes first, in order.
    const seqs = [];
    for (let a = 0; a < 256; a++) {
      if (a === 0xcb || a === 0xed || a === 0xdd || a === 0xfd) {
        for (let b = 0; b < 256; b++) {
          if ((a === 0xdd || a === 0xfd) && b === 0xcb) for (let c = 0; c < 256; c++) seqs.push([a, b, 0x05, c]);
          else seqs.push([a, b, 0x05, 0x07]);
        }
      } else seqs.push([a, 0x05, 0x07, 0x09]);
    }
    const pc = 0x8000;
    for (const s of seqs) {
      const mem = new Uint8Array(0x10000).fill(0x11);
      mem.set(s, pc);
      const cpu = new Z80CPU();
      const reads = [];
      cpu.readMemory = (x) => (reads.push(x), mem[x]);
      cpu.writeMemory = (x, v) => (mem[x] = v);
      cpu.readPort = () => 0xff;
      cpu.writePort = () => {};
      Object.assign(cpu.registers, { PC: pc, SP: 0x6000, H: 0x50, L: 0x00, B: 1, C: 0x10 });
      cpu.IX = 0x5100;
      cpu.IY = 0x5200;
      const { len } = instructionInfo((x) => mem[x], pc);
      cpu.executeInstruction();
      expect(reads.slice(0, len), s.map((x) => x.toString(16)).join(' ')).toEqual(Array.from({ length: len }, (_, k) => pc + k));
    }
  });

  it('stop returns after the instruction', () => {
    const m = dataMachine();
    const id = m.debug.watch(0x5000, 1, { stop: true });
    expect(m.run({ cycles: 1e6 })).toEqual({ reason: 'watch', id, cycles: AT_LOAD });
    expect(m.mem.read(0x5000, 1)[0]).toBe(0x42); // the write has landed
    expect(m.cpu.regs.pc).toBe(0x0008);
  });

  it('a watch stop wins over until and the cycle budget at the same boundary', () => {
    const m = dataMachine();
    const id = m.debug.watch(0x5000, 1, { stop: true });
    m.step(2);
    expect(m.run({ cycles: 1, until: () => true })).toEqual({ reason: 'watch', id, cycles: 13 });
  });

  it('step ignores watch stops but logs the hit', () => {
    const m = dataMachine();
    m.debug.watch(0x5000, 1, { stop: true });
    m.step(4);
    expect(m.cpu.regs.pc).toBe(0x000b);
    expect(m.debug.hits()).toHaveLength(1);
    expect(m.run({ until: 'halt' }).reason).toBe('halt'); // no stale stop from the step
  });

  it('the interrupt response\'s push is logged with the interrupted pc', () => {
    // LD A,4 / OUT (E0H),A / IM 1 / LD SP,8000H / EI, then INC C / JR $000A; the ISR at $0038 reads
    // the RTC status port, restores AF, EI, RET. The response pushes the PC to $7FFF and $7FFE.
    const rom = new Uint8Array(0x40);
    rom.set([0x3e, 0x04, 0xd3, 0xe0, 0xed, 0x56, 0x31, 0x00, 0x80, 0xfb, 0x0c, 0x18, 0xfd], 0);
    rom.set([0xf5, 0xdb, 0xec, 0xf1, 0xfb, 0xc9], 0x38);
    const m = machine(rom);
    const id = m.debug.watch(0x7ffe, 2);
    m.run({ cycles: RTC_INTERVAL_TSTATES + 5000 });
    const hits = m.debug.hits();
    expect(hits).toHaveLength(2);
    const [hi, lo] = hits;
    expect([hi.addr, lo.addr]).toEqual([0x7fff, 0x7ffe]);
    expect(hi.pc).toBe(lo.pc);
    expect([0x000a, 0x000b]).toContain(hi.pc);
    expect((hi.value << 8) | lo.value).toBe(hi.pc);
    expect(hi.id).toBe(id);
    expect(hi.cycle).toBeGreaterThanOrEqual(RTC_INTERVAL_TSTATES);
  });

  it('the keyboard hook\'s stand-in RET reads the stack with the CPU\'s pc', () => {
    // LD SP,8000H / CALL 002BH / HALT: the hook returns from $002B with the fed key.
    const m = machine([0x31, 0x00, 0x80, 0xcd, 0x2b, 0x00, 0x76]);
    m.keyboard.type('A', { mode: 'hook' });
    const id = m.debug.watch(0x7ffe, 2, { read: true, write: false });
    m.run({ until: 'halt' });
    expect(m.cpu.regs.a).toBe(0x41);
    expect(m.debug.hits().map((h) => [h.id, h.kind, h.pc, h.addr, h.value])).toEqual([
      [id, 'read', 0x002b, 0x7ffe, 0x06],
      [id, 'read', 0x002b, 0x7fff, 0x00],
    ]);
  });

  it('a watch wraps at 64K', () => {
    // LD HL,1234H / LD (FFFFH),HL writes $FFFF and $0000 (ROM, ignored but logged).
    const m = machine([0x21, 0x34, 0x12, 0x22, 0xff, 0xff, 0x76]);
    m.debug.watch(0xffff, 2);
    m.run({ until: 'halt' });
    expect(m.debug.hits().map((h) => [h.addr, h.value])).toEqual([[0xffff, 0x34], [0x0000, 0x12]]);
  });

  it('validates its arguments', () => {
    const m = dataMachine();
    expect(() => m.debug.watch(0x5000, 0)).toThrow(/len/);
    expect(() => m.debug.watch(0x5000, 0x10001)).toThrow(/len/);
    expect(() => m.debug.watch(0x10000, 1)).toThrow(/address/);
    expect(() => m.debug.watch(0x5000, 1, { read: false, write: false })).toThrow(/read or write/);
    expect(m.debug.watch(0, 0x10000)).toBe(1);
  });

  it('shares ids with breakpoints; unwatch removes and deactivates', () => {
    const m = dataMachine();
    expect(m.debug.break(0x0003)).toBe(1);
    const id = m.debug.watch(0x5000, 1);
    expect(id).toBe(2);
    m.debug.unbreak(1);
    expect(m.debug.active).toBe(true);
    expect(m.debug.unwatch(99)).toBe(false);
    expect(m.debug.unwatch(id)).toBe(true);
    expect(m.debug.watches).toEqual([]);
    expect(m.debug.active).toBe(false);
  });

  it('the ring keeps the newest 65,536 hits and sets hitsOverflowed', () => {
    // LD HL,5000H / loop: LD (HL),A / INC A / JR loop
    const m = machine([0x21, 0x00, 0x50, 0x77, 0x3c, 0x18, 0xfc]);
    m.debug.watch(0x5000, 1);
    m.step(1 + 3 * (65536 + 10));
    const hits = m.debug.hits();
    expect(hits).toHaveLength(65536);
    expect(m.debug.hitsOverflowed).toBe(true);
    expect(hits[0].value).toBe(10);
    expect(hits[65535].value).toBe((65536 + 9) & 0xff);
    expect(hits[1].cycle - hits[0].cycle).toBe(7 + 4 + 12);
    m.debug.clearHits();
    expect(m.debug.hits()).toEqual([]);
    expect(m.debug.hitsOverflowed).toBe(false);
  });
});

describe('hooks', () => {
  it('hooks see data accesses and ports', () => {
    const m = dataMachine();
    const log = [];
    m.debug.hooks.onMemRead = (addr, value) => log.push(['r', addr, value]);
    m.debug.hooks.onMemWrite = (addr, value, prev) => log.push(['w', addr, value, prev]);
    m.debug.hooks.onPort = (port, value, dir) => log.push(['p', port, value, dir]);
    m.run({ until: 'halt' });
    const portIn = m.cpu.regs.a;
    expect(log).toEqual([
      ['w', 0x5000, 0x42, 0x99],
      ['r', 0x5000, 0x42],
      ['p', 0xff, 0x42, 'out'],
      ['p', 0xff, portIn, 'in'],
    ]);
    expect(m.debug.active).toBe(true);
  });

  it('clearing every listener restores the plain accessors', () => {
    const m = dataMachine();
    const cpu = m.system.cpu;
    const plain = [cpu.readMemory, cpu.writeMemory, cpu.readPort, cpu.writePort];
    const now = () => [cpu.readMemory, cpu.writeMemory, cpu.readPort, cpu.writePort];
    const id = m.debug.watch(0x5000, 4, { read: true });
    m.debug.hooks.onMemWrite = () => {};
    m.debug.hooks.onPort = () => {};
    expect(now().every((f, k) => f !== plain[k])).toBe(true);
    m.debug.unwatch(id);
    expect(cpu.readMemory).toBe(plain[0]);
    m.debug.hooks.onMemWrite = null;
    m.debug.hooks.onPort = null;
    now().forEach((f, k) => expect(f).toBe(plain[k]));
    expect(m.debug.active).toBe(false);
    expect(() => {
      m.debug.hooks.onPort = 3;
    }).toThrow(/function or null/);
  });
});
