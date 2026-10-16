import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { CassetteSystem, fromBase64, toBase64, Z80CPU } from '../src/index.js';
import { platformHits } from './platform-scan.js';

const src = fileURLToPath(new URL('../src/', import.meta.url));
const files = (dir) => readdirSync(dir).flatMap((e) => (statSync(join(dir, e)).isDirectory() ? files(join(dir, e)) : e.endsWith('.js') ? [join(dir, e)] : []));
afterEach(() => vi.restoreAllMocks());

it('names no browser or Node global anywhere in src', () => {
  const hits = files(src).flatMap((f) => platformHits(readFileSync(f, 'utf8')).map((hit) => `${f.slice(src.length)}:${hit}`));
  expect(hits).toEqual([]);
});

it('reports an unimplemented opcode through the injected logger, not console', () => {
  const cpu = new Z80CPU();
  const mem = new Uint8Array(0x10000); // NOP at 0000H
  delete cpu.opcodeHandlers[0x00]; // every Z80 opcode is implemented, so take one away
  cpu.readMemory = (a) => mem[a];
  cpu.writeMemory = (a, v) => { mem[a] = v; };
  cpu.readPort = () => 0xff;
  cpu.writePort = () => {};
  cpu.reset();
  const logged = [];
  cpu.log = (level, text) => logged.push([level, text]);
  const warn = vi.spyOn(console, 'warn');
  cpu.executeInstruction();
  expect(warn).not.toHaveBeenCalled();
  expect(logged).toEqual([['warn', expect.stringContaining('Unimplemented opcode: 0x00')]]);
});

it('reports cassette activity through the injected logger, not console', () => {
  const tape = new CassetteSystem();
  const logged = [];
  tape.log = (level, text) => logged.push([level, text]);
  const log = vi.spyOn(console, 'log');
  tape.loadTape(Uint8Array.from([1, 2, 3]));
  expect(log).not.toHaveBeenCalled();
  expect(logged).toEqual([['info', 'Cassette loaded: 3 bytes']]);
});

it('encodes and decodes base64 itself', () => {
  for (const [bytes, text] of [[[], ''], [[0x4d], 'TQ=='], [[0x4d, 0x61], 'TWE='], [[0x4d, 0x61, 0x6e], 'TWFu'], [[0, 1, 2, 253, 254, 255], 'AAEC/f7/']]) {
    expect(toBase64(Uint8Array.from(bytes))).toBe(text);
    expect(Array.from(fromBase64(text))).toEqual(bytes);
  }
});

it('decodes base64 as upstream did: whitespace ignored, the URL-safe alphabet accepted', () => {
  expect(Array.from(fromBase64(' TW\nFu '))).toEqual([0x4d, 0x61, 0x6e]);
  expect(Array.from(fromBase64('-_8='))).toEqual([0xfb, 0xff]);
  expect(() => fromBase64('TW*u')).toThrow(/not base64/);
});
