/**
 * Real-program snapshot tests for the load modules in the plan's appendix.
 * Expected values are the appendix's measured load ranges (inclusive) and
 * entry points; the files themselves are the authority where they disagree,
 * and every such case is called out in a comment.
 */
import { describe, expect } from 'vitest';
import { loadCmd } from '../../src/cmd.js';
import { detectFormat } from '../../src/detect.js';
import { renderCmdListing } from '../../src/listing.js';
import { linearSweep } from '../../src/sweep.js';
import { readSample, resolveSample, skipIfMissing } from './samples.js';

interface Expected {
  runs: [number, number][];
  entry: number;
  overlaps?: [number, number][];
  trailing?: number;
  name?: boolean;
}

const EXPECTED: Record<string, Expected> = {
  'asylum1a.cmd': { runs: [[0x6000, 0x9d66]], entry: 0x9d1c },
  'asylum1b.cmd': { runs: [[0x6300, 0xb248]], entry: 0xb112, trailing: 823 },
  'asylum1c.cmd': { runs: [[0xa000, 0xef48]], entry: 0xee12 },
  'asylum1d.cmd': { runs: [[0x5200, 0xa148]], entry: 0xa012 },
  'asylum1e.cmd': { runs: [[0x4016, 0x4017], [0x5200, 0xa020]], entry: 0xa012, name: true },
  'asylum1f.cmd': { runs: [[0x6100, 0xada6]], entry: 0xad92 },
  'asylum16.cmd': { runs: [[0x8000, 0xbfef]], entry: 0x8000 },
  'asylum32.cmd': { runs: [[0x4016, 0x4017], [0x8000, 0xce20]], entry: 0xce12 },
  'asylum1g.cmd': { runs: [[0x3c00, 0x3fff], [0x62f3, 0xb13a]], entry: 0xb117 },
  // The appendix omits the $4016-$4017 vector block that asylumd.bad inherits from asylum32.
  'asylumd.bad': { runs: [[0x4016, 0x4017], [0x8000, 0xce20], [0xd000, 0xd114]], entry: 0xce12, overlaps: [[0x9267, 0x9269], [0xb01c, 0xb01e]] },
  'volcano.cmd': { runs: [[0x3c00, 0x4005], [0x52e9, 0x9142]], entry: 0x9134 },
  'GO.CMD': { runs: [[0xf000, 0xf0bd]], entry: 0xf000 },
  'ARMOUR.III': { runs: [[0x8000, 0xb8ff]], entry: 0xb801, overlaps: [[0xb801, 0xb80f]] },
};

const hex = (n: number): string => n.toString(16).toUpperCase().padStart(4, '0');
const show = (ranges: [number, number][]): string[] => ranges.map(([a, b]) => `${hex(a)}-${hex(b)}`);

describe('appendix load modules', () => {
  for (const [file, exp] of Object.entries(EXPECTED)) {
    skipIfMissing(file)(`${file}: load ranges, entry, patches`, () => {
      const bytes = readSample(file);
      expect(detectFormat(bytes)).toBe('cmd');
      const m = loadCmd(bytes);
      expect(show(m.image.runs().map((r) => [r.start, r.end]))).toEqual(show(exp.runs));
      expect(m.entry).toBe(exp.entry);
      expect(m.entrySource).toBe('transfer');
      expect(show(m.image.overlaps.map((o) => [o.start, o.end]))).toEqual(show(exp.overlaps ?? []));
      if (exp.trailing !== undefined) expect(m.trailing).toBe(exp.trailing);
      if (exp.name === true) expect(m.name).toBeDefined();
      const sections = linearSweep(m.image);
      const swept = sections.reduce((n, s) => n + s.lines.reduce((k, l) => k + l.bytes.length, 0), 0);
      expect(swept).toBe(m.image.runs().reduce((n, r) => n + r.length, 0));
      const listing = renderCmdListing(m, { source: file });
      expect(listing).toContain(`entry $${hex(exp.entry)}`);
      // A linear sweep may put the entry inside a multi-byte instruction (ARMOUR.III's patched $B801 does); the listing says so.
      expect(listing.includes('; entry') || listing.includes(`; note: entry $${hex(exp.entry)} falls inside the instruction at $`)).toBe(true);
    });
  }

  skipIfMissing('GO.CMD')('GO.CMD is 190 bytes and rewrites its own JP operand at $F0B9', () => {
    const m = loadCmd(readSample('GO.CMD'));
    expect(m.image.runs()[0]?.length).toBe(190);
    expect(m.image.isLoaded(0xf0b9)).toBe(true);
  });

  skipIfMissing('asylum1b.cmd')('asylum1b/1c/1d are the same 20,297 bytes relocated', () => {
    for (const f of ['asylum1b.cmd', 'asylum1c.cmd', 'asylum1d.cmd']) {
      if (resolveSample(f) === null) continue;
      expect(loadCmd(readSample(f)).image.runs()[0]?.length, f).toBe(20297);
    }
  });
});
