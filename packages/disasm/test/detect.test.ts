import { describe, expect, it } from 'vitest';
import { detectFormat } from '../src/detect.js';
import { loadRaw } from '../src/raw.js';
import { BAS_FIXTURES, CMD_FIXTURES, SIX_LINES } from './fixtures.js';
import { writeBasic } from './writers/basic-tokenizer.js';

describe('detectFormat', () => {
  it('recognises every synthetic .CMD fixture from its content', () => {
    for (const [name, make] of Object.entries(CMD_FIXTURES)) expect(detectFormat(make()), name).toBe('cmd');
  });

  it('recognises every synthetic .BAS fixture from its content', () => {
    for (const [name, make] of Object.entries(BAS_FIXTURES)) expect(detectFormat(make()), name).toBe('bas');
  });

  it('falls back to raw for anything else', () => {
    expect(detectFormat(Uint8Array.from([0x21, 0x00, 0x3c, 0xc9]))).toBe('raw');
    expect(detectFormat(new Uint8Array())).toBe('raw');
    expect(detectFormat(Uint8Array.from('10 PRINT "HELLO"', (c) => c.charCodeAt(0)))).toBe('raw');
  });

  it('prefers a valid BASIC chain over a plausible first load record', () => {
    // No FF header, and the first pointer reads as a well-formed 3-byte 01 record.
    const bytes = writeBasic(SIX_LINES, 0x0501 - 32, { header: false });
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x01, 0x05, 0x0a, 0x00]);
    expect(detectFormat(bytes)).toBe('bas');
  });
});

describe('loadRaw', () => {
  it('loads the whole file as one block at the given base with the entry there', () => {
    const m = loadRaw(Uint8Array.from([0x21, 0x00, 0x3c, 0xc9]), 0x5200);
    expect(m.format).toBe('raw');
    expect(m.base).toBe(0x5200);
    expect(m.entry).toBe(0x5200);
    expect(m.image.runs()).toEqual([{ start: 0x5200, end: 0x5203, length: 4 }]);
    expect(Array.from(m.image.bytes.subarray(0x5200, 0x5204))).toEqual([0x21, 0x00, 0x3c, 0xc9]);
    expect(m.image.blocks.length).toBe(1);
  });
});
