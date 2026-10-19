/**
 * zmac probes: each question about zmac's syntax that the assembler had to
 * answer is asked of the pinned zmac here, and the assembler must agree.
 * Where zmac only warns, the assembler errors (the round-trip harness treats
 * any zmac warning as failure). The few places where the assembler is
 * deliberately stricter than zmac are pinned at the end, each with the reason.
 */
import { describe, expect } from 'vitest';
import { skipIfNoZmac } from '../../disasm/test/roundtrip/zmac.js';
import { assemble } from '../src/index.js';
import { bytesOf, errorsOf, runZmac } from './helpers.js';

const zit = skipIfNoZmac();
const program = (...lines: string[]): string => ['\tORG 6000H', ...lines].join('\n') + '\n';

/** zmac assembles `source` cleanly, and the assembler produces the same bytes. */
function same(source: string): void {
  const z = runZmac(source);
  expect(z.clean, z.output).toBe(true);
  expect(bytesOf(source)).toEqual(z.bytes);
}

/** zmac rejects `source` (an error or a warning), and the assembler gives an error. */
function bothReject(source: string): void {
  const z = runZmac(source);
  expect(z.clean, `zmac accepted:\n${source}`).toBe(false);
  expect(errorsOf(assemble(source)).length, `asm accepted:\n${source}`).toBeGreaterThan(0);
}

describe('zmac probe: label case', () => {
  zit('labels are case-insensitive', () => {
    same(program('Loop:\tNOP', '\tJP loop', '\tJP LOOP', '\tJP Loop'));
  });
});

describe('zmac probe: labels without a colon', () => {
  zit('in column 1 a word is a label', () => {
    same(program('BAZ\tNOP', '\tJP BAZ', 'ALONE', '\tJP ALONE'));
  });
  zit('a mnemonic alone in column 1 is an instruction', () => {
    same(program('nop', 'ret', 'ei'));
  });
  zit('a mnemonic with operands in column 1 is rejected', () => {
    bothReject(program('ld a,1'));
    bothReject(program('jp 0'));
  });
  zit('outside column 1, a word before an instruction is rejected', () => {
    bothReject(program('  foo\tNOP'));
  });
  zit('outside column 1, a word alone draws a zmac warning, so an error here', () => {
    bothReject(program('  foo'));
  });
  zit('outside column 1, a colon makes a label, and EQU needs no colon', () => {
    same(program('  bar: NOP', '\tJP bar', '  K EQU 5', '\tDB K'));
  });
  zit('A, B, and SP cannot be labels', () => {
    bothReject(program('a: nop'));
    bothReject(program('b: nop'));
    bothReject(program('sp: nop'));
  });
  zit('HIGH and MOD cannot be labels', () => {
    bothReject(program('high: nop'));
    bothReject(program('mod: nop'));
  });
});

describe('zmac probe: (expr) memory versus immediate (Review Focus 1)', () => {
  zit('an operand entirely in parentheses is memory', () => {
    same(program('\tLD A,(3C00H)', '\tLD A,((5))', '\tLD HL,(1234H)', '\tLD A,(HIGH 1234H)', '\tLD SP,(5)', '\tLD (5),A', '\tLD (5),HL', '\tLD (5),IX', '\tLD IX,(5)', '\tLD HL,((5))', '\tLD A,( 3C00H )'));
  });
  zit('parentheses inside a larger expression only group', () => {
    same(program('\tLD A,3C00H & 0FFH', '\tLD A,(5)+1', '\tLD A,1+(5)', '\tLD HL,(12H)+(34H)', '\tLD A,(2)*(3)', '\tLD A,-(3)', '\tLD A,+(5)', '\tLD A,0+(5)', '\tLD BC,(5)+1', '\tLD SP,(5)+0', '\tLD HL,(5)*1', '\tJP (5)+1', '\tLD A,(1)|(2)', '\tLD A,(1) MOD (2)', '\tLD (IX+5),(3)+1', '\tLD (IX+(3)),(4)+0'));
  });
  zit('where the instruction has no memory form there, the parenthesised number is the immediate', () => {
    same(program('\tSUB (5)', '\tCP (5)', '\tOR (5)', '\tXOR (5)', '\tAND (5)', '\tADD A,(5)', '\tADC A,(5)', '\tSBC A,(5)', '\tCALL (5)', '\tCALL NZ,(5)', '\tJP NZ,(5)', '\tJR (6000H)', '\tDJNZ (6000H)', '\tIM (1)', '\tRST (8)', '\tBIT (1),A'));
  });
  zit('LD never falls back to the immediate', () => {
    bothReject(program('\tLD B,(5)'));
    bothReject(program('\tLD (HL),(5)'));
    bothReject(program('\tLD IXH,(5)'));
    bothReject(program('\tLD (IX+5),(3)'));
  });
  zit('JP (nn) draws a zmac warning, so an error here', () => {
    bothReject(program('\tJP (1234H)'));
  });
  zit('no form at all is rejected', () => {
    bothReject(program('\tLD (5),(6)'));
    bothReject(program('\tLD (5),5'));
    bothReject(program('\tPUSH (5)'));
    bothReject(program('\tINC (5)'));
    bothReject(program('\tRES 0,(5)'));
    bothReject(program('\tOUT (5),(6)'));
    bothReject(program('\tLD A,(C)'));
    bothReject(program('\tLD A,(IX+2)+1'));
    bothReject(program('\tLD A,(5+IX)'));
    bothReject(program('\tEX AF,AF'));
  });
  zit('register indirection and index forms', () => {
    same(program('\tLD A,(HL)', '\tLD A,( hl )', '\tLD A,(IX+5)', '\tLD A,(ix + 5)', '\tLD A,(IX+ -5)', '\tLD A,(IX-3)', '\tLD A,(IX)', '\tLD A,(IX+(2))', '\tJP (IX)', '\tJP (HL)', '\tEX (SP),IX', "\tEX AF,AF'"));
  });
});

const EXPRESSIONS = [
  '1+2*3', '1<<2+1', '2+1<<2', '6&3|8', '8|6&3', '6^3&1', '6&3^1', '5|3^6', '5^3|6',
  '7 MOD 4*2', '2*7 mod 4', '1+7 MOD 4', '7%4', '16>>2+1', '1<<4&16', '1 SHL 3', '16 SHR 2', '3 & 1 SHL 2',
  '8-2-1', '64/4/2', '7 MOD 4 MOD 2', '10/3', '(1+2)*3',
  '-2*3', '~0', '~1+1', '-1+5', '-7/2', '-7 MOD 2', '+5',
  'HIGH 1234H', 'LOW 1234H', 'high 1234h+1', 'low 1234h+1', '2*HIGH 1234H', 'HIGH(1234H)', 'LOW($)',
  '$', '$+2', '$+$', '$1234+$',
];

describe("zmac probe: operator precedence", () => {
  zit('every expression has the value zmac gives it', () => {
    same(program(...EXPRESSIONS.map((e) => `\tDW ${e}`)));
  });
  zit('division by zero is rejected', () => {
    bothReject(program('\tLD A,1/0'));
  });
});

describe('zmac probe: number forms', () => {
  zit('decimal, hex, binary, and octal', () => {
    same(program(...['255', '255D', '5d', '0FFH', '0ffh', '0abcdh', '0B101H', '$FF', '$f', '0xFF', '0X1f', '1010B', '1010b', '0b', '1b', '17O', '17q', '65535', '-32768', '$ff+0ffh'].map((n) => `\tDW ${n}`)));
  });
  zit('%1010, 0b101, FFH, and 1_000 are rejected', () => {
    bothReject(program('\tDW %1010'));
    bothReject(program('\tDW 0b101'));
    bothReject(program('\tDW FFH'));
    bothReject(program('\tDW 1_000'));
  });
});

describe('zmac probe: character literals', () => {
  zit("characters, '' and \"\" escapes, and strings in DB", () => {
    same(program("\tLD A,'A'", "\tLD A,'a'", "\tLD A,''''", '\tLD A,""', "\tLD HL,'AB'", "\tDW 'A'*2", "\tDB 'it''s',0", '\tDB "dq",0', '\tDB "a""b"', "\tDB ''", "\tDB 'A'+1,'BC'", "\tDB ';',0", '\tDEFM "hi"', '\tDEFB 1', '\tDEFW 1'));
  });
  zit("a two-character value that does not fit a byte is rejected", () => {
    bothReject(program("\tLD A,'ab'"));
  });
});

describe('zmac probe: out-of-range values', () => {
  zit('the limits themselves are accepted', () => {
    same(program('\tLD A,-128', '\tLD A,255', '\tOUT (255),A', '\tLD HL,-32768', '\tLD HL,65535', '\tLD A,(IX-128)', '\tLD A,(IX+127)', '\tRST 38H', '\tDB -128', '\tDW -32768', '\tJR $+129', '\tJR $-126'));
  });
  zit.each([
    'LD A,256', 'LD A,-129', 'OUT (256),A', 'OUT (-1),A', 'IN A,(300)', 'LD HL,65536', 'LD HL,-32769', 'LD HL,(65536)', 'LD A,(65536)',
    'RST 64', 'LD A,(IX+128)', 'LD A,(IX-129)', 'IM 3', 'BIT 8,A', 'BIT -1,A', 'JR $+130', 'JR $-127', 'DJNZ $+200',
    'DB 256', 'DB -129', 'DW 65536', 'DW -32769', 'LD (IX+5),256', 'SET 3,(IX+200)', 'JP NOWHERE',
  ])('%s is rejected', (line) => {
    bothReject(program(`\t${line}`));
  });
  zit('a JR across $FFFF is rejected', () => {
    bothReject(['\tORG 0FFF0H', '\tJR 0005H'].join('\n') + '\n');
    bothReject(['\tORG 0010H', '\tJR 0FFF8H'].join('\n') + '\n');
  });
});

describe('deliberately stricter than zmac', () => {
  // zmac assembles RST 1 to 7 as RST 8 to 38H (RST 1 is CF), silently. A
  // number that is not a restart address is almost always a slip, so the
  // assembler refuses it and says what zmac would have done.
  zit('RST 1 to 7', () => {
    expect(runZmac(program('\tRST 1')).bytes).toEqual([0xcf]);
    expect(errorsOf(assemble(program('\tRST 1'))).length).toBe(1);
  });
  // zmac wraps JP 65536 to JP 0 with no message, though LD HL,65536 is a Value error.
  zit('JP 65536', () => {
    expect(runZmac(program('\tJP 65536')).bytes).toEqual([0xc3, 0x00, 0x00]);
    expect(errorsOf(assemble(program('\tJP 65536'))).length).toBe(1);
  });
  // zmac takes HL, NZ, IX, AF, and I as labels, but not A, B, or SP; the
  // assembler refuses every register and condition name, so no operand is ambiguous.
  zit('HL and NZ as labels', () => {
    expect(runZmac(program('hl: nop', 'nz: nop')).clean).toBe(true);
    expect(errorsOf(assemble(program('hl: nop', 'nz: nop'))).length).toBe(2);
  });
  // zmac reads DB 'AB'+1 as two bytes 42H 42H; a string of more than one
  // character inside an expression is refused here instead of guessed at.
  zit("DB 'AB'+1", () => {
    expect(runZmac(program("\tDB 'AB'+1")).bytes).toEqual([0x42, 0x42]);
    expect(errorsOf(assemble(program("\tDB 'AB'+1"))).length).toBe(1);
  });
});
