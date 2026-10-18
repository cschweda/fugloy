/** m.load.bas on the Model III ROM at the BASIC prompt: a tokenized program is written and runs; ASCII source is fed and runs. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Machine } from '../../src/index.js';
import { configuredRom, ROM_TEST_TIMEOUT } from '../rom.js';

const rom = configuredRom('model3');
const fixture = (n) => new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../../fixtures/synthetic/bas/${n}`, import.meta.url))));
const PROG = new Uint8Array([0xff, 0x0a, 0x70, 0x0a, 0x00, 0xb2, 0x22, 0x48, 0x49, 0x22, 0x00, 0x10, 0x70, 0x14, 0x00, 0x80, 0x00, 0x00, 0x00]);

function atReady() {
  const m = new Machine({ roms: { level2: rom } });
  expect(m.system.bootToCassetteBasic()).toBe(true);
  return m;
}

function settle(m, budget = 40_000_000) {
  const start = m.cycles;
  m.run({ until: (mm) => (mm.keyboard.pending === 0 && mm.cpu.regs.pc === 0x0049) || mm.cycles - start > budget });
  if (m.keyboard.pending !== 0 || m.cpu.regs.pc !== 0x0049) throw new Error(`did not settle:\n${m.video.text().join('\n')}`);
}

const screen = (m) => m.video.text().map((l) => l.trimEnd());

describe.skipIf(rom === null)('m.load.bas on the Model III ROM', { timeout: ROM_TEST_TIMEOUT }, () => {
  it('a tokenized program loads at TXTTAB, runs, and lists', () => {
    const m = atReady();
    const txttab = m.mem.read(0x40a4, 2).reduce((lo, hi, i) => (i ? lo | (hi << 8) : hi));
    const manifest = m.load.bas(PROG);
    expect(manifest).toEqual({ format: 'bas', kind: 'tokenized', start: txttab, end: txttab + 18, blocks: [{ addr: txttab, len: 18, why: 'BASIC program' }] });
    expect(m.mem.read(0x40f9, 2)).toEqual(new Uint8Array([(txttab + 18) & 0xff, (txttab + 18) >> 8]));
    m.keyboard.feed('LIST\n');
    settle(m);
    expect(screen(m)).toContain('10 PRINT"HI"');
    expect(screen(m)).toContain('20 END');
    m.keyboard.feed('RUN\n');
    settle(m);
    const lines = screen(m);
    expect(lines[lines.lastIndexOf('>RUN') + 1]).toBe('HI');
  });

  it('a synthetic fixture loads and lists its first line', () => {
    const m = atReady();
    const manifest = m.load.bas(fixture('prog-7000.bas'));
    expect(manifest.end).toBeGreaterThan(manifest.start);
    m.keyboard.feed('LIST 10\n');
    settle(m);
    expect(screen(m).join('\n')).toContain('VOYAGE OF THE VALKYRIE');
  });

  it('ASCII source is fed through the keyboard hook, then runs and lists', () => {
    const m = atReady();
    const manifest = m.load.bas(new TextEncoder().encode('10 PRINT "HELLO"\r\n20 END\r\n'));
    expect(manifest).toEqual({ format: 'bas', kind: 'ascii', start: m.mem.read(0x40a4, 1)[0] | (m.mem.read(0x40a5, 1)[0] << 8), end: null, blocks: [] });
    m.keyboard.feed('LIST\n');
    settle(m);
    expect(screen(m)).toContain('10 PRINT "HELLO"');
    expect(screen(m)).toContain('20 END');
    m.keyboard.feed('RUN\n');
    settle(m);
    const lines = screen(m);
    expect(lines[lines.lastIndexOf('>RUN') + 1]).toBe('HELLO');
  });
});
