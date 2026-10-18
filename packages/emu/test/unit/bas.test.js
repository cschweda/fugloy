/** The .BAS loader's parser, the manifest, and the errors, against the synthetic fixtures and inline bytes. */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseBas } from '../../src/index.js';
import { loadBas as disasmLoadBas } from '../../../disasm/src/bas.ts';
import { writeTokenizedProgram } from '../../src/loaders/cas-format.js';

const dir = fileURLToPath(new URL('../../../../fixtures/synthetic/bas/', import.meta.url));
const read = (name) => new Uint8Array(readFileSync(dir + name));
const ascii = (s) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

/** `10 PRINT "HI"` / `20 END` saved from $7000, with $FF header. */
const PROG = [0xff, 0x0a, 0x70, 0x0a, 0x00, 0xb2, 0x22, 0x48, 0x49, 0x22, 0x00, 0x10, 0x70, 0x14, 0x00, 0x80, 0x00, 0x00, 0x00];

describe('parseBas', () => {
  const tokenized = readdirSync(dir).filter((n) => n.endsWith('.bas') && read(n)[0] === 0xff);

  it.each(tokenized)('%s: line numbers and counts match the disassembler', (name) => {
    const bytes = read(name);
    const oracle = disasmLoadBas(bytes);
    const got = parseBas(bytes);
    expect(got.kind).toBe('tokenized');
    expect(got.lines.map((l) => l.lineNo)).toEqual(oracle.lines.map((l) => l.number));
    expect(got.lines.map((l) => l.tokens.length)).toEqual(oracle.lines.map((l) => l.body.length - 1));
  });

  it('keeps 00 bytes inside a line (hidden code) by following the pointer chain', () => {
    const got = parseBas(read('hidden-code.bas'));
    expect(got.lines.map((l) => l.lineNo)).toEqual([10, 20, 30]);
    expect([...got.lines[1].tokens]).toEqual([0xc3, 0x00, 0x00, 0xc9, 0x00, 0x3e]);
  });

  it('ignores bytes after the terminator', () => {
    expect(parseBas(read('trailing-bytes.bas')).lines.map((l) => l.lineNo)).toEqual([10, 20]);
  });

  it('a headerless tokenized file is not detected: it holds NULs, so it is not ASCII', () => {
    expect(() => parseBas(read('no-header.bas'))).toThrow(/^not a \.BAS file: NUL.*looks like tokenized BASIC without the \$FF header; add a leading \$FF byte to load it/);
  });

  it('bas-edge: a file cut before 00 00 is truncated', () => {
    const cut = new Uint8Array(PROG.slice(0, PROG.length - 2));
    expect(() => parseBas(cut)).toThrow(/^truncated \.BAS: /);
    expect(() => parseBas(new Uint8Array(PROG.slice(0, 8)))).toThrow(/^truncated \.BAS: /);
    expect(() => parseBas(new Uint8Array([0xff]))).toThrow(/^truncated \.BAS: /);
  });

  it('bas-edge: a line pointer past the end of the file is truncated', () => {
    const bad = new Uint8Array(PROG);
    bad[1] = 0xf0; bad[2] = 0x7f; // line 10 claims to run far past the end
    for (const i of [10, 15, 16, 17, 18]) bad[i] = 0x01; // and no 00 is left for the scan to stop at
    expect(() => parseBas(bad)).toThrow(/^truncated \.BAS: /);
  });

  it('bas-edge: a NUL in an ASCII file is not a .BAS file', () => {
    expect(() => parseBas(ascii('10 PRINT 1\n\x0020 END\n'))).toThrow(/^not a \.BAS file: NUL at offset 11/);
  });

  it('bas-edge: a control byte in a non-tokenized file is not a .BAS file', () => {
    expect(() => parseBas(new Uint8Array([0x31, 0x30, 0x01]))).toThrow(/^not a \.BAS file: /);
  });

  it('bas-edge: CR-LF and bare CR normalize to LF, and a final newline is added', () => {
    expect(parseBas(ascii('10 PRINT 1\r\n20 END\r\n'))).toEqual({ kind: 'ascii', text: '10 PRINT 1\n20 END\n' });
    expect(parseBas(ascii('10 PRINT 1\r20 END'))).toEqual({ kind: 'ascii', text: '10 PRINT 1\n20 END\n' });
    expect(parseBas(ascii('A\tB\n'))).toEqual({ kind: 'ascii', text: 'A\tB\n' });
  });
});

describe('writeTokenizedProgram / the tokenized manifest', () => {
  it('writes rebuilt pointers at TXTTAB and sets the variable pointers', () => {
    const ram = new Uint8Array(0x10000);
    const memory = {
      readWord: (a) => ram[a] | (ram[a + 1] << 8),
      writeWord: (a, v) => { ram[a] = v & 0xff; ram[a + 1] = v >> 8; },
      writeByte: (a, v) => { ram[a] = v; },
    };
    memory.writeWord(0x40a4, 0x42e9);
    const { lines } = parseBas(new Uint8Array(PROG));
    expect(lines.map((l) => l.lineNo)).toEqual([10, 20]);
    const r = writeTokenizedProgram({ memory }, lines);
    expect(r).toEqual({ start: 0x42e9, end: 0x42e9 + 18 });
    expect([...ram.subarray(0x42e9, r.end)]).toEqual([0xf3, 0x42, 0x0a, 0, 0xb2, 0x22, 0x48, 0x49, 0x22, 0, 0xf9, 0x42, 0x14, 0, 0x80, 0, 0, 0]);
    for (const p of [0x40f9, 0x40fb, 0x40fd]) expect(memory.readWord(p)).toBe(r.end);
  });
});
