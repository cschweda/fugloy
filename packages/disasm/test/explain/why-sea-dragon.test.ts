/** Explain's "why" on a real program: Sea Dragon with its committed hints. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderInstruction } from '../../src/emit/operands.js';
import { explainLine, sentenceText } from '../../src/explain/index.js';
import { openProgram, withHintText } from '../../src/session.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const sea = withHintText(
  openProgram(new Uint8Array(readFileSync(`${root}examples/sea-dragon/seadrg01.cmd`)), { name: 'seadrg01.cmd', selection: { machine: 3, dos: 'trsdos' } }),
  readFileSync(`${root}examples/sea-dragon/seadrg01.hints`, 'utf8'),
  'seadrg01.hints',
);
const a = sea.analysis;
/** The line at `at` as the listing prints it. */
const listed = (at: number): string => renderInstruction(a.pass1.instructions.get(at)!, a.symbols, a.externals);
const why = (at: number) => explainLine(sea, at).why!;
const texts = (s: Parameters<typeof sentenceText>[0][]): string[] => s.map(sentenceText);

describe('why on Sea Dragon', () => {
  it('the print routine is PRINT_TEXT at $6140, and its callers load DE with a screen address', () => {
    expect(a.symbols.get(0x6140)?.name).toBe('PRINT_TEXT');
    // Inside PRINT_TEXT, DE is a parameter: no screen address is proven there.
    for (let at = 0x6140; at <= 0x614e; at++) if (a.pass1.instructions.has(at)) expect(texts(why(at).purpose).join(' ')).not.toContain('the screen');
    // The callers' LD DE lines name the screen, with the row and column.
    const callers: [number, number, string][] = [
      [0x4a91, 0x4a96, 'DE holds $3E8D (VIDEO+028DH, the screen, row 10, column 13); its next use is not certain: the call at $4A96 may use or change it.'],
      [0x4b86, 0x4b8b, 'DE holds $3F15 (VIDEO+0315H, the screen, row 12, column 21); its next use is not certain: the call at $4B8B may use or change it.'],
      [0x600e, 0x6013, 'DE holds $3D16 (VIDEO+0116H, the screen, row 4, column 22); its next use is not certain: the call at $6013 may use or change it.'],
    ];
    for (const [ld, call, text] of callers) {
      expect(listed(call)).toBe('CALL PRINT_TEXT');
      expect(listed(ld)).toMatch(/^LD DE,VIDEO\+/);
      expect(texts(why(ld).purpose)).toEqual([text]);
    }
    expect(texts(why(0x4b86).routine)).toEqual(['It is part of the routine TITLE_FRAME ($4B5E), which writes to the screen and reads the keyboard.']);
  });

  it('idioms across the program, each about the instruction the listing shows', () => {
    const cases: [number, string, string[]][] = [
      [0x4983, 'XOR A', ['Programmers write XOR A rather than LD A,00H to set A to zero because it is 1 byte and 4 T-states against 2 bytes and 7; it also sets the Z flag and clears the carry, where LD A,00H leaves the flags as they were.']],
      [0x49af, 'LD B,40H', ["LD B,40H with the DJNZ at $49CA is the Z80's counted loop: B holds the count, and DJNZ takes 1 from it and jumps back in 2 bytes and 13 T-states (8 when it falls out), against 3 bytes and 16 (11) for DEC B and JR NZ."]],
      [0x49f9, 'LDIR', ['LDIR copies a whole block with a single 2-byte instruction, 21 T-states for each byte but the last (16). The same copy written as a loop (LD A,(HL), LD (DE),A, INC HL, INC DE, DEC BC, LD A,B, OR C and JR NZ) takes 9 bytes and 52 T-states a byte, and uses A.']],
      [
        0x4a5f,
        'OR A',
        [
          'OR A leaves A as it is but sets the flags from it: Z when A is zero, S from its top bit, and the carry always cleared. It is the usual way to test A for zero, or to clear the carry, in 1 byte and 4 T-states against 2 bytes and 7 for CP 00H, which tests for zero the same way.',
          'The next line, at $4A60, is SBC HL,BC: the Z80 has no 16-bit subtract that leaves the carry out, so clearing the carry first is the usual way to make SBC a plain subtract.',
        ],
      ],
      [0x4be7, 'PUSH AF', ['PUSH AF here, with the POP AF at $4BF0 after the call at $4BED, is the usual way to keep A and the flags across a call: the stack holds them while the routine runs, 2 bytes and 21 T-states in all. Keeping A at a fixed address instead (LD (nn),A and LD A,(nn)) would take 6 bytes and 26 T-states, and would not keep the flags.']],
      [0x5392, 'DEC (IX+02H)', ['DEC (IX+02H) takes 1 from the byte in memory where it is, the usual way to keep a counter in memory: 3 bytes and 23 T-states against 7 bytes and 42 for LD A,(IX+02H), DEC A and LD (IX+02H),A, which would also change A.']],
      [0x5fc9, 'LD A,(HL)', ['LD A,(HL) with the INC HL at $5FCA is the usual way to walk through a table: read the byte HL points at, then move HL on to the next. HL is as cheap as any pointer for it (LD A,(DE) and INC DE cost the same), 2 bytes and 13 T-states against 5 bytes and 29 for LD A,(IX+00H) and INC IX.']],
      [0x5150, "EX AF,AF'", ["EX AF,AF' swaps A and the flags with the spare pair, A' and F', in 1 byte and 4 T-states: a quick way to set A and the flags aside without the stack, where PUSH AF and POP AF would take 2 bytes and 21 T-states."]],
      [0x4bcd, 'SRL A', ['SRL shifts every bit right, which halves an unsigned byte, the low bit (the remainder) going into the carry: the Z80 has no divide, so shifting is the usual way to divide by two. For A, clearing the carry and rotating (OR A and RRA) gives the same value in the same 2 bytes and 8 T-states, but only SRL works on the other registers.']],
    ];
    for (const [at, line, idiom] of cases) {
      expect(listed(at)).toBe(line);
      expect(texts(why(at).idiom)).toEqual(idiom);
    }
    // The lines the sentences point at are what they say.
    expect(listed(0x49ca)).toBe('DJNZ L49B1');
    expect(a.pass1.instructions.get(0x49ca)!.operands[0]).toMatchObject({ kind: 'rel', target: 0x49b1 });
    expect(listed(0x4a60)).toBe('SBC HL,BC');
    expect(listed(0x4bed)).toBe('CALL PRINT_TEXT');
    expect(listed(0x4bf0)).toBe('POP AF');
    expect(listed(0x5fca)).toBe('INC HL');
  });

  it('every idiom that quotes its own line spells it as the listing does', () => {
    let quoted = 0;
    for (const [at, ins] of a.pass1.instructions) {
      for (const s of why(at).idiom) {
        const t = sentenceText(s);
        if (/^(CP|LD|INC|DEC|RST) /.test(t) && ins.mnemonic === t.split(' ')[0]) {
          expect(t.startsWith(`${listed(at)} `), t).toBe(true);
          quoted++;
        }
      }
    }
    expect(quoted).toBeGreaterThan(50);
  });

  it('says nothing of a bare result whose next use is not certain, and OR A and AND A write no new A', () => {
    const empty = /^[A-Z]+ holds the result; its next use is not certain/;
    let orAnd = 0;
    let all = 0;
    for (const [at, ins] of a.pass1.instructions) {
      const purpose = texts(why(at).purpose);
      all += purpose.filter((t) => empty.test(t)).length;
      if (listed(at) === 'OR A' || listed(at) === 'AND A') {
        orAnd++;
        for (const t of purpose) expect(t, `${ins.mnemonic} at ${at.toString(16)}`).not.toMatch(/^A holds the result; its next use is not certain/);
      }
    }
    expect(orAnd).toBeGreaterThan(100);
    expect(all).toBe(0);
  });

  it('names the register the "why this register" sentences speak of', () => {
    expect(why(0x4983).registerName).toBe('A'); // XOR A
    expect(why(0x49ca).registerName).toBe('B'); // DJNZ
    expect(why(0x49f9).registerName).toBeUndefined(); // LDIR: HL, DE and BC
    expect(why(0x49f9).register).toHaveLength(1);
    expect(why(0x4a91).registerName).toBeUndefined(); // no forced choice
    expect(why(0x4a91).register).toEqual([]);
  });
});
