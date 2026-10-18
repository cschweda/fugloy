/**
 * m.keyboard on the Model III ROM from fugloy.mcp.json, at the BASIC prompt: typing through the
 * matrix and feeding the ROM keyboard-scan hook both enter a line exactly once, and the hook
 * returns from $0049 and $002B in the same register state the ROM itself leaves.
 */
import { describe, expect, it } from 'vitest';
import { Machine } from '../../src/index.js';
import { configuredRom, ROM_TEST_TIMEOUT } from '../rom.js';

const rom = configuredRom('model3');

/** A Machine at READY (cassette BASIC). */
function atReady() {
  const m = new Machine({ roms: { level2: rom } });
  expect(m.system.bootToCassetteBasic()).toBe(true);
  return m;
}

/** Runs until the queue is empty and the ROM is back waiting for a key at $0049, or throws. */
function settle(m, budget = 20_000_000) {
  const start = m.cycles;
  m.run({ until: (mm) => (mm.keyboard.pending === 0 && mm.cpu.regs.pc === 0x0049) || mm.cycles - start > budget });
  if (m.keyboard.pending !== 0 || m.cpu.regs.pc !== 0x0049) throw new Error(`did not settle:\n${m.video.text().join('\n')}`);
}

/** The screen lines after the last prompt line `>cmd`, up to the next READY. */
function after(m, cmd) {
  const lines = m.video.text().map((l) => l.trimEnd());
  const at = lines.lastIndexOf(`>${cmd}`);
  expect(at).toBeGreaterThanOrEqual(0);
  return lines.slice(at + 1, lines.indexOf('READY', at + 1));
}

const SNAP = (m) => {
  const r = m.cpu.regs;
  return { a: r.a, f: r.f, b: r.b, c: r.c, d: r.d, e: r.e, h: r.h, l: r.l, ix: r.ix, iy: r.iy, sp: r.sp, pc: r.pc };
};

describe.skipIf(rom === null)('m.keyboard on the Model III ROM', { timeout: ROM_TEST_TIMEOUT }, () => {
  it("type('PRINT 12+30\\n') through the matrix prints 42 once", () => {
    const m = atReady();
    m.keyboard.type('PRINT 12+30\n');
    settle(m);
    expect(after(m, 'PRINT 12+30')).toEqual([' 42']);
  });

  it("feed('PRINT \"AB\"\\n') through the hook prints AB, in order and once", () => {
    const m = atReady();
    m.keyboard.feed('PRINT "AB"\n');
    settle(m);
    expect(after(m, 'PRINT "AB"')).toEqual(['AB']);
  });

  it.each(['matrix', 'hook'])('a repeated letter types twice in %s mode', (mode) => {
    const m = atReady();
    m.keyboard.type('PRINT "AA"\n', { mode });
    settle(m);
    expect(after(m, 'PRINT "AA"')).toEqual(['AA']);
  });

  it('two lines fed at once both run', () => {
    const m = atReady();
    m.keyboard.feed('10 PRINT "HI"\nRUN\n');
    settle(m);
    expect(after(m, 'RUN')).toEqual(['HI']);
  });

  it('returns from $0049 in the state the ROM leaves for the same key', () => {
    // The ROM's own path: hold P on the matrix until KEYIN's CALL 0049H returns to $05E3.
    const viaRom = atReady();
    viaRom.keyboard.press('P');
    viaRom.run({ cycles: 2_000_000, until: (mm) => mm.cpu.regs.pc === 0x05e3 });
    const hooked = atReady();
    hooked.keyboard.feed('P');
    hooked.run({ cycles: 2_000_000, until: (mm) => mm.cpu.regs.pc === 0x05e3 });
    expect(SNAP(viaRom).pc).toBe(0x05e3);
    expect(SNAP(hooked)).toEqual(SNAP(viaRom));
  });

  it('returns from $002B in the state the ROM leaves for the same key', () => {
    // Inside $0049's loop, CALL 002BH returns to $004C. The hook is fed only once the ROM is at
    // $002B, so it intercepts there and not at $0049.
    const viaRom = atReady();
    viaRom.keyboard.press('P');
    viaRom.run({ cycles: 2_000_000, until: (mm) => mm.cpu.regs.pc === 0x004c && mm.cpu.regs.a !== 0 });
    const hooked = atReady();
    hooked.run({ cycles: 2_000_000, until: (mm) => mm.cpu.regs.pc === 0x002b });
    hooked.keyboard.feed('P');
    hooked.run({ cycles: 2_000_000, until: (mm) => mm.cpu.regs.pc === 0x004c });
    expect(SNAP(viaRom).pc).toBe(0x004c);
    expect(SNAP(hooked)).toEqual(SNAP(viaRom));
  });
});
