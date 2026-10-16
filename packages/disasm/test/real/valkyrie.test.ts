/** Voyage of the Valkyrie analyzed: hidden code found, its entry mined, listed at true addresses (skips when absent). */
import { describe, expect, it } from 'vitest';
import { loadBas } from '../../src/bas.js';
import { renderPass1Listing } from '../../src/listing.js';
import { analyze } from '../../src/pipeline.js';
import { listSamples, readSample } from './samples.js';

const files = listSamples((n) => /^valkyr.*\.bas$/i.test(n));
const hex4 = (n: number): string => n.toString(16).toUpperCase().padStart(4, '0');
const EVIDENCE = 'line 250: POKE 16421,195 with address program start + 14';

describe('Voyage of the Valkyrie, analyzed', () => {
  for (const file of files) {
    it(`${file}: mines program start + 14 from line 250 and lists line 2 as code at its true address`, () => {
      const prog = loadBas(readSample(file));
      const a = analyze(prog);
      const entry = (prog.base + 14) & 0xffff;
      expect(a.entries).toEqual([{ addr: entry, evidence: EVIDENCE, line: 250 }]);
      expect(a.roots[0]).toBe(entry);
      expect(a.pass1.instructions.has(entry)).toBe(true);
      const listing = renderPass1Listing(a, { source: file });
      expect(listing).toContain('; code lines: 182; entries mined: 1\n');
      expect(listing).toContain(`; entry $${hex4(entry)} (${EVIDENCE})\n`);
      expect(listing).toContain(`\n1 GOTO248\n; line 2: machine code, 41 bytes at $${hex4(prog.base + 13)}\n`);
      expect(listing).toContain('\n250 CLS:');
    });
  }
});
