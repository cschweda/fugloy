import { describe, expect, it } from 'vitest';
import { isBas, loadBas } from '../src/bas.js';
import { BAS_FIXTURES, CMD_FIXTURES, SIX_LINES } from './fixtures.js';
import { writeBasic } from './writers/basic-tokenizer.js';

const fx = (name: string) => loadBas(BAS_FIXTURES[name]!());

describe('.BAS loader', () => {
  it('detokenizes the same program identically from two base addresses', () => {
    const a = fx('prog-62c8');
    const b = fx('prog-7000');
    expect(a.format).toBe('bas');
    expect(a.base).toBe(0x62c8);
    expect(b.base).toBe(0x7000);
    expect(a.header).toBe(true);
    expect(a.lines.map((l) => l.number)).toEqual(SIX_LINES.map((l) => l.number));
    expect(a.lines.map((l) => l.text)).toEqual(SIX_LINES.map((l) => l.text));
    expect(b.lines.map((l) => l.text)).toEqual(a.lines.map((l) => l.text));
    expect(a.lines.every((l) => l.parsed)).toBe(true);
    expect(a.warnings).toEqual([]);
  });

  it('places each line at its pointer: line N starts at ptr(N-1), its body at +4', () => {
    const bytes = BAS_FIXTURES['prog-62c8']!();
    const p = fx('prog-62c8');
    expect(p.lines[0]!.addr).toBe(0x62c8);
    expect(p.lines[0]!.offset).toBe(1);
    for (let i = 1; i < p.lines.length; i++) {
      const prev = p.lines[i - 1]!;
      const ptr = bytes[prev.offset]! | (bytes[prev.offset + 1]! << 8);
      expect(p.lines[i]!.addr).toBe(ptr);
      expect(p.lines[i]!.bodyAddr).toBe(ptr + 4);
      expect(p.lines[i]!.offset).toBe(prev.offset + prev.length);
    }
    const last = p.lines.at(-1)!;
    expect(p.end).toBe(last.addr + last.length);
    expect(p.trailing).toBe(0);
  });

  it('loads the program bytes into the image at the base address', () => {
    const bytes = BAS_FIXTURES['prog-7000']!();
    const p = fx('prog-7000');
    const programBytes = Array.from(bytes.subarray(1));
    expect(Array.from(p.image.bytes.subarray(0x7000, 0x7000 + programBytes.length))).toEqual(programBytes);
    expect(p.image.runs()).toEqual([{ start: 0x7000, end: 0x7000 + programBytes.length - 1, length: programBytes.length }]);
    expect(p.image.isLoaded(0x7000 + programBytes.length)).toBe(false);
  });

  it('accepts a file without the FF header', () => {
    const p = fx('no-header');
    expect(p.header).toBe(false);
    expect(p.base).toBe(0x6500);
    expect(p.lines.map((l) => l.text)).toEqual(SIX_LINES.slice(0, 2).map((l) => l.text));
  });

  it('follows the pointer chain through a hidden-code line and reports it unparsed with address and length', () => {
    const p = fx('hidden-code');
    expect(p.lines.map((l) => l.number)).toEqual([10, 20, 30]);
    expect(p.lines.map((l) => l.parsed)).toEqual([true, false, true]);
    const hidden = p.lines[1]!;
    expect(hidden.addr).toBe(0x7000 + 4 + 4 + 1); // GOTO 30 tokenizes to 4 body bytes
    expect(hidden.bodyAddr).toBe(hidden.addr + 4);
    expect(hidden.length).toBe(4 + 6 + 1);
    expect(Array.from(hidden.body)).toEqual([0xc3, 0x00, 0x00, 0xc9, 0x00, 0x3e, 0x00]);
    expect(hidden.reason).toBe('embedded 00 at +1');
    expect(p.lines[2]!.text).toBe('END');
  });

  it('reports a line with an invalid token or a control byte as unparsed', () => {
    expect(fx('bad-token').lines[1]).toMatchObject({ number: 20, parsed: false, reason: 'invalid token FCH at +1' });
    expect(fx('control-byte').lines[1]).toMatchObject({ number: 20, parsed: false, reason: 'control byte 01H at +0' });
    expect(fx('bad-token').lines.map((l) => l.parsed)).toEqual([true, false, true]);
    expect(fx('bad-token').lines[2]).toMatchObject({ parsed: true, text: 'END' });
  });

  it('counts bytes after the 00 00 terminator as trailing and warns', () => {
    const p = fx('trailing-bytes');
    expect(p.lines.length).toBe(2);
    expect(p.trailing).toBe(3);
    expect(p.warnings).toEqual(['3 bytes after the program end ignored']);
  });
});

describe('isBas', () => {
  it('accepts every synthetic BASIC fixture', () => {
    for (const [name, make] of Object.entries(BAS_FIXTURES)) expect(isBas(make()), name).toBe(true);
  });

  it('rejects .CMD fixtures, text, an empty buffer, and a broken chain', () => {
    for (const [name, make] of Object.entries(CMD_FIXTURES)) expect(isBas(make()), name).toBe(false);
    expect(isBas(Uint8Array.from('10 PRINT "HELLO"', (c) => c.charCodeAt(0)))).toBe(false);
    expect(isBas(new Uint8Array())).toBe(false);
    expect(isBas(Uint8Array.from([0xff, 0x00, 0x00]))).toBe(false);
    const broken = BAS_FIXTURES['prog-7000']!().slice();
    broken[2] = 0x90; // first pointer now points outside the file
    expect(isBas(broken)).toBe(false);
  });

  it('accepts a one-line program but rejects a chain that covers less than half the file', () => {
    expect(isBas(writeBasic([{ number: 10, text: 'PRINT"HI"' }], 0x7000))).toBe(true);
    const debris = writeBasic([{ number: 10, text: 'CLS' }, { number: 20, text: 'END' }], 0x7000, { trailing: new Array(100).fill(0xaa) });
    expect(isBas(debris)).toBe(false);
    expect(isBas(writeBasic([{ number: 10, text: 'CLS' }, { number: 20, text: 'END' }], 0x7000, { trailing: [0xaa, 0x55] }))).toBe(true);
  });

  it('requires line 1 to be BASIC, because execution starts there', () => {
    expect(isBas(writeBasic([{ number: 1, raw: [0x01, 0x41] }, { number: 2, text: 'END' }], 0x7000))).toBe(false);
    // Would validate as a one-line program if a later 00 were tried as the end of line 1.
    expect(isBas(Uint8Array.from([0xff, 0x0c, 0x70, 0x0a, 0x00, 0x01, 0x02, 0x00, 0x00, 0x00]))).toBe(false);
  });
});
