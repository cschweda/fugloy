import { describe, expect, it } from 'vitest';
import { cap } from '../src/format/cap.js';
import { hexDump } from '../src/format/hex.js';
import { regsBlock, regsJson } from '../src/format/regs.js';
import { screenDiff, screenText } from '../src/format/screen.js';
import { traceLines } from '../src/format/trace.js';

const labels = new Map([
  [0x5210, { addr: 0x5210, name: 'CLS' }],
  [0x5212, { addr: 0x5212, name: 'INNER' }],
]);

describe('hexDump', () => {
  it('prints 16 per line with a gap after 8, an ASCII gutter, and labels on their own line', () => {
    const bytes = new Uint8Array([
      0x21, 0x00, 0x3c, 0x11, 0x01, 0x3c, 0x01, 0xff, 0x03, 0x36, 0x20, 0xed, 0xb0, 0xc9, 0x00, 0x00,
      0x3e, 0x0d, 0xcd, 0x33, 0x00, 0xc9,
    ]);
    expect(hexDump(bytes, 0x5200, labels)).toBe(
      [
        '5200  21 00 3C 11 01 3C 01 FF  03 36 20 ED B0 C9 00 00  !.<..<...6 .....',
        '      ; CLS',
        '      ; INNER',
        '5210  3E 0D CD 33 00 C9                                 >..3..',
      ].join('\n'),
    );
  });

  it('works without labels and for an empty range', () => {
    expect(hexDump(new Uint8Array([0x41]), 0x10, new Map())).toBe('0010  41                                                A');
    expect(hexDump(new Uint8Array(0), 0, new Map())).toBe('');
  });
});

describe('regsBlock', () => {
  const regs = {
    pc: 0x5214, sp: 0xff00, a: 0x0d, f: 0x44, b: 0x03, c: 0xff, d: 0x3c, e: 0x01, h: 0x3c, l: 0x00, ix: 0, iy: 0,
    a2: 0, f2: 0, b2: 0, c2: 0, d2: 0, e2: 0, h2: 0, l2: 0, i: 0, r: 0x2a, iff1: false, iff2: false, im: 1,
  };
  const flags = { s: 0, z: 1, h: 0, pv: 1, n: 0, c: 0 };

  it('prints the three-line block of MCP spec section 4', () => {
    expect(regsBlock(regs, flags, 48201339)).toBe(
      [
        'PC 5214  SP FF00  AF 0D44  BC 03FF  DE 3C01  HL 3C00  IX 0000  IY 0000',
        "AF' 0000 BC' 0000 DE' 0000 HL' 0000  I 00  R 2A  IFF1 0  IFF2 0  IM 1",
        'Flags: S0 Z1 H0 PV1 N0 C0     Cycles: 48,201,339',
      ].join('\n'),
    );
  });

  it('regsJson carries the same facts as numbers', () => {
    const json = JSON.parse(regsJson(regs, flags, 48201339));
    expect(json).toMatchObject({ pc: 0x5214, sp: 0xff00, af: 0x0d44, bc: 0x03ff, hl: 0x3c00, r: 0x2a, iff1: 0, im: 1, cycles: 48201339 });
    expect(json.flags).toEqual({ s: 0, z: 1, h: 0, pv: 1, n: 0, c: 0 });
  });
});

describe('screen', () => {
  const ramOf = (rows) => {
    const ram = new Uint8Array(1024).fill(0x20);
    rows.forEach((text, r) => [...text].forEach((ch, c) => (ram[r * 64 + c] = typeof ch === 'string' ? ch.charCodeAt(0) : ch)));
    return ram;
  };

  it('screenText fences the screen under a two-line ruler and shows graphics as dots', () => {
    const ram = ramOf(['READY', '>_']);
    ram[128] = 0x61; // a
    ram[129] = 0x01; // folds to $41, A
    ram[130] = 0x80; // graphics
    ram[131] = 0xff;
    const out = screenText(ram).split('\n');
    expect(out).toHaveLength(2 + 16 + 2);
    expect(out[0]).toBe('```');
    expect(out[1]).toBe(`${' '.repeat(10)}${'1'.repeat(10)}${'2'.repeat(10)}${'3'.repeat(10)}${'4'.repeat(10)}${'5'.repeat(10)}${'6'.repeat(4)}`);
    expect(out[2]).toBe('0123456789012345678901234567890123456789012345678901234567890123');
    expect(out[3]).toBe('READY'.padEnd(64));
    expect(out[5]).toBe('aA··'.padEnd(64));
    expect(out.at(-1)).toBe('```');
  });

  it('screenText shows the even columns in 32-column mode', () => {
    const ram = new Uint8Array(1024).fill(0x20);
    ram[0] = 0x41;
    ram[1] = 0x5a; // an odd column: hidden
    ram[2] = 0x42;
    const out = screenText(ram, true).split('\n');
    expect(out[2]).toBe('01234567890123456789012345678901');
    expect(out[3]).toBe('AB'.padEnd(32));
  });

  it('screenDiff counts screen cells in 32-column mode', () => {
    const before = new Uint8Array(1024).fill(0x20);
    const after = before.slice();
    after[1] = 0x41; // odd: not shown
    after[64 + 6] = 0x42; // row 1, screen column 3
    expect(screenDiff(before, after, true)).toBe(["1 cell changed", "(1,3) ' '→'B'"].join('\n'));
  });

  it('screenText and screenDiff take a Model 4 geometry: 80 by 24, 40 columns, inverse video, and off-screen bytes', () => {
    const ram = new Uint8Array(2048).fill(0x20);
    ram[80] = 0x41; // row 1, column 0 at 80 bytes a row
    ram[81] = 0xc2; // B with bit 7: a graphics block, or B with inverse video
    const wide = screenText(ram, { width: 80, rows: 24, step: 1 }).split('\n');
    expect(wide).toHaveLength(2 + 24 + 2);
    expect(wide[2]).toBe('0123456789'.repeat(8));
    expect(wide[4]).toBe('A·'.padEnd(80));
    expect(screenText(ram, { width: 80, rows: 24, step: 1, inverse: true }).split('\n')[4]).toBe('AB'.padEnd(80));
    expect(screenText(ram, { width: 80, rows: 24, step: 2 }).split('\n')[4]).toBe('A'.padEnd(40));
    const after = ram.slice();
    after[80 * 23 + 79] = 0x5a; // the last cell
    after[1920] = 0x01; // past 80 by 24
    after[2047] = 0x01;
    expect(screenDiff(ram, after, { width: 80, rows: 24, step: 1 })).toBe(["1 cell changed", "(23,79) ' '→'Z'", '(2 bytes of video RAM off screen also changed, at offsets 1920–2047; not shown)'].join('\n'));
    // At 64 by 16 the second 1K is off screen.
    const low = ram.slice();
    low[1024] = 0x41;
    expect(screenDiff(ram, low)).toBe('0 cells changed\n(1 byte of video RAM off screen also changed, at offsets 1024–2047; not shown)');
  });

  it('screenDiff lists changed cells under a count line', () => {
    const before = new Uint8Array(1024).fill(0x20);
    const after = before.slice();
    after[0] = 0x41;
    after[64 * 15 + 3] = 0x01;
    expect(screenDiff(before, after)).toBe(["2 cells changed", "(0,0) ' '→'A'", "(15,3) ' '→$01"].join('\n'));
    expect(screenDiff(before, before)).toBe('0 cells changed');
    after.fill(0x20);
    after[5] = 0x42;
    expect(screenDiff(before, after)).toBe(["1 cell changed", "(0,5) ' '→'B'"].join('\n'));
  });
});

describe('traceLines', () => {
  const entry = (pc, bytes, cycles) => ({ pc, bytes, cycles });

  it('prints PC, bytes, mnemonic, label, and cycles', () => {
    const out = traceLines([entry(0x5210, [0x21, 0x00, 0x3c], 10), entry(0x5213, [0xc9], 10)], labels);
    expect(out).toBe(
      [
        '5210  21 00 3C     LD HL,3C00H       ; CLS  [10]',
        '5213  C9           RET               [10]',
      ].join('\n'),
    );
  });

  it('shows collapsed loops once with the repeat count and the address span', () => {
    const loop = [entry(0x5214, [0x2b], 6), entry(0x5215, [0x7c], 4), entry(0x5216, [0x20, 0xfc], 12)];
    const out = traceLines([{ entries: loop, repeat: 212 }, { entries: [entry(0x5218, [0xc9], 10)], repeat: 1 }], new Map());
    expect(out.split('\n')).toEqual([
      '5214  2B           DEC HL            [6]',
      '5215  7C           LD A,H            [4]',
      '5216  20 FC        JR NZ,5214H       [12]',
      '  ×212 (5214h–5216h)',
      '5218  C9           RET               [10]',
    ]);
  });

  it('appends registers when an entry carries them', () => {
    const out = traceLines([{ pc: 0, bytes: [0], cycles: 4, regs: { a: 1, f: 2, b: 0, c: 3, d: 0, e: 4, h: 0, l: 5, sp: 0xff00 } }], new Map());
    expect(out).toBe('0000  00           NOP               [4]  A=01 F=02 BC=0003 DE=0004 HL=0005 SP=FF00');
  });
});

describe('cap', () => {
  const text = Array.from({ length: 10 }, (_, k) => `line ${k}`).join('\n');

  it('returns text that fits unchanged', () => {
    expect(cap(text, { limit: 1000 })).toBe(text);
  });

  it('cuts at a line boundary and says how to continue', () => {
    const out = cap(text, { limit: 50 });
    const lines = out.split('\n');
    expect(lines.at(-1)).toMatch(/^… \(\d+ more lines?; use offset=\d+\)$/);
    expect(Buffer.byteLength(out)).toBeLessThanOrEqual(50);
    expect(lines[0]).toBe('line 0');
  });

  it('cap also cuts at a page of lines, after the heading lines', () => {
    const t = ['head', 'a', 'b', 'c', 'd', 'e'].join('\n');
    const page = { lines: 2, heading: 1 };
    expect(cap(t, { limit: 1000, page })).toBe('head\na\nb\n… (3 more lines; use offset=3)');
    expect(cap(t, { limit: 1000, offset: 3, page })).toBe('c\nd\n… (1 more line; use offset=5)');
    expect(cap(t, { limit: 1000, offset: 5, page })).toBe('e');
    expect(cap('head\na\nb', { limit: 1000, page })).toBe('head\na\nb');
    // The byte cap still applies inside a page.
    expect(cap(t, { limit: 40, page })).toBe('head\na\n… (4 more lines; use offset=2)');
  });

  it('says "1 more line" in the singular', () => {
    expect(cap(`a\nb\n${'c'.repeat(60)}`, { limit: 60 })).toBe('a\nb\n… (1 more line; use offset=2)');
  });

  it('cap pages by offset', () => {
    const seen = [];
    let offset = 0;
    for (let guard = 0; guard < 20; guard++) {
      const out = cap(text, { limit: 60, offset });
      const lines = out.split('\n');
      const m = /^… \((\d+) more lines?; use offset=(\d+)\)$/.exec(lines.at(-1));
      seen.push(...(m ? lines.slice(0, -1) : lines));
      if (!m) break;
      offset = Number(m[2]);
    }
    expect(seen).toEqual(text.split('\n'));
    expect(cap(text, { limit: 60, offset: 99 })).toBe('… (no lines at offset=99; the output has 10 lines)');
  });
});
