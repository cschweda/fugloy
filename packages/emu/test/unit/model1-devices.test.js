/**
 * Emu phase 6, Task 2: the Model I's devices on synthetic 12K ROMs. The Expansion Interface's
 * 40 Hz clock through the interrupt latch at $37E0 (read clears the clock bit; none without the
 * interface), the stock video RAM's missing bit 6 and the lowercase modification, port $FF (the
 * cassette bits, MODESEL, the cassette flip-flop, and m.sound), a 500-baud tape read by a copy of
 * the Level II ROM's bit reader timed at the Model I's clock, the keyboard matrix as the ROM
 * scans it, and the ROM keyboard-scan hook (which stands in on the Model I: phase 6 Ruling 6).
 */
import { describe, expect, it } from 'vitest';
import { Machine, restoreState, serializeState } from '../../src/index.js';
import { DISK_BIT, InterruptLatch, TIMER_BIT } from '../../src/devices/interrupt-latch.js';
import { buildSystemCas } from './cas-builders.js';

const HZ = 1774080;

/** A 12K Model I ROM with `bytes` at $0000 and `at` mapping more addresses to bytes. */
function rom12(bytes = [0x76], at = {}) {
  const rom = new Uint8Array(0x3000);
  rom.set(bytes, 0);
  for (const [addr, more] of Object.entries(at)) rom.set(more, Number(addr));
  return rom;
}

const model1 = (bytes, at, opts = {}) => new Machine({ model: 1, roms: { level2: rom12(bytes, at) }, ...opts });
const model3 = (bytes = [0x76]) => {
  const rom = new Uint8Array(0x3800);
  rom.set(bytes, 0);
  return new Machine({ roms: { level2: rom } });
};
const word = (m, addr) => {
  const [lo, hi] = m.mem.read(addr, 2);
  return lo | (hi << 8);
};

// LD SP,8000H / IM 1 / EI / JR $
const IDLE_WITH_EI = [0x31, 0x00, 0x80, 0xed, 0x56, 0xfb, 0x18, 0xfe];
// At $0038: PUSH AF / PUSH HL / LD A,(37E0H) / LD (5000H),A / LD HL,(5002H) / INC HL / LD (5002H),HL / POP HL / POP AF / EI / RET
const HANDLER_READS_LATCH = [0xf5, 0xe5, 0x3a, 0xe0, 0x37, 0x32, 0x00, 0x50, 0x2a, 0x02, 0x50, 0x23, 0x22, 0x02, 0x50, 0xe1, 0xf1, 0xfb, 0xc9];
// At $0038: the same count, but $37E0 is never read
const HANDLER_IGNORES_LATCH = [0xf5, 0xe5, 0x2a, 0x02, 0x50, 0x23, 0x22, 0x02, 0x50, 0xe1, 0xf1, 0xfb, 0xc9];

describe('the Expansion Interface clock and its latch at $37E0', () => {
  it('raises a 40 Hz interrupt, taken in IM 1 at $0038, that reads $80 at $37E0', () => {
    const m = model1(IDLE_WITH_EI, { 0x38: HANDLER_READS_LATCH });
    m.run({ cycles: 2 * HZ });
    // Due at every 44,352 T-states (1,774,080 / 40); the 80th falls on the run's last boundary.
    expect(word(m, 0x5002)).toBeGreaterThanOrEqual(79);
    expect(word(m, 0x5002)).toBeLessThanOrEqual(80);
    expect(m.mem.read(0x5000, 1)[0]).toBe(TIMER_BIT);
    expect(m.system.rtcInterval).toBe(44352);
  });

  it('a handler that does not read $37E0 is interrupted again at once: the clock bit holds INT low', () => {
    const m = model1(IDLE_WITH_EI, { 0x38: HANDLER_IGNORES_LATCH });
    m.run({ cycles: HZ / 10 }); // four clock ticks' worth
    expect(word(m, 0x5002)).toBeGreaterThan(1000);
  });

  it('a CPU read of $37E0 returns the latch and clears the clock bit; m.mem.read peeks without clearing', () => {
    // DI / wait for (5100H) <> 0 / LD A,(37E0H) / LD (5000H),A / LD A,(37E0H) / LD (5001H),A / HALT
    const m = model1([0xf3, 0x3a, 0x00, 0x51, 0xb7, 0x28, 0xfa, 0x3a, 0xe0, 0x37, 0x32, 0x00, 0x50, 0x3a, 0xe0, 0x37, 0x32, 0x01, 0x50, 0x76]);
    m.run({ cycles: 50000 }); // past the first tick, interrupts disabled
    expect(m.mem.read(0x37e0, 1)[0]).toBe(0x80);
    expect(m.mem.read(0x37e0, 1)[0]).toBe(0x80); // a peek clears nothing
    m.mem.write(0x5100, [1]);
    m.run({ until: 'halt', cycles: 1000 });
    expect([...m.mem.read(0x5000, 2)]).toEqual([0x80, 0x00]);
  });

  it('$37E1-$37E3 read the latch too (MAME maps the read over all four); $37E4-$37EF read $FF for now', () => {
    const m = model1([0xf3, 0x18, 0xfe]);
    m.run({ cycles: 50000 });
    for (const a of [0x37e1, 0x37e2, 0x37e3]) expect(m.mem.read(a, 1)[0]).toBe(0x80);
    for (let a = 0x37e4; a <= 0x37ff; a++) expect(m.mem.read(a, 1)[0]).toBe(0xff);
    expect(m.mem.read(0x37df, 1)[0]).toBe(0xff);
  });

  it('the disk bit (6) interrupts, reads with the clock bit, and a $37E0 read leaves it for the controller to clear', () => {
    const m = model1(IDLE_WITH_EI, { 0x38: HANDLER_READS_LATCH });
    const latch = m.system.io.latch;
    expect(latch).toBeInstanceOf(InterruptLatch);
    m.run({ cycles: 100 });
    latch.raise(DISK_BIT);
    m.run({ cycles: 300 });
    expect(m.mem.read(0x5000, 1)[0]).toBe(DISK_BIT);
    expect(latch.bits).toBe(DISK_BIT); // still set: the handler keeps being entered
    latch.clear(DISK_BIT);
    m.run({ cycles: 300 }); // the handler entered last finishes
    const n = word(m, 0x5002);
    m.run({ cycles: 300 });
    expect(word(m, 0x5002)).toBe(n);
    latch.raise(DISK_BIT | TIMER_BIT);
    expect(latch.read()).toBe(0xc0);
    expect(latch.peek()).toBe(DISK_BIT);
  });

  it('without the Expansion Interface there is no clock, no latch, and $37E0 reads $FF', () => {
    const m = model1(IDLE_WITH_EI, { 0x38: HANDLER_READS_LATCH }, { expansion: false });
    expect(m.system.io.latch).toBeNull();
    m.run({ cycles: HZ });
    expect(word(m, 0x5002)).toBe(0);
    expect(m.mem.read(0x37e0, 1)[0]).toBe(0xff);
    // LD A,(37E0H) / LD (5000H),A / HALT, run by the CPU
    const n = model1([0x3a, 0xe0, 0x37, 0x32, 0x00, 0x50, 0x76], {}, { expansion: false });
    n.run({ until: 'halt', cycles: 1000 });
    expect(n.mem.read(0x5000, 1)[0]).toBe(0xff);
  });

  it('a reset clears the latch, and a Model I state carries it', () => {
    const m = model1([0xf3, 0x18, 0xfe]);
    m.run({ cycles: 50000 });
    const state = serializeState(m.system);
    expect(state.latch).toBe(0x80);
    const n = model1([0xf3, 0x18, 0xfe]);
    restoreState(n.system, state);
    expect(n.system.io.latch.bits).toBe(0x80);
    m.reset();
    expect(m.system.io.latch.bits).toBe(0);
    expect('latch' in serializeState(model3().system)).toBe(false); // a Model III state is as it was
  });
});

describe('the Model I video RAM', () => {
  // LD HL,3C00H / XOR A / loop: LD (HL),A / INC HL / INC A / JR NZ,loop / HALT
  const WRITE_ALL = [0x21, 0x00, 0x3c, 0xaf, 0x77, 0x23, 0x3c, 0x20, 0xfb, 0x76];
  const gate = (b) => (b & 0xbf) | (b & 0xa0 ? 0 : 0x40);

  it('has no bit 6: a byte reads back with bit 6 = NOT (bit 5 OR bit 7)', () => {
    const m = model1(WRITE_ALL);
    m.run({ until: 'halt', cycles: 100000 });
    for (let b = 0; b < 256; b++) expect(m.video.raw[b]).toBe(gate(b));
    expect(m.mem.read(0x3c00 + 0x01, 1)[0]).toBe(0x41); // $01 reads as "A"
    expect(m.mem.read(0x3c00 + 0x61, 1)[0]).toBe(0x21); // "a" reads as "!"
    expect(m.mem.read(0x3c00 + 0xc5, 1)[0]).toBe(0x85); // graphics lose bit 6
    m.mem.write(0x3c00, [0x7a]);
    expect(m.video.raw[0]).toBe(0x3a);
  });

  it('m.video.text() shows the gated bytes: a stored "a" shows as "!", and $01 as "A"', () => {
    const m = model1([0x76]);
    m.mem.write(0x3c00, [0x01, 0x61, 0x48, 0x49]);
    expect(m.video.text()[0].slice(0, 4)).toBe('A!HI');
  });

  it('the lowercase modification keeps all eight bits', () => {
    const m = model1(WRITE_ALL, {}, { lowercase: true });
    m.run({ until: 'halt', cycles: 100000 });
    for (let b = 0; b < 256; b++) expect(m.video.raw[b]).toBe(b);
    m.mem.write(0x3c00, [0x61, 0x62]);
    expect(m.video.text()[0].slice(0, 2)).toBe('ab');
  });

  it('the Model III keeps all eight bits, as before', () => {
    const m = model3();
    m.mem.write(0x3c00, [0x61, 0x01, 0xc5]);
    expect([...m.video.raw.subarray(0, 3)]).toEqual([0x61, 0x01, 0xc5]);
  });
});

describe('the Model I port $FF', () => {
  it('bits 0-1 are the cassette output and every write is in m.sound, raw and stamped', () => {
    // LD A,01H / OUT (FFH),A / LD A,02H / OUT (FFH),A / LD A,0CH / OUT (FFH),A / XOR A / OUT (FFH),A / HALT
    const m = model1([0x3e, 0x01, 0xd3, 0xff, 0x3e, 0x02, 0xd3, 0xff, 0x3e, 0x0c, 0xd3, 0xff, 0xaf, 0xd3, 0xff, 0x76]);
    m.run({ until: 'halt', cycles: 1000 });
    const ev = m.sound.events();
    expect(ev.map((e) => e.value)).toEqual([0x01, 0x02, 0x0c, 0x00]);
    expect(ev.map((e) => e.cycle)).toEqual([7, 25, 43, 58]); // each OUT's starting T-state
    expect(m.system.io.soundLog.map((e) => e.level)).toEqual([1, 2, 0]);
  });

  it('bit 2 runs the cassette motor relay', () => {
    const m = model1([0x76]);
    expect(m.cassette.motor).toBe(false);
    m.io.out(0xff, 0x04);
    expect(m.cassette.motor).toBe(true);
    m.io.out(0xff, 0x05);
    expect(m.cassette.motor).toBe(true);
    m.io.out(0xff, 0x00);
    expect(m.cassette.motor).toBe(false);
  });

  it('bit 3 (MODESEL) selects 32 columns, and a read shows it inverted in bit 6, bits 0-5 set', () => {
    const m = model1([0x76]);
    expect(m.video.columns).toBe(64);
    expect(m.io.in(0xff)).toBe(0x7f);
    m.io.out(0xff, 0x08);
    expect(m.video.columns).toBe(32);
    expect(m.io.in(0xff)).toBe(0x3f);
    m.mem.write(0x3c00, [0x48, 0x20, 0x49]);
    expect(m.video.text()[0].slice(0, 2)).toBe('HI');
    m.io.out(0xff, 0x00);
    expect(m.video.columns).toBe(64);
  });

  it('bit 7 reads the cassette flip-flop, set by the tape and reset by any write', () => {
    const m = model1([0x76]);
    m.cassette.insert(buildSystemCas([{ addr: 0x7000, data: [1, 2, 3] }], 0x7000));
    m.io.out(0xff, 0x04); // motor on
    expect(m.io.in(0xff) & 0x80).toBe(0);
    m.run({ cycles: 4000 }); // past the first pulse (a bit cell is 2 ms, 3,548 T-states here)
    expect(m.io.in(0xff) & 0x80).toBe(0x80);
    m.io.out(0xff, 0x04);
    expect(m.io.in(0xff) & 0x80).toBe(0);
  });

  it('the Model III ports stay absent and the Model III port $FF is unchanged', () => {
    const m = model1([0x76]);
    for (const port of [0xe0, 0xe4, 0xec, 0xf0, 0xf8]) expect(m.io.in(port)).toBe(0xff);
    expect(model3().io.in(0xff)).toBe(0x00);
  });
});

/**
 * A 500-baud reader at the Model I's clock, written after the Level II ROM's (MDL1LEV2.Z80:
 * CSRDON $0293, CASIN $0235, CTBIT $0241 in version 1.3, CTSTAT $021E): motor on, hunt for the
 * A5 sync one bit at a time, then read `count` bytes to $5000 and halt.
 */
function readerRom(count) {
  const CTBIT = 0x0100;
  const CASIN = 0x0140;
  const CTSTAT = 0x0160;
  const main = [
    0x31, 0x00, 0x80, // LD SP,8000H
    0x3e, 0x04, 0x32, 0x00, 0x5f, // LD A,04H / LD (5F00H),A   (the shadow copy of port FF, CAST)
    0xd3, 0xff, // OUT (FFH),A   (motor on)
    0xaf, // XOR A
    0xcd, CTBIT & 0xff, CTBIT >> 8, // hunt: CALL CTBIT
    0xfe, 0xa5, // CP A5H
    0x20, 0xf9, // JR NZ,hunt
    0x21, 0x00, 0x50, // LD HL,5000H
    0x06, count, // LD B,count
    0xcd, CASIN & 0xff, CASIN >> 8, // next: CALL CASIN
    0x77, // LD (HL),A
    0x23, // INC HL
    0x10, 0xf9, // DJNZ next
    0x76, // HALT
  ];
  const ctbit = [
    0xc5, 0xf5, // PUSH BC / PUSH AF
    0xdb, 0xff, 0x17, 0x30, 0xfb, // w: IN A,(FFH) / RLA / JR NC,w
    0x06, 0x60, 0x10, 0xfe, // LD B,60H / DJNZ $
    0xcd, CTSTAT & 0xff, CTSTAT >> 8, // CALL CTSTAT
    0x06, 0x85, 0x10, 0xfe, // LD B,85H / DJNZ $
    0xdb, 0xff, 0x47, // IN A,(FFH) / LD B,A
    0xf1, 0xcb, 0x10, 0x17, 0xf5, // POP AF / RL B / RLA / PUSH AF
    0xcd, CTSTAT & 0xff, CTSTAT >> 8, // CALL CTSTAT
    0xf1, 0xc1, 0xc9, // POP AF / POP BC / RET
  ];
  const casin = [0xc5, 0xe5, 0x06, 0x08, 0xcd, CTBIT & 0xff, CTBIT >> 8, 0x10, 0xfb, 0xe1, 0xc1, 0xc9];
  // LD HL,FF00H / LD A,(5F00H) / AND H / OR L / OUT (FFH),A / LD (5F00H),A / RET
  const ctstat = [0x21, 0x00, 0xff, 0x3a, 0x00, 0x5f, 0xa4, 0xb5, 0xd3, 0xff, 0x32, 0x00, 0x5f, 0xc9];
  return rom12(main, { [CTBIT]: ctbit, [CASIN]: casin, [CTSTAT]: ctstat });
}

/**
 * A 500-baud writer at the Model I's clock, written after the Level II ROM's (MDL1LEV2.Z80:
 * CASOUT $0264, CTPULS $01D9, CTCHG $0221): motor on, then each of `bytes` written as eight
 * clock pulses with a data pulse after each 1 bit; halts when done.
 */
function writerRom(bytes) {
  const main = [
    0x31, 0x00, 0x80, // LD SP,8000H
    0x3e, 0x04, 0x32, 0x00, 0x5f, // LD A,04H / LD (5F00H),A   (CAST)
    0xd3, 0xff, // OUT (FFH),A   (motor on)
    0x21, 0x00, 0x02, // LD HL,0200H
    0x06, bytes.length, // LD B,count
    0x7e, // loop: LD A,(HL)
    0xcd, 0x00, 0x01, // CALL CASOUT
    0x23, // INC HL
    0x10, 0xf9, // DJNZ loop
    0x76, // HALT
  ];
  const casout = [
    0xe5, 0xc5, 0xd5, 0xf5, // PUSH HL / PUSH BC / PUSH DE / PUSH AF
    0x0e, 0x08, 0x57, // LD C,8 / LD D,A
    0xcd, 0x40, 0x01, // 0107 BYT0: CALL CTPULS
    0x7a, 0x07, 0x57, // LD A,D / RLCA / LD D,A
    0x30, 0x0b, // JR NC,BYT2
    0xcd, 0x40, 0x01, // CALL CTPULS
    0x0d, 0x20, 0xf2, // 0112 BYT1: DEC C / JR NZ,BYT0
    0xf1, 0xd1, 0xc1, 0xe1, 0xc9, // POP AF / POP DE / POP BC / POP HL / RET
    0x06, 0x87, 0x10, 0xfe, 0x18, 0xf2, // 011A BYT2: LD B,87H / DJNZ $ / JR BYT1
  ];
  const ctpuls = [
    0x21, 0x01, 0xfc, 0xcd, 0x70, 0x01, 0x06, 0x0b, 0x10, 0xfe, // LD HL,FC01H / CALL CTCHG / LD B,0BH / DJNZ $
    0x21, 0x02, 0xfc, 0xcd, 0x70, 0x01, 0x06, 0x0b, 0x10, 0xfe, // LD HL,FC02H / CALL CTCHG / LD B,0BH / DJNZ $
    0x21, 0x00, 0xfc, 0xcd, 0x70, 0x01, 0x06, 0x5c, 0x10, 0xfe, // LD HL,FC00H / CALL CTCHG / LD B,5CH / DJNZ $
    0xc9, // RET
  ];
  // LD A,(5F00H) / AND H / OR L / OUT (FFH),A / LD (5F00H),A / RET
  const ctchg = [0x3a, 0x00, 0x5f, 0xa4, 0xb5, 0xd3, 0xff, 0x32, 0x00, 0x5f, 0xc9];
  return rom12(main, { 0x0100: casout, 0x0140: ctpuls, 0x0170: ctchg, 0x0200: bytes });
}

describe('the cassette deck at 500 baud on the Model I', () => {
  const PAYLOAD = [0x55, 0x48, 0x45, 0x4c, 0x4c, 0x4f, 0x00, 0xff, 0x3c, 0xa5, 0x12, 0x80, 0x01, 0x7e];

  it('the Level II bit reader, run at the Model I clock, reads the tape back byte for byte', () => {
    const m = model1([0x76]);
    m.system.memory.loadROM(readerRom(PAYLOAD.length));
    m.reset();
    m.cassette.insert(new Uint8Array([0x00, 0x00, 0xa5, ...PAYLOAD]), { baud: 500 });
    const r = m.run({ until: 'halt', cycles: 20 * HZ });
    expect(r.reason).toBe('halt');
    expect([...m.mem.read(0x5000, PAYLOAD.length)]).toEqual(PAYLOAD);
    // 256 leader and sync bytes and the payload, 16 ms a byte at most: well under 5 s of tape
    expect(m.cycles).toBeLessThan(5 * HZ);
  });

  it('1500 baud is refused on the Model I with a sentence, by the deck and by load.cas via the ROM', () => {
    const m = model1([0x76]);
    const cas = buildSystemCas([{ addr: 0x7000, data: [1] }], 0x7000);
    expect(() => m.cassette.insert(cas, { baud: 1500 })).toThrow(/^The Model I reads cassettes at 500 baud only \(1500 is the Model III's rate\), not 1500\.$/);
    expect(() => m.load.cas(cas, { baud: 1500 })).toThrow(/^The Model I reads cassettes at 500 baud only/);
    expect(m.load.cas(cas, { via: 'fast' }).via).toBe('fast');
  });

  it('a recording made at the Model I clock decodes: the Level II byte writer\'s pulses come back as bytes', () => {
    const m = model1([0x76]);
    m.system.memory.loadROM(writerRom([...new Array(32).fill(0x00), 0xa5, ...PAYLOAD]));
    m.reset();
    expect(m.run({ until: 'halt', cycles: 10 * HZ }).reason).toBe('halt');
    const { bytes, baud } = m.system.io.cassette.recordedCas();
    expect(baud).toBe(500);
    const at = bytes.indexOf(0xa5);
    expect(at).toBeGreaterThan(0);
    expect([...bytes.subarray(at + 1, at + 1 + PAYLOAD.length)]).toEqual(PAYLOAD);
    // the codec counts Model III T-states; the Model I's times are scaled to them
    expect(m.system.io.cassette.timeScale).toBeCloseTo(2027520 / HZ, 12);
    expect(model3().system.io.cassette.timeScale).toBe(1);
  });
});

describe('the keyboard on the Model I', () => {
  it('the matrix at $3800 is the Level II layout: rows select by address bits, SHIFT is row 7 bit 0', () => {
    const m = model1([0x76]);
    m.keyboard.press('A');
    expect(m.mem.read(0x3801, 1)[0]).toBe(0x02); // row 0: @ A B ... (KEYFND at $040B: row*8+col+$40)
    m.keyboard.release('A');
    m.keyboard.press('ENTER');
    expect(m.mem.read(0x3840, 1)[0]).toBe(0x01); // row 6 bit 0 (KEYTAB at $0050)
    m.keyboard.release('ENTER');
    m.keyboard.press('SHIFT');
    expect(m.mem.read(0x3880, 1)[0]).toBe(0x01); // the ROM tests bit 0 (RRC B at $0416)
  });

  it('matrix typing is timed at the Model I clock', () => {
    const m = model1([0x18, 0xfe]);
    m.keyboard.type('A', { cps: 10 });
    m.run({ cycles: 1000 });
    expect(m.mem.read(0x3801, 1)[0]).toBe(0x02);
    m.run({ cycles: Math.round(HZ / 20) }); // half of the 1/10 s window: released
    expect(m.mem.read(0x3801, 1)[0]).toBe(0x00);
  });

  it('the keyboard-scan hook stands in at $002B and $0049 on the Model I, as on the Model III (Ruling 6)', () => {
    // LD SP,8000H / LD BC,1234H / LD HL,5678H / CALL 0049H / LD (5000H),A / CALL 002BH / LD (5001H),A / HALT
    const main = [0x31, 0x00, 0x80, 0x01, 0x34, 0x12, 0x21, 0x78, 0x56, 0xcd, 0x49, 0x00, 0x32, 0x00, 0x50, 0xcd, 0x2b, 0x00, 0x32, 0x01, 0x50, 0x76];
    // At $002B and $0049, what runs when the hook does not stand in: XOR A / RET
    const m = model1(main, { 0x2b: [0xaf, 0xc9], 0x49: [0xaf, 0xc9] });
    m.keyboard.feed('Q\n');
    m.run({ until: 'halt', cycles: 1000 });
    expect([...m.mem.read(0x5000, 2)]).toEqual([0x51, 0x0d]);
    const r = m.cpu.regs;
    expect([r.b, r.c, r.h, r.l, r.d, r.e]).toEqual([0x12, 0x34, 0x56, 0x78, 0x40, 0x15]);
    expect(m.cpu.flags.z).toBe(false);
  });
});

describe('Task 2 review fixes', () => {
  // LD SP,8000H / DI / wait for (5100H) <> 0 / LD A,1 / LD (37E1H),A / LD A,(37E0H) / LD (5000H),A / HALT
  const WRITES_37E1 = [0x31, 0x00, 0x80, 0xf3, 0x3a, 0x00, 0x51, 0xb7, 0x28, 0xfa, 0x3e, 0x01, 0x32, 0xe1, 0x37, 0x3a, 0xe0, 0x37, 0x32, 0x00, 0x50, 0x76];
  const rom = (bytes) => rom12(bytes);

  it('a watched write to $37E1 leaves the clock bit: $37E0 still reads $80, and the hit\'s old value is the peeked latch', () => {
    const m = new Machine({ model: 1, roms: { level2: rom(WRITES_37E1) } });
    m.run({ cycles: 50000 }); // the 40 Hz clock has raised its bit (due at 44,352)
    const id = m.debug.watch(0x37e1, 1, { write: true });
    m.mem.write(0x5100, [1]);
    m.run({ until: 'halt', cycles: 10000 });
    expect(m.mem.read(0x5000, 1)[0]).toBe(TIMER_BIT);
    expect(m.debug.hits(id)).toMatchObject([{ kind: 'write', addr: 0x37e1, value: 1, prev: TIMER_BIT }]);
  });


  it('the debug memory view agrees with m.mem.read at $37E0-$37EF', () => {
    const m = new Machine({ model: 1, roms: { level2: rom([0xf3, 0x18, 0xfe]) } });
    m.run({ cycles: 50000 });
    const view = m.system.memory.getMemoryView();
    expect([...view.subarray(0x37e0, 0x37f0)]).toEqual([...m.mem.read(0x37e0, 16)]);
    expect(view[0x37e0]).toBe(m.system.io.latch.bits);
  });

  it('a Model I state restores only into a machine with the same Expansion Interface and lowercase fitting', () => {
    const level2 = rom([0xf3, 0x18, 0xfe]);
    const make = (opts) => new Machine({ model: 1, roms: { level2 }, ...opts });
    const fitted = make({}).debug.snapshot();
    const bare = make({ expansion: false }).debug.snapshot();
    const lower = make({ lowercase: true }).debug.snapshot();
    expect(() => make({ expansion: false }).debug.restore(fitted)).toThrow(
      'This Model I save state was saved with the Expansion Interface; the machine has none, and a state restores only into a machine fitted the same way (expansion: true).'
    );
    expect(() => make({}).debug.restore(bare)).toThrow(
      'This Model I save state was saved without the Expansion Interface; the machine has one, and a state restores only into a machine fitted the same way (expansion: false).'
    );
    expect(() => make({}).debug.restore(lower)).toThrow(
      'This Model I save state was saved with the lowercase modification; the machine has none, and a state restores only into a machine fitted the same way (lowercase: true).'
    );
    expect(() => make({ lowercase: true }).debug.restore(fitted)).toThrow(/saved without the lowercase modification; the machine has it/);
    for (const [opts, snap] of /** @type {const} */ ([[{}, fitted], [{ expansion: false }, bare], [{ lowercase: true }, lower]])) {
      expect(() => make(opts).debug.restore(snap)).not.toThrow();
    }
  });
});
