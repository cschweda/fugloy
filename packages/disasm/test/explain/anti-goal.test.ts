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
import { djnzLoop, knownBefore, opcodeRewritten } from '../../src/explain/track.js';
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
  it('opcode rewritten through a register: LD (HL),n into an instruction start proves nothing after it', () => {
    // 7000 LD HL,7009H; 7003 LD (HL),3EH (LD B,9 becomes LD A,9); 7005 LD B,3; 7007 NOP; 7008 NOP; 7009 LD B,9; 700B LD A,B; 700C LD (3C00H),A; 700F RET
    const s = raw([0x21, 0x09, 0x70, 0x36, 0x3e, 0x06, 0x03, 0x00, 0x00, 0x06, 0x09, 0x78, 0x32, 0x00, 0x3c, 0xc9]);
    expect(opcodeRewritten(s.analysis, 0x7009)).toBe(true);
    expect(knownBefore(s.analysis, 0x700b).regs.B).toBeNull();
    // The line itself still shows what it starts as (with the caveat); the lines after it claim nothing.
    for (const at of [0x700b, 0x700c]) expect(lead(explainLine(s, at))).not.toMatch(/\$09\b/);
    expect(lead(explainLine(s, 0x7009))).toMatch(/written at \$7003\), so at run time it may be a different instruction/);
    // The same through IX+d, and through INC (HL) at a computed address.
    // 7000 LD IX,7000H; 7004 LD (IX+0BH),3EH; 7008 NOP; 7009 NOP; 700A NOP; 700B LD B,9; 700D LD A,B; 700E RET
    const x = raw([0xdd, 0x21, 0x00, 0x70, 0xdd, 0x36, 0x0b, 0x3e, 0x00, 0x00, 0x00, 0x06, 0x09, 0x78, 0xc9]);
    expect(opcodeRewritten(x.analysis, 0x700b)).toBe(true);
    expect(knownBefore(x.analysis, 0x700d).regs.B).toBeNull();
    // 7000 LD H,70H; 7002 LD L,06H (no label: the address is built a byte at a time); 7004 INC (HL); 7005 NOP; 7006 LD B,9; 7008 LD A,B; 7009 RET
    const i = raw([0x26, 0x70, 0x2e, 0x06, 0x34, 0x00, 0x06, 0x09, 0x78, 0xc9]);
    expect(opcodeRewritten(i.analysis, 0x7006)).toBe(true);
    expect(knownBefore(i.analysis, 0x7008).regs.B).toBeNull();
  });

  it('opcode rewritten through a register inside a DJNZ loop: no count', () => {
    // 7000 LD H,70H; 7002 LD L,09H; 7004 LD (HL),0C9H; 7006 LD B,4; 7008 head: NOP; 7009 NOP (becomes RET); 700A DJNZ 7008H; 700C RET
    const s = raw([0x26, 0x70, 0x2e, 0x09, 0x36, 0xc9, 0x06, 0x04, 0x00, 0x00, 0x10, 0xfc, 0xc9]);
    const loop = djnzLoop(s.analysis, 0x700a)!;
    expect(loop.count).toBeNull();
    expect(loop.exits).toContain(0x7009);
    expect(pat(explainLine(s, 0x700a))).not.toMatch(FIXED_COUNT);
    expect(summary(s, 0x7000)).not.toMatch(FIXED_COUNT);
  });

  it('a store into a CB instruction\'s opcode byte (its second) is an opcode rewrite, not an operand one', () => {
    // 7000 LD A,07H; 7002 LD (7009H),A; 7005 LD A,5; 7007 NOP; 7008 BIT 0,A (becomes RLC A); 700A LD (3C00H),A; 700D RET
    const s = raw([0x3e, 0x07, 0x32, 0x09, 0x70, 0x3e, 0x05, 0x00, 0xcb, 0x47, 0x32, 0x00, 0x3c, 0xc9]);
    expect(opcodeRewritten(s.analysis, 0x7008)).toBe(true);
    expect(knownBefore(s.analysis, 0x700a).regs.A).toBeNull();
    expect(lead(explainLine(s, 0x700a))).not.toMatch(/\$05\b/);
    expect(lead(explainLine(s, 0x7008))).toMatch(/may be a different instruction/);
  });

  it('a store into an ED instruction\'s second byte may make it a return: the loop has an exit and no count', () => {
    // 7000 LD A,4DH; 7002 LD (7009H),A; 7005 LD B,4; 7007 head: NOP; 7008 NEG (becomes RETI); 700A DJNZ 7007H; 700C RET
    const s = raw([0x3e, 0x4d, 0x32, 0x09, 0x70, 0x06, 0x04, 0x00, 0xed, 0x44, 0x10, 0xfb, 0xc9]);
    expect(opcodeRewritten(s.analysis, 0x7008)).toBe(true);
    const loop = djnzLoop(s.analysis, 0x700a)!;
    expect(loop.exits).toContain(0x7008);
    expect(loop.count).toBeNull();
    expect(pat(explainLine(s, 0x700a))).not.toMatch(FIXED_COUNT);
  });

  it('a store into a DD instruction\'s second byte may make it JP (IX): nothing is proven after it', () => {
    // 7000 LD A,0E9H; 7002 LD (7008H),A; 7005 LD A,5; 7007 LD IX,0 (becomes JP (IX)); 700B LD (3C00H),A; 700E RET
    const s = raw([0x3e, 0xe9, 0x32, 0x08, 0x70, 0x3e, 0x05, 0xdd, 0x21, 0x00, 0x00, 0x32, 0x00, 0x3c, 0xc9]);
    expect(opcodeRewritten(s.analysis, 0x7007)).toBe(true);
    expect(lead(explainLine(s, 0x700b))).not.toMatch(/\$05\b/);
  });

  it('a store into a DD CB instruction\'s fourth byte (its opcode) is an opcode rewrite; its displacement is an operand', () => {
    // 7000 LD A,06H; 7002 LD (700EH),A; 7005 LD A,5; 7007 LD IX,3C00H; 700B BIT 0,(IX+0); 700F LD (3C00H),A; 7012 RET
    const s = raw([0x3e, 0x06, 0x32, 0x0e, 0x70, 0x3e, 0x05, 0xdd, 0x21, 0x00, 0x3c, 0xdd, 0xcb, 0x00, 0x46, 0x32, 0x00, 0x3c, 0xc9]);
    expect(opcodeRewritten(s.analysis, 0x700b)).toBe(true);
    expect(lead(explainLine(s, 0x700f))).not.toMatch(/\$05\b/);
    // Storing into the displacement (700D) instead leaves the opcode alone.
    const d = raw([0x3e, 0x06, 0x32, 0x0d, 0x70, 0x3e, 0x05, 0xdd, 0x21, 0x00, 0x3c, 0xdd, 0xcb, 0x00, 0x46, 0x32, 0x00, 0x3c, 0xc9]);
    expect(opcodeRewritten(d.analysis, 0x700b)).toBe(false);
    expect(knownBefore(d.analysis, 0x700f).regs.A).toBe(0x05);
  });

  it('a label reached by a jump whose target bytes are rewritten: the jump is not stated, the pointer is', () => {
    // 7000 LD HL,7010H; 7003 LD A,20H; 7005 LD (700AH),A; 7008 NOP; 7009 JP 7010H (becomes JP 7020H); 700C-700F NOP; 7010 RET
    const s = raw([0x21, 0x10, 0x70, 0x3e, 0x20, 0x32, 0x0a, 0x70, 0x00, 0xc3, 0x10, 0x70, 0x00, 0x00, 0x00, 0x00, 0xc9]);
    const l = explainLine(s, 0x7010).label!;
    expect(l.jumpers).not.toContain(0x7009);
    expect(l.rewritten).toEqual([0x7009]);
    expect(l.pointers).toEqual([0x7000]);
  });

  it('where a value comes from: a jump whose target bytes are rewritten is only a possible way in', () => {
    // As above, with 7010 LD (HL),A; 7011 RET: HL is whatever it was when L7010 was reached.
    const s = raw([0x21, 0x10, 0x70, 0x3e, 0x20, 0x32, 0x0a, 0x70, 0x00, 0xc3, 0x10, 0x70, 0x00, 0x00, 0x00, 0x00, 0x77, 0xc9]);
    const t = lead(explainLine(s, 0x7010));
    expect(t).not.toMatch(/by the jump at \$7009/);
    expect(t).toMatch(/perhaps by the instruction at \$7009, which starts out leading here but which the program rewrites/);
  });

  it('a writer is named only when its address is proven: a store through DE whose E is rewritten names no writer', () => {
    // 7000 LD H,70H; 7002 LD L,09H; 7004 LD (HL),10H (E becomes $10); 7006 LD D,70H; 7008 LD E,0EH; 700A LD A,0C9H; 700C LD (DE),A; 700D NOP; 700E LD B,9; 7010 NOP; 7011 LD A,B; 7012 RET
    const s = raw([0x26, 0x70, 0x2e, 0x09, 0x36, 0x10, 0x16, 0x70, 0x1e, 0x0e, 0x3e, 0xc9, 0x12, 0x00, 0x06, 0x09, 0x00, 0x78, 0xc9]);
    expect(lead(explainLine(s, 0x700c))).toMatch(/do not prove what DE holds/);
    const t = lead(explainLine(s, 0x700e));
    expect(t).not.toMatch(/written at \$700C/);
    expect(t).toMatch(/The program may store into the first byte of this instruction as it runs/);
    // The operand store at $7004 is proven: it is still named.
    expect(lead(explainLine(s, 0x7008))).toMatch(/written at \$7004/);
  });

  it('the routine summary does not call a rewritten second opcode byte the first', () => {
    // The CB probe: 7002 LD (7009H),A stores into the second byte of 7008 BIT 0,A.
    const t = summary(raw([0x3e, 0x07, 0x32, 0x09, 0x70, 0x3e, 0x05, 0x00, 0xcb, 0x47, 0x32, 0x00, 0x3c, 0xc9]), 0x7000);
    expect(t).not.toMatch(/first byte/);
    expect(t).toMatch(/whatever the instruction at \$7008 becomes \(the program rewrites it\)/);
  });
});
