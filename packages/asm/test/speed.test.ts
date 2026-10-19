/**
 * The IDE assembles on every keystroke, so a source full of errors must cost
 * little more than a clean one. Before suggestions were kept per name and
 * pruned by length, deleting a label used 60 times made each assembly of a
 * 3,000-line source take about 200 ms (final review 4); it now takes about
 * 10 ms on the development Mac, and the aim is under about 40 ms. The test
 * allows 60 ms, a wide margin for a slow machine or one busy with the rest of
 * the suite (the best of five runs once reached 47 ms there), and still far
 * below the 200 ms it guards against. It warms up first and takes the best
 * of ten runs, so one pause of the collector cannot fail it.
 */
import { describe, expect, it } from 'vitest';
import { assemble } from '../src/index.js';

/** A 3,000-line source in eight repeating shapes; with `missing`, every sixth group calls one of seven undefined names. */
function source(missing: boolean): string {
  const out = ['\tORG 6000H', 'SCREEN\tEQU 3C00H', 'COUNT\tDEFL 0'];
  let i = 0;
  while (out.length < 3000) {
    i++;
    out.push(`L${i}:\tLD HL,SCREEN+${i % 1000}\t; point at the screen`);
    out.push(`\tLD A,(IX+${i % 100})`);
    out.push('\tCALL $VDCLS');
    out.push(`\tDJNZ L${i}`);
    out.push(`\tJP NZ,L${i + 1}`);
    out.push(missing && i % 6 === 0 ? `\tCALL MISSINGNAME${i % 7}` : "\tDB 'HELLO',0DH");
    out.push(`V${i}\tEQU L${i}+2`);
    out.push(`\tDW V${i},$`);
  }
  out.push(`L${i + 1}:\tRET`, '\tEND L1');
  return out.join('\n');
}

const best = (src: string, runs: number): number => {
  let least = Infinity;
  for (let k = 0; k < runs; k++) {
    const t = performance.now();
    assemble(src, { model: 3 });
    least = Math.min(least, performance.now() - t);
  }
  return least;
};

describe('speed', () => {
  it('a 3,000-line source with 60 undefined uses assembles in about 10 ms (at most 60 ms)', () => {
    const src = source(true);
    const result = assemble(src, { model: 3 });
    expect(result.listing.length).toBeGreaterThanOrEqual(3000);
    const undefinedUses = result.diagnostics.filter((d) => /MISSINGNAME\d is not defined/.test(d.message));
    expect(undefinedUses.length).toBeGreaterThanOrEqual(60);
    best(src, 3);
    expect(best(src, 10)).toBeLessThan(60);
  });
});
