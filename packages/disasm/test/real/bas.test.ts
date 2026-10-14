/** Voyage of the Valkyrie: 13 tokenized BASIC files with hidden Z80 code. */
import { describe, expect, it } from 'vitest';
import { loadBas } from '../../src/bas.js';
import { detectFormat } from '../../src/detect.js';
import { renderBasListing } from '../../src/listing.js';
import { listSamples, readSample } from './samples.js';

const files = listSamples((n) => /^valkyr.*\.bas$/i.test(n));

describe('Voyage of the Valkyrie .BAS files', () => {
  it.skipIf(files.length === 0)('are all present (the appendix counts 14 files; 13 .bas plus valkyrie.txt exist)', () => {
    expect(files.length).toBe(13);
  });

  for (const file of files) {
    it(`${file}: FF header, 257 lines, base in $62C8..$6F3B, GOTO248 first, line 250 plants the JP`, () => {
      const bytes = readSample(file);
      expect(detectFormat(bytes)).toBe('bas');
      const p = loadBas(bytes);
      expect(p.header).toBe(true);
      expect(p.lines.length).toBe(257);
      // The appendix says $62C8..$6F00; valkyri9.bas is saved from $6F3B.
      expect(p.base).toBeGreaterThanOrEqual(0x62c8);
      expect(p.base).toBeLessThanOrEqual(0x6f3b);
      expect(p.lines[0]).toMatchObject({ number: 1, text: 'GOTO248', parsed: true });
      const line250 = p.lines.find((l) => l.number === 250);
      expect(line250?.parsed).toBe(true);
      expect(line250?.text).toContain('PEEK(16549)*256+PEEK(16548)+14');
      expect(line250?.text).toContain('POKE16421,195');
      expect(p.lines.every((l) => l.addr === p.base || l.bodyAddr === l.addr + 4)).toBe(true);
      // Phase 1 flags lines by structure only; the plan counts 190 code lines, and most of them trip it.
      const unparsed = p.lines.filter((l) => !l.parsed);
      expect(unparsed.length).toBeGreaterThan(150);
      expect(unparsed.length).toBeLessThan(190);
      expect(p.trailing).toBeLessThanOrEqual(3);
      expect(renderBasListing(p, { source: file })).toContain('\n1 GOTO248\n');
    });
  }
});
