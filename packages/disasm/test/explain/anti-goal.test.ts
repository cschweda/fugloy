/**
 * The Explain tab's central anti-goal, collected in one place: it never states
 * a register value, address, count or fact not proven on every path. One
 * synthetic program per known way to get that wrong; each test asserts what
 * the line sentences, the pattern, the routine summary and the data region
 * must NOT say. Some of these are also tested next to the code they guard;
 * this file keeps the guarantees together so a change that breaks one fails here.
 */
import { describe, expect, it } from 'vitest';
import { dataRegion, explainLine, sentenceText, summarizeRoutine } from '../../src/explain/index.js';
import type { Explanation } from '../../src/explain/index.js';
import { knownBefore } from '../../src/explain/track.js';
import { openProgram } from '../../src/session.js';

const raw = (bytes: number[]) => openProgram(new Uint8Array(bytes), { base: 0x7000, selection: { machine: 3, dos: 'trsdos' } });
const lead = (e: Explanation): string => e.sentences.map(sentenceText).join(' ');
const pat = (e: Explanation): string => (e.pattern?.sentences ?? []).map(sentenceText).join(' ');
const summary = (s: ReturnType<typeof raw>, at: number): string => (summarizeRoutine(s, at)?.sentences ?? []).map(sentenceText).join(' ');
/** A fixed repeat count: "N times", "once", "twice", without "at most" or "up to" before it. */
const FIXED_COUNT = /(?<!at most )(?<!up to )\b(\d[\d,]* times|once|twice)\b/;

describe('Explain never states what is not proven', () => {
  it('rewritten operand: LD B,4 whose 4 the program stores over proves nothing about B', () => {
    // 7000 LD (7004H),A; 7003 LD B,4 (7004 is its operand); 7005 LD A,B; 7006 LD (3C00H),A; 7009 RET
    const s = raw([0x32, 0x04, 0x70, 0x06, 0x04, 0x78, 0x32, 0x00, 0x3c, 0xc9]);
    expect(knownBefore(s.analysis, 0x7005).regs.B).toBeNull();
    for (const at of [0x7005, 0x7006]) expect(lead(explainLine(s, at))).not.toMatch(/\$04\b/);
  });

  it('rewritten opcode: LD B,9 whose first byte the program stores over proves nothing at all', () => {
    // 7000 LD A,0; 7002 LD (7007H),A; 7005 LD B,3; 7007 LD B,9 (becomes NOP, then $09 runs as ADD HL,BC); 7009 LD A,B; 700A LD (3C00H),A; 700D RET
    const s = raw([0x3e, 0x00, 0x32, 0x07, 0x70, 0x06, 0x03, 0x06, 0x09, 0x78, 0x32, 0x00, 0x3c, 0xc9]);
    expect(Object.values(knownBefore(s.analysis, 0x7009).regs).every((v) => v === null)).toBe(true);
    for (const at of [0x7009, 0x700a]) expect(lead(explainLine(s, at))).not.toMatch(/\$0[39]\b/);
    expect(lead(explainLine(s, 0x7007))).toMatch(/may be a different instruction/);
  });

  it('indirect re-entry: a loop head JP (HL) can reach gives no count, and no value at the head', () => {
    // 7000 LD B,4; 7002 LD HL,7005H; 7005 head: NOP; 7006 DJNZ 7005; 7008 JP (HL)
    const s = raw([0x06, 0x04, 0x21, 0x05, 0x70, 0x00, 0x10, 0xfd, 0xe9]);
    expect(pat(explainLine(s, 0x7006))).not.toMatch(FIXED_COUNT);
    expect(summary(s, 0x7006)).not.toMatch(/4 times/);
    expect(knownBefore(s.analysis, 0x7005).regs.B).toBeNull();
  });

  it('PUSH/RET dispatch: the target knows nothing, and the RET claims no CALL', () => {
    // 7000 LD A,5; 7002 LD HL,7007H; 7005 PUSH HL; 7006 RET; 7007 LD (3C00H),A; 700A RET
    const s = raw([0x3e, 0x05, 0x21, 0x07, 0x70, 0xe5, 0xc9, 0x32, 0x00, 0x3c, 0xc9]);
    expect(lead(explainLine(s, 0x7007))).not.toMatch(/\$05\b/);
    expect(lead(explainLine(s, 0x7006))).not.toMatch(/, which the CALL that came here put there/);
  });

  it('early-exit DJNZ: a loop that can leave early is never given a fixed count', () => {
    // 7000 LD HL,3C00H; 7003 LD B,10H; 7005 l: LD A,(HL); 7006 CP 20H; 7008 JR Z,700E; 700A INC HL; 700B DJNZ 7005; 700D RET; 700E LD (HL),2AH; 7010 RET
    const s = raw([0x21, 0x00, 0x3c, 0x06, 0x10, 0x7e, 0xfe, 0x20, 0x28, 0x04, 0x23, 0x10, 0xf8, 0xc9, 0x36, 0x2a, 0xc9]);
    for (const at of [0x7005, 0x700a, 0x700b]) expect(pat(explainLine(s, at))).not.toMatch(FIXED_COUNT);
    expect(summary(s, 0x7000)).not.toMatch(FIXED_COUNT);
    // RET Z in the body: the same.
    const s2 = raw([0x06, 0x10, 0xc8, 0x10, 0xfd, 0xc9]);
    expect(pat(explainLine(s2, 0x7003))).not.toMatch(FIXED_COUNT);
  });

  it('EX DE,HL in a data-reading loop: no direction, no step', () => {
    // 7000 LD HL,700AH; 7003 LD A,(HL); INC HL; EX DE,HL; OR A; JR NZ,7003H; RET; 700A data.
    const r = dataRegion(raw([0x21, 0x0a, 0x70, 0x7e, 0x23, 0xeb, 0xb7, 0x20, 0xfa, 0xc9, 0x01, 0x02, 0x00]), 0x700b);
    expect(r).not.toBeNull();
    expect(r!.readers).toEqual([]);
    expect(r!.sentences.map(sentenceText).join(' ')).not.toMatch(/stepping (forward|back)/);
  });

  it('merge point: a value set differently on two paths is not stated', () => {
    // 7000 LD A,1; 7002 JR Z,7006; 7004 LD A,2; 7006 LD (3C00H),A; 7009 RET
    const s = raw([0x3e, 0x01, 0x28, 0x02, 0x3e, 0x02, 0x32, 0x00, 0x3c, 0xc9]);
    expect(knownBefore(s.analysis, 0x7006).regs.A).toBeNull();
    const t = lead(explainLine(s, 0x7006));
    expect(t).not.toMatch(/\$0[12]\b/);
  });

  it('a start also reached through a pointer: the caller list is not called complete', () => {
    // 7000: CALL 700AH / LD HL,700AH / CALL 7009H / 7009: JP (HL) / 700A: RET
    const t = summary(raw([0xcd, 0x0a, 0x70, 0x21, 0x0a, 0x70, 0xcd, 0x09, 0x70, 0xe9, 0xc9]), 0x700a);
    expect(t).not.toMatch(/It is called from one place: \$7000\./);
    expect(t).toMatch(/may also be reached through a pointer/);
  });
});
