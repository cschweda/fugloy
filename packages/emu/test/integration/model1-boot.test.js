/**
 * Emu phase 6, Task 2, on the real Model I Level II ROM (roms.model1 in fugloy.mcp.json; skipped
 * without it): the ROM boots to MEMORY SIZE? (MEM SIZE? in version 1.3) and, answered, to READY;
 * matrix typing and the keyboard-scan hook both reach BASIC; MEM tracks the RAM fitted; the 40 Hz
 * clock waits in the latch while Level II runs with interrupts disabled, and a handler that reads
 * $37E0 takes 40 a second while BASIC goes on working; CHR$(23) sets MODESEL; and the cassette at
 * 500 baud through the ROM's own SYSTEM and CLOAD, and a CSAVE that decodes and loads back.
 */
import { describe, expect, it } from 'vitest';
import { Machine } from '../../src/index.js';
import { configuredRom, ROM_TEST_TIMEOUT } from '../rom.js';
import { buildBasicCas, buildSystemCas, T_PRINT } from '../unit/cas-builders.js';

const rom = configuredRom('model1');
const HZ = 1774080;

const screen = (m) => m.video.text().join('\n');

/** Runs in tenth-second slices until the screen shows `text`, or throws after `seconds`. */
function waitFor(m, text, seconds) {
  for (let t = 0; t < seconds * 10; t++) {
    if (screen(m).includes(text)) return;
    m.run({ cycles: HZ / 10 });
  }
  if (!screen(m).includes(text)) throw new Error(`no "${text}" within ${seconds} s:\n${screen(m)}`);
}

/** Type a line through the matrix and give BASIC time to run it. */
function typeLine(m, line, seconds = 1) {
  m.keyboard.type(`${line}\n`);
  m.run({ cycles: Math.round(HZ * (0.1 * (line.length + 1) + seconds)) });
}

/** A Model I at READY: MEMORY SIZE? answered with `memSize` (ENTER for all of it). */
function bootToReady(opts = {}, memSize = '') {
  const m = new Machine({ model: 1, roms: { level2: rom }, ...opts });
  waitFor(m, 'SIZE?', 1);
  m.keyboard.type(`${memSize}\n`);
  waitFor(m, 'READY', 5);
  m.run({ cycles: HZ / 10 });
  return m;
}

/** The value BASIC printed on the line after `command`. */
function printed(m, command) {
  const lines = m.video.text();
  const i = lines.findLastIndex((l) => l.startsWith(`>${command}`));
  return lines[i + 1].trim();
}

describe.skipIf(rom === null)('the Model I Level II ROM', { timeout: ROM_TEST_TIMEOUT }, () => {
  it('boots to MEMORY SIZE?, and with it answered to READY', () => {
    const m = new Machine({ model: 1, roms: { level2: rom } });
    waitFor(m, 'SIZE?', 1);
    expect(m.video.text()[0]).toMatch(/^MEM(ORY)? SIZE\? _/);
    m.keyboard.type('\n');
    waitFor(m, 'READY', 5);
    const lines = m.video.text();
    expect(lines[1]).toMatch(/^(R\/S L2 BASIC|RADIO SHACK LEVEL II BASIC) *$/);
    expect(lines[2]).toMatch(/^READY *$/);
    expect(lines[3]).toMatch(/^>_ *$/);
  });

  it('matrix typing and the keyboard-scan hook both reach BASIC (the hook stands in on the Model I)', () => {
    const m = bootToReady();
    typeLine(m, 'PRINT 6*7');
    expect(printed(m, 'PRINT 6*7')).toBe('42');
    m.keyboard.feed('PRINT 2+2\n');
    m.run({ cycles: HZ / 2 });
    expect(printed(m, 'PRINT 2+2')).toBe('4');
    expect(m.keyboard.pending).toBe(0);
  });

  it('MEM grows by 16K from 16K to 32K to 48K, and 4K boots', () => {
    const free = [16, 32, 48].map((ram) => {
      const m = bootToReady({ ram });
      m.keyboard.feed('PRINT MEM\n');
      m.run({ cycles: HZ / 2 });
      return Number(printed(m, 'PRINT MEM'));
    });
    expect(free[1] - free[0]).toBe(16384);
    expect(free[2] - free[1]).toBe(16384);
    const small = bootToReady({ ram: 4 });
    small.keyboard.feed('PRINT MEM\n');
    small.run({ cycles: HZ / 2 });
    expect(Number(printed(small, 'PRINT MEM'))).toBe(free[0] - 12288);
  });

  it('Level II runs with interrupts disabled: the clock waits in the latch at $37E0', () => {
    const m = bootToReady();
    expect(m.cpu.regs.iff1).toBe(false);
    expect(m.mem.read(0x37e0, 1)[0]).toBe(0x80);
    expect(m.mem.read(0x4012, 3)[0]).toBe(0xfb); // the interrupt vector is EI / RET
  });

  it('a handler that reads $37E0 takes 40 interrupts a second, and BASIC keeps working', () => {
    const m = bootToReady({}, '32000');
    // At $7F00: PUSH AF / PUSH HL / LD A,(37E0H) / LD HL,(7FF0H) / INC HL / LD (7FF0H),HL / POP HL / POP AF / EI / RET
    m.mem.write(0x7f00, [0xf5, 0xe5, 0x3a, 0xe0, 0x37, 0x2a, 0xf0, 0x7f, 0x23, 0x22, 0xf0, 0x7f, 0xe1, 0xf1, 0xfb, 0xc9]);
    m.mem.write(0x7f80, [0xfb, 0xc9]); // EI / RET, called by USR
    m.mem.write(0x4012, [0xc3, 0x00, 0x7f]); // the RST 38H vector: JP 7F00H
    m.keyboard.feed('POKE 16526,128:POKE 16527,127:X=USR(0)\n');
    m.run({ cycles: HZ / 2 });
    const count = () => m.mem.read(0x7ff0, 1)[0] | (m.mem.read(0x7ff1, 1)[0] << 8);
    const before = count();
    m.run({ cycles: 2 * HZ });
    expect(count() - before).toBeGreaterThanOrEqual(79);
    expect(count() - before).toBeLessThanOrEqual(81);
    typeLine(m, 'PRINT 6*7');
    expect(printed(m, 'PRINT 6*7')).toBe('42');
  });

  it('CHR$(23) sets MODESEL (port $FF bit 3) for 32 columns, and CLS clears it', () => {
    const m = bootToReady();
    m.keyboard.feed('PRINT CHR$(23);"WIDE"\n');
    m.run({ cycles: HZ / 2 });
    expect(m.video.columns).toBe(32);
    expect(m.io.in(0xff) & 0x40).toBe(0);
    expect(screen(m)).toContain('WIDE');
    m.keyboard.feed('CLS\n');
    m.run({ cycles: HZ / 2 });
    expect(m.video.columns).toBe(64);
  });

  // LD A,'O' / LD ($3C00),A / LD A,'K' / LD ($3C01),A / JR $
  const PROGRAM = [0x3e, 0x4f, 0x32, 0x00, 0x3c, 0x3e, 0x4b, 0x32, 0x01, 0x3c, 0x18, 0xfe];

  it('a SYSTEM tape at 500 baud loads through SYSTEM, *?, the name, and /, then runs', () => {
    const m = bootToReady();
    m.load.cas(buildSystemCas([{ addr: 0x7000, data: PROGRAM }], 0x7000, { name: 'HELLO' }), { baud: 500 });
    m.keyboard.feed('SYSTEM\n');
    m.run({ cycles: HZ / 2 });
    expect(screen(m)).toMatch(/\*\?/);
    m.keyboard.feed('HELLO\n');
    m.run({ until: (x) => x.cassette.motor, cycles: HZ });
    m.run({ until: (x) => !x.cassette.motor, cycles: 15 * HZ });
    expect([...m.mem.read(0x7000, PROGRAM.length)]).toEqual(PROGRAM); // the ROM read the tape
    m.run({ cycles: HZ / 2 });
    expect(screen(m).match(/\*\?/g)?.length).toBe(2); // asks again, for the / that runs it
    m.keyboard.feed('/\n');
    m.run({ cycles: HZ / 2 });
    expect(m.cpu.regs.pc).toBe(0x700a);
    expect(screen(m).startsWith('OK')).toBe(true);
  });

  it('a BASIC tape at 500 baud loads through CLOAD, then RUN shows its output', () => {
    const m = bootToReady();
    // 10 PRINT "FROM TAPE"
    const tokens = [T_PRINT, 0x20, 0x22, ...[...'FROM TAPE'].map((c) => c.charCodeAt(0)), 0x22];
    m.load.cas(buildBasicCas([{ lineNo: 10, tokens }], { name: 'A' }), { baud: 500 });
    m.keyboard.feed('CLOAD\n');
    m.run({ until: (x) => x.cassette.motor, cycles: HZ });
    m.run({ until: (x) => !x.cassette.motor, cycles: 15 * HZ });
    m.run({ cycles: HZ / 2 });
    m.keyboard.feed('RUN\n');
    m.run({ cycles: HZ / 2 });
    expect(screen(m)).toContain('FROM TAPE');
  });

  it('CSAVE records a tape that decodes and that CLOAD reads back into another Model I', () => {
    const m = bootToReady();
    m.keyboard.feed('10 PRINT "SAVED ON A MODEL I"\nCSAVE "B"\n');
    m.run({ until: (x) => x.cassette.motor, cycles: HZ });
    m.run({ until: (x) => !x.cassette.motor, cycles: 15 * HZ });
    const { bytes, baud } = m.system.io.cassette.recordedCas();
    expect(baud).toBe(500);
    expect(bytes.includes(0xa5)).toBe(true);

    const n = bootToReady();
    n.load.cas(bytes, { baud: 500 });
    n.keyboard.feed('CLOAD\n');
    n.run({ until: (x) => x.cassette.motor, cycles: HZ });
    n.run({ until: (x) => !x.cassette.motor, cycles: 15 * HZ });
    n.run({ cycles: HZ / 2 });
    n.keyboard.feed('RUN\n');
    n.run({ cycles: HZ / 2 });
    expect(screen(n)).toContain('SAVED ON A MODEL I');
  });
});
