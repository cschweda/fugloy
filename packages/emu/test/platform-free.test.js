import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { CassetteSystem, fromBase64, toBase64, Z80CPU } from '../src/index.js';

const src = fileURLToPath(new URL('../src/', import.meta.url));
const files = (dir) => readdirSync(dir).flatMap((e) => (statSync(join(dir, e)).isDirectory() ? files(join(dir, e)) : e.endsWith('.js') ? [join(dir, e)] : []));
/** Code without comments, so prose like "the window of time" does not count. */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const GLOBALS = ['window', 'document', 'navigator', 'globalThis', 'self', 'requestAnimationFrame', 'cancelAnimationFrame', 'AudioContext', 'webkitAudioContext', 'localStorage', 'sessionStorage', 'fetch', 'XMLHttpRequest', 'addEventListener', 'removeEventListener', 'atob', 'btoa', 'Buffer', 'process', 'require', 'console', 'setTimeout', 'setInterval', 'performance', 'queueMicrotask'];
/** A bare global (not a property like `this.process`, not part of a longer name), or a clock or random source. */
const PLATFORM = new RegExp(`(?<![.\\w$])(?:${GLOBALS.join('|')})(?![\\w$])|\\bDate\\.now\\b|\\bnew Date\\b|\\bMath\\.random\\b`);

afterEach(() => vi.restoreAllMocks());

it('names no browser or Node global anywhere in src', () => {
  const hits = files(src).flatMap((f) => code(readFileSync(f, 'utf8')).split('\n').flatMap((line, i) => (PLATFORM.test(line) ? [`${f.slice(src.length)}:${i + 1}: ${line.trim()}`] : [])));
  expect(hits).toEqual([]);
});

it('reports an unimplemented opcode through the injected logger, not console', () => {
  const cpu = new Z80CPU();
  const mem = new Uint8Array(0x10000);
  mem.set([0xed, 0x00], 0); // ED 00: no ED case handles it
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
  expect(logged).toEqual([['warn', expect.stringContaining('0xED 0x00')]]);
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
