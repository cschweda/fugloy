/** The Explain tab's patterns: block copies, fills, counted loops and delay loops. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { explainLine, sentenceText } from '../../src/explain/index.js';
import type { Explanation } from '../../src/explain/index.js';
import { openProgram, withHintText } from '../../src/session.js';
import { CmdWriter } from '../writers/cmd-writer.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const seaBytes = new Uint8Array(readFileSync(`${root}examples/sea-dragon/seadrg01.cmd`));
const seaRaw = openProgram(seaBytes, { name: 'seadrg01.cmd', selection: { machine: 3, dos: 'trsdos' } });
const sea = withHintText(seaRaw, readFileSync(`${root}examples/sea-dragon/seadrg01.hints`, 'utf8'), 'seadrg01.hints');
const BASE = 0x7000;
const raw = (bytes: number[]) => openProgram(new Uint8Array(bytes), { base: BASE, selection: { machine: 3, dos: 'trsdos' } });
const pat = (e: Explanation): string[] => (e.pattern?.sentences ?? []).map(sentenceText);

describe('copy', () => {
  it('Sea Dragon $888B: the copy, and that it moves the program (seadrg01.hints relocates it)', () => {
    const e = explainLine(sea, 0x888b);
    // The lead stays as it is.
    expect(e.sentences.map(sentenceText)[0]).toBe(
      'Copy $3681 (13,953) bytes from $5200 (L5200) to $497F (L497F), one at a time, counting up: BC is the count, HL the source and DE the destination.',
    );
    expect(e.pattern).toMatchObject({ name: 'copy', from: 0x8882, to: 0x888b });
    expect(pat(e)).toEqual(['Copies 13,953 bytes ($3681) from $5200 (L5200) to $497F (L497F).', 'This moves the program to where it runs.']);
  });

  it('the setup lines share the pattern; the line before them does not', () => {
    expect(explainLine(sea, 0x8885).pattern?.name).toBe('copy');
    expect(explainLine(sea, 0x8881).pattern).toBeUndefined();
  });

  it('without the hints, the movers proposal says it moves the program', () => {
    const e = explainLine(seaRaw, 0x888b);
    expect(pat(e)).toEqual(['Copies 13,953 bytes ($3681) from $5200 (DATA_5200) to $497F.', 'This moves the program to where it runs.']);
  });

  it('a copy nothing proposes or relocates states the copy only', () => {
    // LD HL,7100H / LD DE,7200H / LD BC,0010H / LDIR / RET
    const e = explainLine(raw([0x21, 0x00, 0x71, 0x11, 0x00, 0x72, 0x01, 0x10, 0x00, 0xed, 0xb0, 0xc9]), 0x7009);
    expect(e.pattern?.name).toBe('copy');
    expect(pat(e)).toEqual(['Copies 16 bytes ($0010) from $7100 to $7200.']);
  });

  it('a merge point where only movers knows the values: it proposes, and states no numbers', () => {
    const bytes = new CmdWriter()
      .load(0x7000, [...new Array<number>(0x30).fill(0x00), 0xed, 0xb0, 0xc3, 0x00, 0x50]) // payload, then LDIR / JP 5000H
      .load(0x7100, [0x01, 0x35, 0x00, 0x11, 0x00, 0x50, 0x21, 0x00, 0x70, 0xc3, 0x30, 0x70]) // LD BC,0035H / LD DE,5000H / LD HL,7000H / JP 7030H
      .transfer(0x7100)
      .bytes();
    const s = openProgram(bytes, { name: 'mover.cmd' });
    expect(s.analysis.proposals.some((p) => p.kind === 'move' && p.ldir === 0x7030)).toBe(true);
    const e = explainLine(s, 0x7030);
    expect(e.pattern).toMatchObject({ name: 'copy', from: 0x7030, to: 0x7030 });
    const text = pat(e).join(' ');
    expect(text).toMatch(/proposes/);
    expect(text).not.toMatch(/[0-9]/);
  });
});

describe('fill', () => {
  it('LD (HL),20H / LD D,H / LD E,L / INC DE / LD BC,03FFH / LDIR over $3C00 clears the screen', () => {
    const e = explainLine(raw([0x21, 0x00, 0x3c, 0x36, 0x20, 0x54, 0x5d, 0x13, 0x01, 0xff, 0x03, 0xed, 0xb0, 0xc9]), 0x700b);
    expect(e.pattern).toMatchObject({ name: 'fill', from: 0x7000, to: 0x700b });
    expect(pat(e)).toEqual(['Fills 1,024 bytes ($0400) from $3C00 (VIDEO, the screen, row 0, column 0) with $20: the first byte is stored, then LDIR copies each byte to the next.', 'This clears the screen.']);
    expect(explainLine(raw([0x21, 0x00, 0x3c, 0x36, 0x20, 0x54, 0x5d, 0x13, 0x01, 0xff, 0x03, 0xed, 0xb0, 0xc9]), 0x7003).pattern?.name).toBe('fill');
  });

  it('LD (HL),A spans from the line that set A', () => {
    // LD A,20H / LD HL,3C00H / LD (HL),A / LD D,H / LD E,L / INC DE / LD BC,03FFH / LDIR / RET
    const e = explainLine(raw([0x3e, 0x20, 0x21, 0x00, 0x3c, 0x77, 0x54, 0x5d, 0x13, 0x01, 0xff, 0x03, 0xed, 0xb0, 0xc9]), 0x700c);
    expect(e.pattern).toMatchObject({ name: 'fill', from: 0x7000, to: 0x700c });
    expect(pat(e)[1]).toBe('This clears the screen.');
  });

  it('LD DE,nn proven to be HL+1 counts too; two rows of the screen', () => {
    // LD HL,3C40H / LD (HL),20H / LD DE,3C41H / LD BC,007FH / LDIR / RET
    const e = explainLine(raw([0x21, 0x40, 0x3c, 0x36, 0x20, 0x11, 0x41, 0x3c, 0x01, 0x7f, 0x00, 0xed, 0xb0, 0xc9]), 0x700b);
    expect(e.pattern?.name).toBe('fill');
    expect(pat(e)[1]).toBe('This clears rows 1–2 of the screen.');
  });

  it('another byte over the screen fills it with that byte', () => {
    const e = explainLine(raw([0x21, 0x00, 0x3c, 0x36, 0x8c, 0x54, 0x5d, 0x13, 0x01, 0xff, 0x03, 0xed, 0xb0, 0xc9]), 0x700b);
    expect(pat(e)[1]).toBe('This fills the screen with $8C.');
  });

  it('LD DE,nn that is not HL+1 is a copy, not a fill', () => {
    const e = explainLine(raw([0x21, 0x40, 0x3c, 0x36, 0x20, 0x11, 0x42, 0x3c, 0x01, 0x7f, 0x00, 0xed, 0xb0, 0xc9]), 0x700b);
    expect(e.pattern?.name).toBe('copy');
  });
});

describe('counted loop', () => {
  it('Sea Dragon $49CA DJNZ L49B1: 64 times', () => {
    const e = explainLine(sea, 0x49ca);
    expect(e.pattern).toMatchObject({ name: 'counted-loop', from: 0x49b1, to: 0x49ca });
    expect(pat(e)).toEqual(['Repeats the lines from L49B1 to here 64 times.']);
    const link = e.pattern!.sentences[0]!.find((p) => p.text === 'L49B1');
    expect(link?.addr).toBe(0x49b1);
  });

  it('a line in the body names the DJNZ instead of "here"', () => {
    const e = explainLine(sea, 0x49bf);
    expect(pat(e)).toEqual(['Repeats the lines from L49B1 to the DJNZ at $49CA 64 times.']);
  });

  it('Sea Dragon $4E06 DJNZ L4E03: B times, since B=A is unknown', () => {
    const e = explainLine(sea, 0x4e06);
    expect(e.pattern).toMatchObject({ name: 'counted-loop', from: 0x4e03, to: 0x4e06 });
    expect(pat(e)).toEqual(['Repeats the lines from L4E03 to here B times, with B as it was on reaching L4E03; the lines leading there do not prove its value.']);
    expect(pat(e).join(' ')).not.toMatch(/\$[0-9A-F]{2}\b/);
  });

  it('Sea Dragon $54BC DJNZ L54B4: the JR Z out of the body makes 20 a bound', () => {
    const e = explainLine(sea, 0x54bc);
    expect(e.pattern).toMatchObject({ name: 'counted-loop', from: 0x54b4, to: 0x54bc });
    expect(pat(e)).toEqual(['Repeats the lines from L54B4 to here at most 20 times, leaving early at $54B8.']);
    expect(e.pattern!.sentences[0]!.find((p) => p.text === '$54B8')?.addr).toBe(0x54b8);
  });

  it('Sea Dragon $5BE0, $564A and $577E: early exits make every count a bound', () => {
    for (const at of [0x5be0, 0x564a, 0x577e]) expect(pat(explainLine(sea, at)).join(' ')).toMatch(/ at most \d+ times, leaving early at \$[0-9A-F]{4}\.$/);
  });

  it('early-exit: a synthetic find-a-slot loop is at most 16 times', () => {
    // 7000 LD HL,3C00H; 7003 LD B,10H; 7005 l: LD A,(HL); 7006 CP 20H; 7008 JR Z,700E; 700A INC HL; 700B DJNZ 7005; 700D RET; 700E LD (HL),2AH; 7010 RET
    const e = explainLine(raw([0x21, 0x00, 0x3c, 0x06, 0x10, 0x7e, 0xfe, 0x20, 0x28, 0x04, 0x23, 0x10, 0xf8, 0xc9, 0x36, 0x2a, 0xc9]), 0x700b);
    expect(pat(e)).toEqual(['Repeats the lines from L7005 to here at most 16 times, leaving early at $7008.']);
  });

  it('early-exit: more than three exits name the first and count the others', () => {
    // 7000 LD B,8; 7002 l: RET Z; RET Z; RET Z; RET Z; 7006 DJNZ 7002; 7008 RET
    const e = explainLine(raw([0x06, 0x08, 0xc8, 0xc8, 0xc8, 0xc8, 0x10, 0xfa, 0xc9]), 0x7006);
    expect(pat(e)).toEqual(['Repeats the lines from L7002 to here at most 8 times, leaving early at $7002 and 3 others.']);
  });

  it('early-exit with B unproven: up to B times', () => {
    // 7000 LD B,A; 7001 l: RET Z; 7002 DJNZ 7001; 7004 RET
    const e = explainLine(raw([0x47, 0xc8, 0x10, 0xfd, 0xc9]), 0x7002);
    expect(pat(e)).toEqual(['Repeats the lines from L7001 to here up to B times, with B as it was on reaching L7001, leaving early at $7001; the lines leading there do not prove its value.']);
  });

  it('early-exit with B changed in the body: until B counts down or it leaves early', () => {
    // 7000 LD B,4; 7002 l: LD B,A; 7003 RET Z; 7004 DJNZ 7002; 7006 RET
    const e = explainLine(raw([0x06, 0x04, 0x47, 0xc8, 0x10, 0xfc, 0xc9]), 0x7004);
    expect(pat(e)).toEqual(['Repeats the lines from L7002 to here until B counts down to zero or it leaves early at $7003; how many times is not proven.']);
  });

  it('changesB scans the body by address, past a gap the decoder left', () => {
    // 7000 LD B,4; 7002 l: JR 7005; 7004 a data byte; 7005 LD B,A; 7006 DJNZ 7002; 7008 RET
    const e = explainLine(raw([0x06, 0x04, 0x18, 0x01, 0xff, 0x47, 0x10, 0xfa, 0xc9]), 0x7006);
    expect(pat(e)).toEqual(['Repeats the lines from L7002 to here until B counts down to zero; how many times is not proven.']);
  });
});

describe('wait', () => {
  it('LD BC,1000H / DEC BC / LD A,B / OR C / JR NZ: a delay with its T-states', () => {
    const e = explainLine(raw([0x01, 0x00, 0x10, 0x0b, 0x78, 0xb1, 0x20, 0xfb, 0xc9]), 0x7006);
    expect(e.pattern).toMatchObject({ name: 'wait', from: 0x7003, to: 0x7006 });
    // 4,096 passes of 6 + 4 + 4 + 12 T-states, less the 5 the last JR does not take.
    expect(pat(e)).toEqual(['A delay loop: it does nothing but count BC down from $1000 (4,096) to zero, which takes 106,491 T-states.']);
  });

  it('a delay whose count is not proven states no total', () => {
    // DEC BC / LD A,B / OR C / JR NZ / RET at the entry point
    const e = explainLine(raw([0x0b, 0x78, 0xb1, 0x20, 0xfb, 0xc9]), 0x7003);
    expect(e.pattern?.name).toBe('wait');
    expect(pat(e)).toEqual(['A delay loop: it does nothing but count BC down to zero; how long it takes depends on BC on entry, which the lines leading here do not prove.']);
  });

  it('LD B,n / L: DJNZ L is a delay', () => {
    const e = explainLine(raw([0x06, 0x10, 0x10, 0xfe, 0xc9]), 0x7002);
    expect(e.pattern?.name).toBe('wait');
    // 16 passes of 13, less the 5 the last DJNZ does not take.
    expect(pat(e)).toEqual(['A delay loop: it does nothing but count B down from $10 (16) to zero, which takes 203 T-states.']);
  });

  it('DEC BC / LD A,B / DEC C / JR NZ states no count and is not called a delay', () => {
    // LD BC,1000H / L: DEC BC / LD A,B / DEC C / JR NZ,L / RET: the jump tests C after its own DEC, not BC.
    const e = explainLine(raw([0x01, 0x00, 0x10, 0x0b, 0x78, 0x0d, 0x20, 0xfb, 0xc9]), 0x7006);
    expect(e.pattern?.name).toBe('wait');
    expect(pat(e).join(' ')).not.toMatch(/\$|[0-9]|T-states/);
  });

  it('DEC BC / LD A,C / DEC B / JR NZ states no count', () => {
    const e = explainLine(raw([0x01, 0x00, 0x10, 0x0b, 0x79, 0x05, 0x20, 0xfb, 0xc9]), 0x7006);
    expect(pat(e).join(' ')).not.toMatch(/\$|[0-9]|T-states/);
  });

  it('a body whose jump tests flags from before the loop is not called a delay', () => {
    // LD BC,1000H / L: DEC BC / LD A,B / JR NZ,L / RET: nothing in the body sets Z.
    const e = explainLine(raw([0x01, 0x00, 0x10, 0x0b, 0x78, 0x20, 0xfc, 0xc9]), 0x7005);
    expect(pat(e)).toEqual(['A loop that only counts and tests registers, writing no memory and using no ports.']);
  });

  it('a loop that writes memory is not a delay', () => {
    // LD B,10H / L: LD (HL),A / DEC B / JR NZ,L / RET
    const e = explainLine(raw([0x06, 0x10, 0x77, 0x05, 0x20, 0xfc, 0xc9]), 0x7004);
    expect(e.pattern).toBeUndefined();
  });
});
