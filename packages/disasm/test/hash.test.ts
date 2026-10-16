import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256, sha256Hex } from '../src/hash.js';

describe('sha256', () => {
  it('matches the FIPS 180-4 vectors', () => {
    expect(sha256Hex(new Uint8Array())).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256(new TextEncoder().encode('abc')).length).toBe(32);
  });

  it('matches node:crypto on lengths around the block and padding boundaries', () => {
    for (const n of [1, 55, 56, 63, 64, 65, 119, 120, 128, 1000, 20297]) {
      const data = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 0xff);
      expect(sha256Hex(data), `length ${n}`).toBe(createHash('sha256').update(data).digest('hex'));
    }
  });
});
