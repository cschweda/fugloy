/**
 * Golden bytes, written out by hand from the Zilog manual rather than read from
 * the z80 tables, so a table and an inversion that agree on a wrong byte still
 * fail here. zmac checks the list itself.
 */
import { describe, expect, it } from 'vitest';
import { assemble, skipIfNoZmac } from '../../disasm/test/roundtrip/zmac.js';
import { encode } from '../src/index.js';
import type { Operand, Shape } from '../src/index.js';

const ORIGIN = 0x6000;

/** [zmac source line, bytes in hex], in order from ORIGIN. */
const GOLDEN: readonly (readonly [string, string])[] = [
  // base
  ['NOP', '00'],
  ['LD BC,1234H', '013412'],
  ['LD (BC),A', '02'],
  ['INC B', '04'],
  ['LD B,5AH', '065A'],
  ["EX AF,AF'", '08'],
  ['ADD HL,DE', '19'],
  ['DJNZ $', '10FE'],
  ['JR NZ,$+12H', '2010'],
  ['JR $-7EH', '1880'],
  ['LD (4000H),HL', '220040'],
  ['LD HL,(4000H)', '2A0040'],
  ['LD (3C00H),A', '32003C'],
  ['LD A,(3C00H)', '3A003C'],
  ['LD (HL),0FFH', '36FF'],
  ['HALT', '76'],
  ['LD A,(HL)', '7E'],
  ['ADD A,B', '80'],
  ['SUB 10H', 'D610'],
  ['CP (HL)', 'BE'],
  ['RET Z', 'C8'],
  ['POP AF', 'F1'],
  ['JP 0402H', 'C30204'],
  ['JP C,1234H', 'DA3412'],
  ['CALL NZ,1234H', 'C43412'],
  ['OUT (0FFH),A', 'D3FF'],
  ['IN A,(0FEH)', 'DBFE'],
  ['EX (SP),HL', 'E3'],
  ['EX DE,HL', 'EB'],
  ['JP (HL)', 'E9'],
  ['LD SP,HL', 'F9'],
  ['RST 28H', 'EF'],
  ['RST 0', 'C7'],
  ['DI', 'F3'],
  // CB
  ['RLC B', 'CB00'],
  ['SRL A', 'CB3F'],
  ['SLL C', 'CB31'],
  ['BIT 7,(HL)', 'CB7E'],
  ['RES 0,A', 'CB87'],
  ['SET 3,D', 'CBDA'],
  // ED
  ['IM 1', 'ED56'],
  ['IM 2', 'ED5E'],
  ['IN B,(C)', 'ED40'],
  ['OUT (C),A', 'ED79'],
  ['SBC HL,DE', 'ED52'],
  ['LD (4000H),SP', 'ED730040'],
  ['LD BC,(4000H)', 'ED4B0040'],
  ['LD I,A', 'ED47'],
  ['LD A,R', 'ED5F'],
  ['NEG', 'ED44'],
  ['LDIR', 'EDB0'],
  ['RETI', 'ED4D'],
  // DD
  ['LD IX,1234H', 'DD213412'],
  ['LD (IX+5),20H', 'DD360520'],
  ['LD A,(IX-3)', 'DD7EFD'],
  ['ADD IX,BC', 'DD09'],
  ['EX (SP),IX', 'DDE3'],
  ['JP (IX)', 'DDE9'],
  ['PUSH IX', 'DDE5'],
  ['LD IXH,12H', 'DD2612'],
  ['LD A,IXL', 'DD7D'],
  ['INC IXH', 'DD24'],
  // FD
  ['LD IY,(4000H)', 'FD2A0040'],
  ['INC (IY+7FH)', 'FD347F'],
  ['LD (IY-80H),B', 'FD7080'],
  ['LD IYL,A', 'FD6F'],
  ['ADD A,IYH', 'FD84'],
  ['EX (SP),IY', 'FDE3'],
  // DDCB
  ['RLC (IX+5)', 'DDCB0506'],
  ['BIT 2,(IX+0)', 'DDCB0056'],
  ['SET 7,(IX-1)', 'DDCBFFFE'],
  ['SLL (IX+1)', 'DDCB0136'],
  // FDCB
  ['RES 4,(IY+10H)', 'FDCB10A6'],
  ['BIT 0,(IY-2)', 'FDCBFE46'],
  ['SRA (IY+3)', 'FDCB032E'],
];

const NAMES = new Set([
  'A', 'B', 'C', 'D', 'E', 'H', 'L', 'I', 'R', 'IXH', 'IXL', 'IYH', 'IYL', 'F',
  'AF', 'BC', 'DE', 'HL', 'SP', 'IX', 'IY', "AF'", 'NZ', 'Z', 'NC', 'PO', 'PE', 'P', 'M',
]);

/** `12H`, `0FFH`, `5`, `$`, `$+12H`, `$-7EH` at `pc`. */
function number(text: string, pc: number): number {
  const m = /^(\$)?([+-])?(\w+)?$/.exec(text);
  if (m === null) throw new Error(`cannot read ${text}`);
  const [, dollar, sign, digits] = m;
  const n = digits === undefined ? 0 : /h$/i.test(digits) ? parseInt(digits.slice(0, -1), 16) : parseInt(digits, 10);
  const signed = sign === '-' ? -n : n;
  return dollar === undefined ? signed : pc + signed;
}

/** Just enough operand reading for the golden lines; the real parser is Task 2's. */
function operand(text: string, pc: number): Operand {
  if (NAMES.has(text)) return { shape: text as Shape };
  const idx = /^\((IX|IY)([+-]\w+)\)$/.exec(text);
  if (idx !== null) return { shape: `(${idx[1]}+d)` as Shape, value: number(idx[2]!.replace(/^\+/, ''), pc) };
  const paren = /^\((.+)\)$/.exec(text);
  if (paren !== null) return NAMES.has(paren[1]!) ? { shape: text as Shape } : { shape: '(nn)', value: number(paren[1]!, pc) };
  return { shape: 'nn', value: number(text, pc) };
}

function encodeLine(line: string, pc: number): number[] {
  const [mnemonic, rest] = line.split(/\s+/, 2) as [string, string | undefined];
  const operands = rest === undefined ? [] : rest.split(',').map((o) => operand(o, pc));
  const out = encode(mnemonic, operands, pc);
  if ('error' in out) throw new Error(`${line}: ${out.error}`);
  return out.bytes;
}

const bytesOf = (hex: string): number[] => (hex.match(/../g) ?? []).map((h) => parseInt(h, 16));
const ALL = GOLDEN.flatMap(([, hex]) => bytesOf(hex));

describe('golden encodings, written by hand', () => {
  it('covers every table and the undocumented forms', () => {
    const lines = GOLDEN.map(([l]) => l);
    expect(GOLDEN.length).toBeGreaterThanOrEqual(40);
    for (const lead of [/^(?!CB|DD|ED|FD)/, /^CB/, /^ED/, /^DD(?!CB)/, /^FD(?!CB)/, /^DDCB/, /^FDCB/]) expect(GOLDEN.some(([, hex]) => lead.test(hex))).toBe(true);
    for (const form of ['IXH', 'IXL', 'IYH', 'IYL', 'SLL C', 'SLL (IX']) expect(lines.some((l) => l.includes(form))).toBe(true);
  });

  it('the encoder gives the golden bytes', () => {
    let pc = ORIGIN;
    for (const [line, hex] of GOLDEN) {
      expect(encodeLine(line, pc).map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(''), line).toBe(hex);
      pc += hex.length / 2;
    }
  });

  skipIfNoZmac()('zmac agrees with the golden bytes', () => {
    const source = [`\tORG\t${ORIGIN.toString(16).toUpperCase()}H`, ...GOLDEN.map(([line]) => `\t${line}`), '\tEND', ''].join('\n');
    const { module } = assemble(source);
    expect(Array.from(module.image.bytes.subarray(ORIGIN, ORIGIN + ALL.length))).toEqual(ALL);
    expect(module.image.runs()).toEqual([{ start: ORIGIN, end: ORIGIN + ALL.length - 1, length: ALL.length }]);
  });
});
