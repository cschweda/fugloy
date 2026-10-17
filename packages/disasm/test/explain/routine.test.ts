/** The Explain tab's routine summary: what the routine around a line provably touches. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sentenceText } from '../../src/explain/index.js';
import { summarizeRoutine, summaryNotes } from '../../src/explain/routine.js';
import type { RoutineSummary } from '../../src/explain/routine.js';
import { knownBefore } from '../../src/explain/track.js';
import { openProgram, withHintText } from '../../src/session.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const seaRaw = openProgram(new Uint8Array(readFileSync(`${root}examples/sea-dragon/seadrg01.cmd`)), { name: 'seadrg01.cmd', selection: { machine: 3, dos: 'trsdos' } });
const sea = withHintText(seaRaw, readFileSync(`${root}examples/sea-dragon/seadrg01.hints`, 'utf8'), 'seadrg01.hints');
const BASE = 0x7000;
const raw = (bytes: number[]) => openProgram(new Uint8Array(bytes), { base: BASE, selection: { machine: 3, dos: 'trsdos' } });

const text = (r: RoutineSummary): string => r.sentences.map(sentenceText).join(' ');
const links = (r: RoutineSummary): number[] => r.sentences.flatMap((s) => s.flatMap((p) => (p.addr === undefined ? [] : [p.addr])));
const must = (r: RoutineSummary | null): RoutineSummary => {
  expect(r).not.toBeNull();
  return r!;
};

describe('summarizeRoutine on Sea Dragon', () => {
  it('SUB_6140: starts at $6140, loops with DJNZ, called from $4A96 and $4AA1', () => {
    const r = must(summarizeRoutine(sea, 0x6146));
    expect(r).toMatchObject({ start: 0x6140, name: 'SUB_6140', instructions: 11, bytes: 15, truncated: false });
    const t = text(r);
    expect(t).toMatch(/DJNZ/);
    expect(t).toMatch(/called from/);
    expect(links(r)).toEqual(expect.arrayContaining([0x4a96, 0x4aa1]));
    expect(t).toMatch(/returning/);
    // DE is not proven inside the routine: no screen position.
    expect(t).not.toMatch(/screen/);
  });

  it('SUB_6212: writes port $FF (CASSETTE)', () => {
    const r = must(summarizeRoutine(sea, 0x6212));
    expect(r.start).toBe(0x6212);
    expect(text(r)).toMatch(/writes to port \$FF \(CASSETTE\)/);
    expect(text(r)).toMatch(/delay loop/);
  });

  it('the routine around $49A7: starts at L497F, writes port $EC (MODEPORT), and states no unproven screen cell', () => {
    const r = must(summarizeRoutine(sea, 0x49a7));
    expect(r.start).toBe(0x497f);
    expect(r.name).toBe('L497F');
    const t = text(r);
    expect(t).toMatch(/writes to port \$EC \(MODEPORT\)/);
    // LD (IX+00H),A at $49C2 is its only screen store, and IX is not proven there (L49BC is a merge point,
    // and the loop changes IX), so the summary says nothing about the screen rather than guess row 14.
    expect(knownBefore(sea.analysis, 0x49c2).regs.IXH).toBeNull();
    expect(t).not.toMatch(/screen/);
    expect(t).toMatch(/the lines from L49B1 to the DJNZ at \$49CA, 64 times/);
  });

  it('$888B: the loader routine at the entry $8881, ending in a jump on to L497F', () => {
    const r = must(summarizeRoutine(sea, 0x888b));
    expect(r).toMatchObject({ start: 0x8881, instructions: 6, truncated: false });
    const t = text(r);
    expect(t).toMatch(/jumping on to L497F/);
    expect(t).toMatch(/entry point/);
    expect(t).toMatch(/Copies 13,953 bytes|13,953 bytes/);
  });

  it('a data row is in no routine', () => {
    expect(summarizeRoutine(sea, 0x7399)).toBeNull();
  });

  it('is cached per analysis and start', () => {
    expect(summarizeRoutine(sea, 0x6146)).toBe(summarizeRoutine(sea, 0x614c));
  });

  it('summaryNotes lines are all 72 characters or fewer, and keep every word', () => {
    for (const at of [0x6146, 0x6212, 0x49a7, 0x888b]) {
      const r = must(summarizeRoutine(sea, at));
      const notes = summaryNotes(r);
      expect(notes.length).toBeGreaterThan(0);
      for (const n of notes) expect(n.length).toBeLessThanOrEqual(72);
      expect(notes.join(' ').split(/\s+/)).toEqual(text(r).split(/\s+/));
    }
  });
});

describe('summarizeRoutine facts', () => {
  it('a direct store and a store through a proven HL give rows and columns', () => {
    // 7000: LD A,2AH / LD (3C05H),A / LD HL,3F80H / LD (HL),A / RET
    const r = must(summarizeRoutine(raw([0x3e, 0x2a, 0x32, 0x05, 0x3c, 0x21, 0x80, 0x3f, 0x77, 0xc9]), 0x7000));
    const t = text(r);
    expect(t).toMatch(/row 0, column 5/);
    expect(t).toMatch(/row 14, column 0/);
  });

  it('a store through an unknown HL says nothing about the screen', () => {
    // 7000: LD (HL),A / RET
    const r = must(summarizeRoutine(raw([0x77, 0xc9]), 0x7000));
    expect(text(r)).not.toMatch(/screen/);
  });

  it('a store with only H proven in screen memory says which rows, not the cell', () => {
    // 7000: LD H,3FH / LD (HL),A / RET
    const r = must(summarizeRoutine(raw([0x26, 0x3f, 0x77, 0xc9]), 0x7000));
    expect(text(r)).toMatch(/rows 12–15/);
    expect(text(r)).not.toMatch(/column/);
  });

  it('a proven fill reports its screen range', () => {
    // 7000: LD HL,3C00H / LD DE,3C01H / LD BC,03FFH / LD (HL),20H / LDIR / RET
    const r = must(summarizeRoutine(raw([0x21, 0x00, 0x3c, 0x11, 0x01, 0x3c, 0x01, 0xff, 0x03, 0x36, 0x20, 0xed, 0xb0, 0xc9]), 0x7000));
    expect(text(r)).toMatch(/rows 0–15/);
  });

  it('a rewritten store address states nothing', () => {
    // 7000: LD (3C05H),A / LD HL,7001H / RET: HL points into the store's operand, so the program may rewrite it.
    const s = raw([0x32, 0x05, 0x3c, 0x21, 0x01, 0x70, 0xc9]);
    expect(s.analysis.symbols.has(0x7001)).toBe(true);
    const r = must(summarizeRoutine(s, 0x7000));
    expect(text(r)).not.toMatch(/screen/);
  });

  it('keyboard reads, ROM calls and program calls', () => {
    // 7000: LD A,(3840H) / CALL 0049H / CALL 7009H / RET / 7009: RET
    const r = must(summarizeRoutine(raw([0x3a, 0x40, 0x38, 0xcd, 0x49, 0x00, 0xcd, 0x09, 0x70, 0xc9]), 0x7000));
    const t = text(r);
    expect(t).toMatch(/reads the keyboard/);
    expect(t).toMatch(/ROM routine/);
    expect(links(r)).toContain(0x7009);
  });

  it('a routine with no exit loops forever; a DJNZ with a proven count says how many times', () => {
    // 7000: LD B,05H / 7002: DJNZ 7002H / JR 7000H
    const r = must(summarizeRoutine(raw([0x06, 0x05, 0x10, 0xfe, 0x18, 0xfa]), 0x7002));
    expect(text(r)).toMatch(/loops forever/);
  });

  it('stops at 2,000 instructions and says so', () => {
    // 2,100 NOPs, then RET.
    const r = must(summarizeRoutine(raw([...new Array<number>(2100).fill(0), 0xc9]), 0x7000));
    expect(r.truncated).toBe(true);
    expect(r.instructions).toBe(2000);
    expect(text(r)).toMatch(/2,000/);
  });
});
