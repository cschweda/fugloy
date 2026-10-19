/**
 * Sources zmac rejects are rejected by the assembler too (zmac-gated). A zmac
 * warning counts as a rejection, as in the round-trip harness.
 *
 * The grid: every mnemonic with no operand, with one, and with two, drawn from
 * a set of registers, conditions, memory forms, and numbers, one file per
 * mnemonic, about 100,000 lines in all. zmac flags each bad line by number, and the assembler
 * must give an error on every line zmac flags. The lines only the assembler
 * refuses must all fall in the stricter-than-zmac classes listed below (each
 * is pinned with zmac's bytes in zmac-probes.test.ts), and the lines both
 * accept must assemble to the same bytes.
 */
import { describe, expect } from 'vitest';
import { expectSameImage, skipIfNoZmac } from '../../disasm/test/roundtrip/zmac.js';
import { assemble, mnemonics } from '../src/index.js';
import { errorsOf, runZmac } from './helpers.js';

const zit = skipIfNoZmac();

const OPERANDS = [
  'A', 'B', 'D', 'E', 'H', 'L', 'I', 'R', '(HL)', '(BC)', '(DE)', '(SP)', '(IX)', '(IX+5)', '(IY-3)', 'IX', 'IY', 'IXH', 'IYL',
  'HL', 'BC', 'DE', 'SP', 'AF', "AF'", 'NZ', 'C', 'PO', 'M', '(C)', '0', '7', '8', '38H', '1234H', '(12H)', '300', '-200',
];

/** zmac's line numbers that drew an error or a warning: `prog.z(12) : ...`. */
function flagged(output: string): Set<number> {
  const out = new Set<number>();
  for (const m of output.matchAll(/\((\d+)\)\s*:/g)) out.add(Number(m[1]));
  return out;
}

/**
 * Lines zmac accepts and the assembler refuses on purpose: it takes only the
 * spellings @fugloy/z80's tables give (zmac-probes.test.ts pins each with zmac's bytes).
 */
const STRICTER: { why: string; test: RegExp }[] = [
  { why: 'ED 70H/71H, which the tables keep as DB', test: /^(IN\t\(C\)|OUT\t\(C\),0)$/ },
  { why: 'IN/OUT with the port alone (zmac: IN A,(n) / OUT (n),A)', test: /^(IN|OUT)\t[^,]+$/ },
  { why: 'JP HL, JP IX, JP IY without parentheses', test: /^JP\t(HL|IX|IY)$/ },
  { why: 'PUSH/POP of A, B, D, H, or AF\' (zmac: the pair)', test: /^(PUSH|POP)\t(A|B|D|H|AF')$/ },
  { why: 'RST 1 to 7 (zmac: RST 8 to 38H)', test: /^RST\t[1-7]$/ },
  { why: 'M for (HL) after ADD, ADC, SUB, SBC, or CP (zmac reads the 8080 name)', test: /^(ADD|ADC|SUB|SBC|CP)\tM$/ },
  { why: 'the undocumented DD CB / FD CB register copies, which the tables keep as DB', test: /^(RLC|RRC|RL|RR|SLA|SRA|SLL|SRL)\t\(I[XY][^)]*\),[ABCDEHL]$/ },
];

const why = (line: string): string | undefined => STRICTER.find((s) => s.test.test(line))?.why;

describe('the mnemonic and operand grid', () => {
  zit('every line zmac rejects is rejected, only the stricter classes are rejected beyond that, and the rest assembles alike', () => {
    // One file per mnemonic: zmac's messages stop naming lines past 65,535.
    const accepted: string[] = [];
    const stricter: string[] = [];
    const good: string[] = [];
    let rejected = 0;
    for (const m of mnemonics()) {
      const lines = [m];
      for (const a of OPERANDS) {
        lines.push(`${m}\t${a}`);
        for (const b of OPERANDS) lines.push(`${m}\t${a},${b}`);
      }
      const source = ['\tORG\t8000H', ...lines.map((l) => `\t${l}`), '\tEND'].join('\n') + '\n';
      const zmac = flagged(runZmac(source).output);
      const asm = new Set(assemble(source).diagnostics.filter((d) => d.severity === 'error').map((d) => d.line));
      rejected += zmac.size;
      lines.forEach((l, i) => {
        const n = i + 2;
        if (zmac.has(n) && !asm.has(n)) accepted.push(l);
        else if (asm.has(n) && !zmac.has(n)) stricter.push(l);
        else if (!zmac.has(n)) good.push(l);
      });
    }
    expect(accepted, 'zmac rejects these and the assembler accepts them').toEqual([]);
    expect(stricter.filter((l) => why(l) === undefined), 'only the assembler rejects these, and no stricter class covers them').toEqual([]);
    for (const s of STRICTER) expect(stricter.some((l) => s.test.test(l)), `the class "${s.why}" no longer occurs: drop it`).toBe(true);
    expect(rejected).toBeGreaterThan(90_000);

    // The lines both accept, alone in one file: the same image.
    expect(good.length).toBeGreaterThan(600);
    const both = ['\tORG\t8000H', ...good.map((l) => `\t${l}`), '\tEND'].join('\n') + '\n';
    const z = runZmac(both);
    expect(z.clean, z.output).toBe(true);
    const a = assemble(both);
    // Warnings are fine here (`ADD A,(12H)` warns that the parentheses only group); errors are not.
    expect(errorsOf(a)).toEqual([]);
    expectSameImage(a.image!, z.image!);
  });
});

/** Whole programs zmac rejects, beyond the single-line probes in zmac-probes.test.ts. */
const PROGRAMS: { name: string; lines: string[] }[] = [
  { name: 'a label defined twice', lines: ['L:\tNOP', 'L:\tNOP'] },
  { name: 'a JR out of range forward', lines: ['\tJR FAR', '\tDS 200', 'FAR:\tNOP'] },
  { name: 'a JR out of range backward', lines: ['BACK:\tDS 200', '\tJR BACK'] },
  { name: 'a DJNZ out of range', lines: ['\tDJNZ FAR', '\tDS 130', 'FAR:\tNOP'] },
  { name: 'an undefined name in DW', lines: ['\tDW NOWHERE'] },
  { name: 'an undefined name as END\'s entry', lines: ['\tNOP', '\tEND NOWHERE'] },
  { name: 'an index offset of 128', lines: ['\tLD A,(IX+128)'] },
  { name: 'an index offset of -129', lines: ['\tLD A,(IY-129)'] },
  { name: 'a port of 256', lines: ['\tIN A,(256)'] },
  { name: 'IM 3', lines: ['\tIM 3'] },
  { name: 'BIT 8', lines: ['\tBIT 8,A'] },
  { name: 'LD A,256', lines: ['\tLD A,256'] },
  { name: 'DB 256', lines: ['\tDB 256'] },
  { name: 'DB -129', lines: ['\tDB -129'] },
  { name: 'a string with no closing quote', lines: ["\tDB 'ABC"] },
  { name: 'EQU with no name', lines: ['\tEQU 5'] },
  { name: 'ORG with no address', lines: ['\tORG'] },
  { name: 'an unknown directive', lines: ['\t.FOO 1'] },
  { name: 'an unknown instruction', lines: ['\tFROB A,B'] },
  { name: 'a missing operand', lines: ['\tLD A,'] },
  { name: 'an extra operand', lines: ['\tNOP 1'] },
  { name: 'three operands', lines: ['\tLD A,B,C'] },
  { name: 'unbalanced parentheses', lines: ['\tLD A,(HL'] },
  { name: 'LD between two memory operands', lines: ['\tLD (HL),(HL)'] },
  { name: 'LD between IX and IY halves', lines: ['\tLD IXH,IYL'] },
  { name: 'LD H,IXL', lines: ['\tLD H,IXL'] },
  { name: 'EX DE,IX', lines: ['\tEX DE,IX'] },
  { name: 'ADD IX,IY', lines: ['\tADD IX,IY'] },
  { name: 'ADD HL,IX', lines: ['\tADD HL,IX'] },
  { name: 'a .DEPHASE with no .PHASE', lines: ['\t.DEPHASE'] },
  { name: 'division by zero', lines: ['\tDW 1/0'] },
  { name: 'a label that is a hex number', lines: ['$ABC\tEQU 1'] },
];

describe('whole programs zmac rejects', () => {
  for (const p of PROGRAMS) {
    zit(p.name, () => {
      const source = ['\tORG\t6000H', ...p.lines].join('\n') + '\n';
      const z = runZmac(source);
      expect(z.clean, `zmac accepted:\n${source}`).toBe(false);
      const result = assemble(source);
      expect(result.ok, `the assembler accepted:\n${source}`).toBe(false);
      expect(result.image).toBeNull();
      expect(errorsOf(result).length).toBeGreaterThan(0);
      // The error is on the line zmac flags, not an unrelated one.
      const zmacLines = [...flagged(z.output)];
      const asmLines = new Set(result.diagnostics.filter((d) => d.severity === 'error').map((d) => d.line));
      expect(zmacLines.length, z.output).toBeGreaterThan(0);
      expect(zmacLines.filter((n) => !asmLines.has(n)), `zmac flags these lines and asm has no error there:\n${z.output}\n${errorsOf(result).join('\n')}`).toEqual([]);
    });
  }
});
