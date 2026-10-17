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

  it('SUB_4B9E: a proven screen fill gives its rows', () => {
    const r = must(summarizeRoutine(sea, 0x4ba9));
    expect(r.start).toBe(0x4b9e);
    const t = r.sentences.map(sentenceText);
    expect(t).toContain('It writes to the screen: rows 0–15 (at $4BA9).');
    expect(t).toContain('It fills 1,024 bytes ($0400) from $3C00 (VIDEO, the screen, row 0, column 0) with $80.');
  });

  it('SUB_4B5E: a screen range, keyboard reads (each address once) and a ROM routine with its purpose', () => {
    const r = must(summarizeRoutine(sea, 0x4b5e));
    const t = text(r);
    expect(t).toMatch(/from row 13, column 24 to row 13, column 38 \(at \$4BDD\)/);
    expect(r.sentences.map(sentenceText)).toContain('It calls the ROM routine $DELAY ($0060): pause for a time set by BC.');
    expect(t).toMatch(/It reads the keyboard: \$3840 \(KEYBOARD\+0040H\) \(at \$4B91\), \$3810 \(KEYBOARD\+0010H\) \(at \$4BBE\), /);
    expect(t.match(/\$3810 \(KEYBOARD/g)).toHaveLength(1);
  });

  it('SUB_5055: the self-modified JP at $509A is an exit to an unproven address, not a return', () => {
    const r = must(summarizeRoutine(sea, 0x5055));
    const t = text(r);
    expect(t).toMatch(/It ends by jumping to an address the program rewrites \(the jump at \$509A\)\./);
    expect(t).not.toMatch(/returning/);
    // L509D is reached only through that jump, so no routine provably reaches it.
    expect(summarizeRoutine(sea, 0x509d)).toBeNull();
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

  it('a rewritten JP is not followed, and a rewritten call does not count as a caller', () => {
    // 7000: CALL 7009H / LD HL,7007H / JP 7009H / 7009: RET. HL points into the JP's operand.
    const s = raw([0xcd, 0x09, 0x70, 0x21, 0x07, 0x70, 0xc3, 0x09, 0x70, 0xc9]);
    const r = must(summarizeRoutine(s, 0x7006));
    expect(text(r)).toMatch(/It ends by jumping to an address the program rewrites \(the jump at \$7006\)\./);
    expect(text(r)).not.toMatch(/jumping on to/);
    // 7000: CALL 7009H / LD HL,7001H / RET / 7009: RET. HL points into the CALL's operand.
    const s2 = raw([0xcd, 0x09, 0x70, 0x21, 0x01, 0x70, 0xc9, 0x00, 0x00, 0xc9]);
    const r2 = must(summarizeRoutine(s2, 0x7009));
    expect(text(r2)).not.toMatch(/called from/);
    expect(text(must(summarizeRoutine(s2, 0x7000)))).not.toMatch(/It calls/);
  });

  it('a jump into bytes not decoded as code is an unknown exit, not a loop forever', () => {
    // 7000: LD HL,0000H / JP 7001H (inside the LD).
    const r = must(summarizeRoutine(raw([0x21, 0x00, 0x00, 0xc3, 0x01, 0x70]), 0x7003));
    expect(text(r)).toMatch(/It ends by jumping to \$7001, which is not decoded as code\./);
    expect(text(r)).not.toMatch(/loops forever/);
  });

  it('falling into another start ends the routine there', () => {
    // 7000: CALL 7004H / NOP / 7004: RET
    const s = raw([0xcd, 0x04, 0x70, 0x00, 0xc9]);
    const r = must(summarizeRoutine(s, 0x7003));
    expect(r).toMatchObject({ start: 0x7000, instructions: 2 });
    expect(text(r)).toMatch(/It ends by running on into SUB_7004\./);
    expect(must(summarizeRoutine(s, 0x7004)).start).toBe(0x7004);
  });

  it('a line two starts reach belongs to the nearer one', () => {
    // 7000: CALL 7008H / CALL 700AH / RET / NOP / 7008: JR 700CH / 700A: JR 700CH / 700C: RET
    const s = raw([0xcd, 0x08, 0x70, 0xcd, 0x0a, 0x70, 0xc9, 0x00, 0x18, 0x02, 0x18, 0x00, 0xc9]);
    expect(must(summarizeRoutine(s, 0x700c)).start).toBe(0x700a);
    // The farther routine still counts the code it jumps to.
    expect(must(summarizeRoutine(s, 0x7008)).instructions).toBe(2);
  });

  it('stores into the keyboard area are not keyboard reads', () => {
    // 7000: LD (3801H),A / RET
    const t = text(must(summarizeRoutine(raw([0x32, 0x01, 0x38, 0xc9]), 0x7000)));
    expect(t).not.toMatch(/reads the keyboard/);
    expect(t).toMatch(/It writes to the keyboard area: \$3801/);
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

describe('summarizeRoutine speed', () => {
  // Wall-clock bounds are several times what was measured (see the task report), so a slow machine still passes.
  it('48K of calls: the first step is fast, and a second routine is faster still', () => {
    const bytes: number[] = [];
    let seed = 12345;
    const rnd = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) >> 16) & 0xff;
    for (let i = 0; i < 48 * 1024; i += 4) {
      const t = 0x4000 + i + 4 + (rnd() % 8) * 4;
      bytes.push(0xcd, t & 0xff, t >> 8, 0x00);
    }
    bytes[bytes.length - 1] = 0xc9;
    const s = openProgram(new Uint8Array(bytes), { base: 0x4000, selection: { machine: 3, dos: 'trsdos' } });
    let t = performance.now();
    expect(summarizeRoutine(s, 0x4000)).not.toBeNull();
    expect(performance.now() - t).toBeLessThan(200);
    t = performance.now();
    expect(summarizeRoutine(s, 0x8000)).not.toBeNull();
    expect(performance.now() - t).toBeLessThan(50);
  });

  it('a chain of CALL $+3 (each routine runs into the next) stays linear', () => {
    const bytes: number[] = [];
    for (let p = 0; p < 0xa000; p += 3) {
      const t = 0x4000 + p + 3;
      bytes.push(0xcd, t & 0xff, t >> 8);
    }
    bytes.push(0xc9);
    const s = openProgram(new Uint8Array(bytes), { base: 0x4000, selection: { machine: 3, dos: 'trsdos' } });
    const t = performance.now();
    const r = must(summarizeRoutine(s, 0x4000 + 0x9000));
    expect(performance.now() - t).toBeLessThan(200);
    expect(r.instructions).toBe(1);
  });
});
