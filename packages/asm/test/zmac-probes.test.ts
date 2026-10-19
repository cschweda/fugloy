/**
 * zmac probes: each question about zmac's syntax that the assembler had to
 * answer is asked of the pinned zmac here, and the assembler must agree.
 * Where zmac only warns, the assembler errors (the round-trip harness treats
 * any zmac warning as failure). The few places where the assembler is
 * deliberately stricter than zmac are pinned at the end, each with the reason.
 */
import { describe, expect, it } from 'vitest';
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

/**
 * zmac rejects `source` (an error or a warning), and the assembler gives an
 * error of the expected kind on the expected line (never a "not handled yet").
 */
function bothReject(source: string, kind: RegExp, line = 2): void {
  const z = runZmac(source);
  expect(z.clean, `zmac accepted:\n${source}`).toBe(false);
  const errors = errorsOf(assemble(source));
  const onLine = errors.filter((e) => e.startsWith(`${line}: `)).map((e) => e.slice(`${line}: `.length));
  expect(onLine.some((m) => kind.test(m) && !/not handled yet/.test(m)), `asm errors for:\n${source}\n${errors.join('\n')}`).toBe(true);
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
    bothReject(program('ld a,1'), /starts in column 1/);
    bothReject(program('jp 0'), /starts in column 1/);
  });
  zit('outside column 1, a word before an instruction is rejected', () => {
    bothReject(program('  foo\tNOP'), /^Unknown instruction FOO\. If FOO is a label/);
  });
  zit('outside column 1, a word alone draws a zmac warning, so an error here', () => {
    bothReject(program('  foo'), /^Unknown instruction FOO\. If FOO is a label/);
  });
  zit('outside column 1, a colon makes a label, and EQU needs no colon', () => {
    same(program('  bar: NOP', '\tJP bar', '  K EQU 5', '\tDB K'));
  });
  zit('A, B, and SP cannot be labels', () => {
    bothReject(program('a: nop'), /register name/);
    bothReject(program('b: nop'), /register name/);
    bothReject(program('sp: nop'), /register name/);
  });
  zit('HIGH and MOD cannot be labels', () => {
    bothReject(program('high: nop'), /operator in expressions/);
    bothReject(program('mod: nop'), /operator in expressions/);
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
    bothReject(program('\tLD B,(5)'), /^Only A can be loaded from an address/);
    bothReject(program('\tLD (HL),(5)'), /^Only A can be loaded from an address/);
    bothReject(program('\tLD IXH,(5)'), /^Only A can be loaded from an address/);
    bothReject(program('\tLD (IX+5),(3)'), /^Only A can be loaded from an address/);
  });
  zit('JP (nn) draws a zmac warning, so an error here', () => {
    bothReject(program('\tJP (1234H)'), /^JP \(1234H\) jumps to 1234H/);
  });
  zit('no form at all is rejected', () => {
    bothReject(program('\tLD (5),(6)'), /^LD has no form \(5\),\(6\)/);
    bothReject(program('\tLD (5),5'), /^LD has no form \(5\),5/);
    bothReject(program('\tPUSH (5)'), /^PUSH has no form \(5\)/);
    bothReject(program('\tINC (5)'), /^INC has no form \(5\)/);
    bothReject(program('\tRES 0,(5)'), /^RES has no form 0,\(5\)/);
    bothReject(program('\tOUT (5),(6)'), /^OUT has no form \(5\),\(6\)/);
    bothReject(program('\tLD A,(C)'), /^LD has no form A,\(C\)/);
    bothReject(program('\tLD A,(IX+2)+1'), /IX is a register/);
    bothReject(program('\tLD A,(5+IX)'), /IX is a register/);
    bothReject(program('\tEX AF,AF'), /^EX has no form AF,AF\./);
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
    bothReject(program('\tLD A,1/0'), /divides by zero/);
  });
});

describe('zmac probe: number forms', () => {
  zit('decimal, hex, binary, and octal', () => {
    same(program(...['255', '255D', '5d', '0FFH', '0ffh', '0abcdh', '0B101H', '$FF', '$f', '0xFF', '0X1f', '1010B', '1010b', '0b', '1b', '17O', '17q', '65535', '-32768', '$ff+0ffh'].map((n) => `\tDW ${n}`)));
  });
  zit('%1010, 0b101, FFH, and 1_000 are rejected', () => {
    bothReject(program('\tDW %1010'), /% as MOD/);
    bothReject(program('\tDW 0b101'), /0b101 is not a number/);
    bothReject(program('\tDW FFH'), /FFH is not defined/);
    bothReject(program('\tDW 1_000'), /1_000 is not a number/);
  });
});

// The emitter names ROM routines $KBWAIT, $JP2DOS, and so on (the Model III
// manual's spelling); the round-trip corpus found that the assembler read them as bad numbers.
describe('zmac probe: $ in names', () => {
  zit('$ and hex digits only is a number; $ and other name characters is a name', () => {
    same(program('$KB\tEQU 1234H', '\tDW $KB', '\tDW $FF', '$KBWAIT\tEQU 0049H', '\tCALL $KBWAIT', '\tJP $KBWAIT+1'));
  });
  zit('$ anywhere in a name, and $ alone is the address of the line', () => {
    same(program('A$B\tEQU 1', 'KB$\tEQU 2', '$$\tEQU 3', '$_X\tEQU 4', '\tDW A$B,KB$,$$,$_X', '$X:\tNOP', '\tDW $X', '\tDW $', '\tDW $+1', '\tLD A,($X)'));
  });
  zit('a name that is all hex digits after the $ draws a zmac warning, so an error here', () => {
    bothReject(program('$AB\tEQU 1234H', '\tDW 0'), /^\$AB is the hex number ABH, so it cannot be a name/);
  });
  zit('$1G and $0Q are names, so undefined ones are rejected', () => {
    bothReject(program('\tDW $1G'), /^\$1G is not defined/);
    bothReject(program('\tDW $0Q'), /^\$0Q is not defined/);
  });
  zit('$ followed by ., @, or a ? after a letter from G on starts a name', () => {
    same(program('$.X\tEQU 5', '$@\tEQU 6', '$?X\tEQU 7', '$G?\tEQU 8', '\tDB $.X,$@,$?X,$G?'));
  });
  zit('$FFH is a name, so an undefined one is rejected, with the fix', () => {
    bothReject(program('\tDW $FFH'), /^\$FFH is not defined\. A hex number takes \$ or H, not both/);
  });
  zit('$ with hex digits and a ? draws a zmac warning when defined (zmac reads ? as F), so an error here', () => {
    bothReject(program('$?\tEQU 5', '\tDB 0'), /^\$\? is neither a name nor a number/);
    bothReject(program('$A?\tEQU 5', '\tDB 0'), /^\$A\? is neither a name nor a number/);
    bothReject(program('$1?:\tNOP'), /^\$1\? is neither a name nor a number/);
  });
});

describe('zmac probe: 32-bit numbers', () => {
  zit('a number wraps to 32-bit two\'s complement: 0FFFFFFFFH is -1', () => {
    same(program('\tDW 0FFFFFFFFH', '\tLD A,0FFFFFFFFH', '\tDW -0FFFFFFFFH', '\tDW 0FFFF0000H>>16', '\tDW 4294967295', '\tDW 11111111111111111111111111111111B'));
  });
  zit('a hex, octal, or binary number past 32 bits is a zmac Digit error', () => {
    const TOO_LARGE = /is too large: numbers have 32 bits/;
    bothReject(program('\tDW 100000000H'), TOO_LARGE);
    bothReject(program('\tDW 100000000H+1'), TOO_LARGE);
    bothReject(program('\tDW 0x100000000'), TOO_LARGE);
    bothReject(program('\tDW $100000000'), TOO_LARGE);
    bothReject(program('\tDW 377777777770'), TOO_LARGE);
    bothReject(program('\tDW 111111111111111111111111111111111B'), TOO_LARGE);
    bothReject(program('\tDW 99999999999'), TOO_LARGE);
  });
});

// The final review found >> arithmetic where zmac's is logical: these gave
// different bytes with no message before the fix.
describe('zmac probe: shifts are logical on 32 bits', () => {
  zit('>> and SHR shift in zeros, so a negative value shifted right is positive', () => {
    same(program('\tDB -1>>31', '\tDB -1 SHR 31', '\tDB (-1>>1)>>30', '\tDB (1<<31)>>31', '\tDB 0FFFFFFF0H>>28', '\tDB 0-1>>28', '\tDB ~0>>28', '\tDB 0FFFFFFFFH>>31', '\tDB (80000000H/2)>>30', '\tDB 1 SHL 31 SHR 31', '\tDB 0-1 SHR 28'));
  });
  zit('the low bits agree either way, and a count of 0 or 31 is fine', () => {
    same(program('\tDW 80000000H>>16', '\tDW -1>>16', '\tDB 1<<30>>30', '\tDB -1>>0', '\tDB 1 SHL 0', '\tDB 1 SHR 31', '\tDW HIGH -2', '\tDB LOW -256', '\tDB HIGH 12345678H'));
  });
  zit('a logical shift that leaves a large value is out of range in a byte', () => {
    bothReject(program('\tDB -1>>1'), /DB takes bytes/);
    bothReject(program('\tDB -8>>1'), /DB takes bytes/);
  });
  zit('the other operators agree at the 32-bit edges', () => {
    same(program('\tDB -7/2', '\tDB -7 MOD 2', '\tDB 7 MOD -2', '\tDB -7 % 2', '\tDB 7/-2', '\tDB -7/-2', '\tDB ~0', '\tDW ~1', '\tDB HIGH -1', '\tDB LOW -1', '\tDB 80000000H*2', '\tDB (-80000000H)>>24', '\tDB HIGH 80000000H', '\tDB -1/2', '\tDB 0FFFFFFFFH+2', '\tDB 0FFFFFFFFH/2>>30', '\tDW -1 MOD 7'));
    bothReject(program('\tDB 7 MOD 0'), /divides by zero/);
  });
});

describe('zmac probe: the optional A of the 8-bit arithmetic', () => {
  zit('SUB, AND, OR, XOR, and CP may write A first', () => {
    same(program('\tSUB A,5', '\tAND A,5', '\tOR A,5', '\tXOR A,5', '\tCP A,5', '\tCP A,(HL)', '\tSUB A,B', '\tAND A,(IX+1)', '\tOR A,IXH', '\tXOR A,A', '\tCP A,(IY-2)', '\tSUB A,IXL', '\tCP A,(IX)'));
  });
  zit('ADD, ADC, and SBC may leave A out', () => {
    same(program('\tADD 5', '\tADC 5', '\tSBC 5', '\tADD B', '\tADC B', '\tSBC (HL)', '\tADD (IX+1)', '\tSBC IXH', '\tADC (IY)', '\tADD A', '\tAND A'));
  });
  zit('the fallback to the immediate works with the A too', () => {
    same(program('\tSUB A,(5)', '\tCP A,(5)', '\tADD (5)'));
  });
  zit('any other register in front, or on other instructions, is rejected', () => {
    bothReject(program('\tSUB B,5'), /^SUB has no form B,5\./);
    bothReject(program('\tSUB HL,DE'), /^SUB has no form HL,DE\./);
    bothReject(program('\tADD HL'), /^ADD has no form HL\./);
    bothReject(program('\tNEG A'), /^NEG has no form A\. NEG takes no operands/);
    bothReject(program('\tINC A,B'), /^INC has no form A,B\./);
  });
});

describe('zmac probe: character literals', () => {
  zit("characters, '' and \"\" escapes, and strings in DB", () => {
    same(program("\tLD A,'A'", "\tLD A,'a'", "\tLD A,''''", '\tLD A,""', "\tLD HL,'AB'", "\tDW 'A'*2", "\tDB 'it''s',0", '\tDB "dq",0', '\tDB "a""b"', "\tDB ''", "\tDB 'A'+1,'BC'", "\tDB ';',0", '\tDEFM "hi"', '\tDEFB 1', '\tDEFW 1'));
  });
  zit("a two-character value that does not fit a byte is rejected", () => {
    bothReject(program("\tLD A,'ab'"), /takes a byte/);
  });
});

describe('zmac probe: out-of-range values', () => {
  zit('the limits themselves are accepted', () => {
    same(program('\tLD A,-128', '\tLD A,255', '\tOUT (255),A', '\tLD HL,-32768', '\tLD HL,65535', '\tLD A,(IX-128)', '\tLD A,(IX+127)', '\tRST 38H', '\tDB -128', '\tDW -32768', '\tJR $+129', '\tJR $-126'));
  });
  const BYTE = /takes a byte, -128 to 255; .* is out of range/;
  const PORT = /takes a port, 0 to 255; .* is out of range/;
  const WORD = /takes (a word|an address), -32768 to 65535; .* is out of range/;
  const DISP = /displacement in \(I[XY]\+d\) runs from -128 to 127/;
  const REACH = /reaches 128 bytes either way/;
  zit.each([
    ['LD A,256', BYTE], ['LD A,-129', BYTE], ['OUT (256),A', PORT], ['OUT (-1),A', PORT], ['IN A,(300)', PORT],
    ['LD HL,65536', WORD], ['LD HL,-32769', WORD], ['LD HL,(65536)', WORD], ['LD A,(65536)', WORD],
    ['RST 64', /^RST takes 0, 8/], ['LD A,(IX+128)', DISP], ['LD A,(IX-129)', DISP], ['IM 3', /^IM takes 0, 1, or 2/],
    ['BIT 8,A', /bit number from 0 to 7/], ['BIT -1,A', /bit number from 0 to 7/], ['JR $+130', REACH], ['JR $-127', REACH], ['DJNZ $+200', REACH],
    ['DB 256', /^DB takes bytes/], ['DB -129', /^DB takes bytes/], ['DW 65536', /^DW takes words/], ['DW -32769', /^DW takes words/],
    ['LD (IX+5),256', BYTE], ['SET 3,(IX+200)', DISP], ['JP NOWHERE', /^NOWHERE is not defined/],
  ] as const)('%s is rejected', (line, kind) => {
    bothReject(program(`\t${line}`), kind);
  });
  zit('a JR across $FFFF is rejected', () => {
    bothReject(['\tORG 0FFF0H', '\tJR 0005H'].join('\n') + '\n', /cannot wrap around the top of memory/);
    bothReject(['\tORG 0010H', '\tJR 0FFF8H'].join('\n') + '\n', /cannot wrap around the top of memory/);
  });
});

/**
 * zmac assembles `source` cleanly, and the assembler gives the same image
 * (bitmap and bytes over all 64K), the same entry, and the same value for
 * every symbol in zmac's table (Review Focus 4: runtime labels).
 */
function sameImage(source: string): void {
  const z = runZmac(source);
  expect(z.clean, z.output).toBe(true);
  const r = assemble(source);
  expect(errorsOf(r), source).toEqual([]);
  const mine = r.image!;
  const theirs = z.image!;
  for (let a = 0; a < 0x10000; a++) {
    if (mine.loaded[a] !== theirs.loaded[a]) expect.fail(`loaded differs at ${a.toString(16)}: asm ${mine.loaded[a]}, zmac ${theirs.loaded[a]}`);
    if (theirs.loaded[a] === 1 && mine.bytes[a] !== theirs.bytes[a]) expect.fail(`byte differs at ${a.toString(16)}: asm ${mine.bytes[a]}, zmac ${theirs.bytes[a]}`);
  }
  expect(r.entry).toBe(z.entry);
  const values = new Map([...r.symbols].map(([k, v]) => [k.toUpperCase(), v.value]));
  for (const [name, value] of z.symbols) expect(values.get(name), name).toBe(value);
}

describe('zmac probe: ORG', () => {
  zit('several ORGs, with gaps, going down as well as up', () => {
    sameImage(program('\tDB 1', '\tORG 7000H', '\tDB 2', '\tORG 5FFFH', '\tDW 0302H', '\tORG 0FFFEH', '\tDB 1,2,3,4'));
  });
  zit('an ORG over bytes already placed: zmac is silent and the later bytes win', () => {
    sameImage(program('\tDB 1,2,3', '\tORG 6001H', '\tDB 9'));
    sameImage(program('\tDB 1,2', '\tORG 6000H', '\tDB 3,4'));
  });
  zit('a label on an ORG line takes the address before the ORG', () => {
    sameImage(program('\tNOP', 'LA\tORG 7000H', 'MB:\tORG 7100H', '\tDW LA,MB'));
  });
  zit('a label before the first ORG is 0, as zmac starts at 0 when an ORG comes later', () => {
    sameImage(['X\tEQU 5', 'Y:', '\tORG 6000H', '\tDW Y,X'].join('\n') + '\n');
  });
});

describe('zmac probe: EQU, DEFL, and =', () => {
  zit('an EQU may be repeated with the same value', () => {
    sameImage(program('K\tEQU 5', 'K\tEQU 5', '\tDB K', 'K\tEQU 2+3'));
  });
  zit('an EQU repeated with another value is rejected', () => {
    bothReject(program('K\tEQU 5', 'K\tEQU 6', '\tDB K'), /^K is defined twice with different values/, 3);
  });
  zit('DEFL and = redefine; each use takes the definition above it', () => {
    sameImage(program('X\tDEFL 1', '\tDB X', 'X\tDEFL X+1', '\tDB X', 'Y\t= 5', '\tDB Y', 'Y\t= 6', '\tDB Y', 'ZZ\tDEFL 9', 'ZZ\t=10', '\tDB ZZ', 'W\tdefl $', '\tDW W'));
  });
  zit('a use above every DEFL takes the last one', () => {
    sameImage(program('\tDB K', 'K\tDEFL 5', '\tDB K', 'K\tDEFL 6'));
  });
  zit('EQU and DEFL, or DEFL and a label, cannot share a name', () => {
    bothReject(program('K\tEQU 5', 'K\tDEFL 6'), /^K is defined twice/, 3);
    bothReject(program('K\tDEFL 5', 'K\tEQU 6'), /^K is defined twice/, 3);
    bothReject(program('K\tDEFL 5', 'K:\tNOP'), /^K is defined twice/, 3);
  });
});

describe('zmac probe: DB, DW, and DS', () => {
  zit('strings and expressions mixed', () => {
    sameImage(program("\tDB 'HI',0DH,'A'+1,\"x\",-1", "\tDEFM 'ok',0", "\tDEFB 1,'''',2", "\tDW 'A',1234H,$", '\tDEFW -1'));
  });
  zit('DS leaves a gap, and with a fill byte writes it', () => {
    sameImage(program('\tDB 1', 'BUF:\tDS 3', '\tDW BUF', 'BUF2\tDS 2,7', "\tDEFS 2,'A'", '\tDS 1,7FH', '\tDS 1,0', '\tDS 0', '\tDW BUF2,$', '\tDS 4'));
  });
  zit('in DB and DW, $ is the address of each value', () => {
    sameImage(program('\tDB 1,LOW $,2,LOW $', '\tDW 5,$,$', "\tDB 'AB',LOW $", "\tDEFM 'AB',LOW $"));
  });
  zit('a DS fill outside 0 to 127, a negative count, or a third operand is rejected', () => {
    bothReject(program('\tDS 2,80H'), /^DS fills with a byte from 0 to 127/);
    bothReject(program('\tDS 2,0FFH'), /^DS fills with a byte from 0 to 127/);
    // zmac writes FF for DS 2,-1 but reports a "Phase error".
    bothReject(program('\tDS 2,-1'), /^DS fills with a byte from 0 to 127/);
    bothReject(program('\tDS -1'), /^DS reserves 0 to 65535 bytes/);
    bothReject(program('\tDS 3,1,2'), /^DS takes a count and at most one fill byte/);
  });
});

describe('zmac probe: .PHASE and .DEPHASE (Review Focus 4)', () => {
  zit('phased code: bytes at the load address, labels and $ at the run address', () => {
    sameImage(program('START:\tLD HL,SRC', '\tJP RUN', 'SRC:', '\t.PHASE 4000H', 'RUN:\tNOP', 'LOOP:\tJR LOOP', '\tDW $', '\tJP RUN', '\t.DEPHASE', 'AFTER:\tDW $,RUN,SRC,AFTER', '\tEND START'));
  });
  zit('a label on .PHASE takes the load address; one on .DEPHASE the run address', () => {
    sameImage(program('\tNOP', 'PL:\t.PHASE 4000H', '\tNOP', 'DP:\t.DEPHASE', '\tDW PL,DP'));
  });
  zit('inside .PHASE, DS with no fill writes zeros', () => {
    sameImage(program('\t.PHASE 4000H', '\tDS 2', '\tDB 1', '\t.DEPHASE', '\tDB 2'));
  });
  zit('a .PHASE left open at the end is accepted', () => {
    sameImage(program('\t.PHASE 4000H', '\tNOP'));
  });
  zit('an ORG inside .PHASE, a nested .PHASE, and a stray .DEPHASE are rejected', () => {
    bothReject(program('\t.PHASE 4000H', '\tNOP', '\tORG 7000H', '\tNOP', '\t.DEPHASE'), /^ORG cannot be used inside \.PHASE/, 4);
    bothReject(program('\t.PHASE 4000H', '\tNOP', '\t.PHASE 5000H', '\t.DEPHASE'), /^\.PHASE is already in effect since line 2/, 4);
    bothReject(program('\t.DEPHASE', '\tNOP'), /^\.DEPHASE has no \.PHASE to end/);
  });
});

describe('zmac probe: END', () => {
  zit('END with an entry, an expression, or none', () => {
    sameImage(program('S:\tNOP', '\tEND S'));
    sameImage(program('S\tNOP', '\tEND S+1'));
    sameImage(program('\tNOP', '\tEND'));
    sameImage(program('\tNOP'));
  });
  zit('text after END is ignored, junk included', () => {
    sameImage(program('S:\tNOP', '\tEND S', '\tDB 1', '\tthis is junk ((', 'S:\tNOP'));
  });
  zit('a label on the END line is an ordinary label', () => {
    sameImage(program('S\tNOP', 'LAB\tEND S'));
  });
  zit('END cannot name a label after it, which zmac never reads', () => {
    bothReject(program('\tNOP', '\tEND LATER', 'LATER\tNOP'), /^LATER is not defined/, 3);
  });
});

describe('deliberately stricter than zmac', () => {
  // zmac divides in a C int, where -80000000H / -1 and its MOD are undefined:
  // on x86 zmac traps, on ARM it wraps. With no one answer, the assembler refuses.
  it('-80000000H divided by -1', () => {
    for (const line of ['\tDB (80000000H/-1)&0FFH', '\tDB 80000000H MOD -1', '\tDW -80000000H/-1']) {
      const errs = errorsOf(assemble(program(line)));
      expect(errs.length).toBe(1);
      expect(errs[0]).toMatch(/overflows 32 bits/);
    }
  });
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
  // zmac resolves X EQU Y / Y EQU X without a message; a definition
  // that depends on itself has no value, so the assembler names the loop.
  zit('a circular EQU', () => {
    const src = program('X\tEQU Y', 'Y\tEQU X', '\tDB X');
    expect(runZmac(src).clean).toBe(true);
    expect(errorsOf(assemble(src))).toEqual(['2: X is defined in terms of itself: X → Y → X.']);
  });
  // zmac wraps a decimal number from 2^32 up to some larger bound silently
  // (4294967296 is 0, 4294967297 is 1) but calls 99999999999 a Digit error, as
  // it does every hex, octal, or binary number past 32 bits; the assembler
  // treats every number past 32 bits alike.
  zit('a decimal number just past 32 bits', () => {
    expect(runZmac(program('\tDW 4294967297')).bytes).toEqual([0x01, 0x00]);
    expect(errorsOf(assemble(program('\tDW 4294967297')))).toEqual(['2: 4294967297 is too large: numbers have 32 bits, at most 0FFFFFFFFH (4294967295).']);
  });
  // zmac does not range-check a DB value that comes from an address (a
  // label or $): DB LAB stores the low byte, though DB 6000H and LD A,LAB are
  // Value errors. The assembler checks every DB value alike; write LOW LAB.
  zit('DB of an address', () => {
    const src = program('LAB:\tDB LAB', '\tDB 2*$');
    expect(runZmac(src).bytes).toEqual([0x00, 0x02]);
    expect(errorsOf(assemble(src)).length).toBe(2);
  });
  zit("DB 'AB'+1", () => {
    expect(runZmac(program("\tDB 'AB'+1")).bytes).toEqual([0x42, 0x42]);
    expect(errorsOf(assemble(program("\tDB 'AB'+1"))).length).toBe(1);
  });
  // zmac places code that comes before the first ORG at 0000H, where the
  // ROM is; that is never meant, so the assembler asks for the ORG first.
  zit('code before the first ORG', () => {
    const src = ['\tNOP', '\tORG 6000H', '\tNOP'].join('\n') + '\n';
    expect(runZmac(src).image!.loaded[0]).toBe(1);
    expect(errorsOf(assemble(src))).toEqual(['1: This line comes before the first ORG, so zmac would put it at $0000. Put the ORG first.']);
  });
  // zmac's extra passes let DS, ORG, and .PHASE use a name defined below
  // them; here the addresses after the line depend on it, so it must come
  // first (Review Focus 2), never a silent zero.
  zit('a forward EQU in DS, ORG, or .PHASE', () => {
    const ds = program('\tDS N', '\tNOP', 'N\tEQU 2');
    expect(runZmac(ds).clean).toBe(true);
    expect(errorsOf(assemble(ds))).toEqual(['2: DS cannot use N before N is defined, because the addresses after this line depend on it. Define N above the DS.']);
    const org = ['\tORG N', '\tNOP', 'N\tEQU 6000H'].join('\n') + '\n';
    expect(runZmac(org).clean).toBe(true);
    expect(errorsOf(assemble(org))).toEqual(['1: ORG cannot use N before N is defined, because the addresses after this line depend on it. Define N above the ORG.']);
    const phase = program('\t.PHASE X', '\tNOP', '\t.DEPHASE', 'X\tEQU 4000H');
    expect(runZmac(phase).clean).toBe(true);
    expect(errorsOf(assemble(phase))).toEqual(['2: .PHASE cannot use X before X is defined, because the addresses after this line depend on it. Define X above the .PHASE.']);
  });
  // A DS (or ORG) count that reaches a DEFL through an EQU or another DEFL
  // defined above its first definition: zmac's extra passes size it with the
  // last DEFL in the file (DS 100 here). Pass 1 cannot know that value, so the
  // assembler refuses rather than size it differently (Review Focus 2).
  zit('a DEFL reached before its first definition sizes a DS', () => {
    const viaEqu = program('N\tEQU X', 'X\tDEFL 1', '\tDS N', '\tDB 0AAH', 'X\tDEFL 100', '\tDW N');
    const z = runZmac(viaEqu);
    expect(z.clean, z.output).toBe(true);
    expect(z.image!.bytes[0x6064]).toBe(0xaa);
    expect(z.image!.loaded[0x6001]).toBe(0);
    expect(errorsOf(assemble(viaEqu))).toEqual(['4: DS cannot use N here: N uses X on line 2, before X is defined on line 3, and the addresses after this line depend on it. Define X above line 2.']);
    const deflOnly = program('Y\tDEFL X', 'X\tDEFL 1', '\tDS Y', '\tDB 0AAH', 'X\tDEFL 100');
    const zd = runZmac(deflOnly);
    expect(zd.clean, zd.output).toBe(true);
    expect(zd.image!.bytes[0x6064]).toBe(0xaa);
    expect(errorsOf(assemble(deflOnly))).toEqual(['4: DS cannot use Y here: Y uses X on line 2, before X is defined on line 3, and the addresses after this line depend on it. Define X above line 2.']);
  });
  // The spellings below were found by negative.test.ts's mnemonic and operand
  // grid. zmac reads each one, but the assembler takes only the forms
  // @fugloy/z80's tables give, so it refuses them and gives the exact rewrite
  // (diagnostics.test.ts checks that each rewrite assembles to zmac's bytes
  // here). The emitter never writes any of them.
  // ED 70H and 71H: the tables keep them as DB (Task 1 ruling), and the message gives that DB.
  zit('IN (C) and OUT (C),0', () => {
    expect(runZmac(program('\tIN (C)', '\tOUT (C),0')).bytes).toEqual([0xed, 0x70, 0xed, 0x71]);
    expect(errorsOf(assemble(program('\tIN (C)', '\tOUT (C),0')))).toEqual([
      '2: IN (C) is undocumented, and Fugløy writes it as DB 0EDH,70H; use that instead.',
      '3: OUT (C),0 is undocumented, and Fugløy writes it as DB 0EDH,71H; use that instead.',
    ]);
  });
  zit('IN F,(C)', () => {
    expect(runZmac(program('\tIN F,(C)')).bytes).toEqual([0xed, 0x70]);
    expect(errorsOf(assemble(program('\tIN F,(C)')))).toEqual(['2: IN F,(C) is undocumented, and Fugløy writes it as DB 0EDH,70H; use that instead.']);
  });
  // zmac stores a string's UTF-8 bytes; the assembler asks for the code as a number.
  zit('characters outside ASCII in a string', () => {
    expect(runZmac(program("\tDB 'é'")).bytes).toEqual([0xc3, 0xa9]);
    expect(errorsOf(assemble(program("\tDB 'é'")))).toEqual(['2: This string holds é, which is not plain ASCII; write its code as a number instead.']);
  });
  zit('IN and OUT with the port alone', () => {
    expect(runZmac(program('\tIN 38H', '\tOUT (12H)')).bytes).toEqual([0xdb, 0x38, 0xd3, 0x12]);
    expect(errorsOf(assemble(program('\tIN 38H', '\tOUT (12H)')))).toEqual(['2: IN needs A and the port in parentheses: write IN A,(38H).', '3: OUT needs the port in parentheses and then A: write OUT (12H),A.']);
  });
  zit('JP HL and JP IX without parentheses', () => {
    expect(runZmac(program('\tJP HL', '\tJP IX')).bytes).toEqual([0xe9, 0xdd, 0xe9]);
    expect(errorsOf(assemble(program('\tJP HL', '\tJP IX'))).map((e) => e.replace(/^.* write /, ''))).toEqual(['JP (HL).', 'JP (IX).']);
  });
  zit("PUSH and POP of A, B, H, or AF'", () => {
    expect(runZmac(program('\tPOP A', '\tPUSH B', '\tPUSH H', "\tPUSH AF'")).bytes).toEqual([0xf1, 0xc5, 0xe5, 0xf5]);
    expect(errorsOf(assemble(program('\tPOP A', '\tPUSH B', '\tPUSH H', "\tPUSH AF'"))).map((e) => e.replace(/^.* write /, ''))).toEqual(['POP AF.', 'PUSH BC.', 'PUSH HL.', 'PUSH AF.']);
  });
  // The 8080 name M for (HL), which zmac reads after these five but not after AND, OR, or XOR.
  zit('ADD M, ADC M, SUB M, SBC M, and CP M', () => {
    const src = program('\tADD M', '\tADC M', '\tSUB M', '\tSBC M', '\tCP M');
    expect(runZmac(src).bytes).toEqual([0x86, 0x8e, 0x96, 0x9e, 0xbe]);
    expect(errorsOf(assemble(src)).map((e) => e.replace(/^.* write /, ''))).toEqual(['ADD A,(HL).', 'ADC A,(HL).', 'SUB (HL).', 'SBC A,(HL).', 'CP (HL).']);
  });
  // The undocumented DD CB copies to a register: the tables keep them as DB.
  zit('RL (IX+5),B and the other DD CB / FD CB register copies', () => {
    expect(runZmac(program('\tRL (IX+5),B', '\tSRL (IY),A')).bytes).toEqual([0xdd, 0xcb, 0x05, 0x10, 0xfd, 0xcb, 0x00, 0x3f]);
    expect(errorsOf(assemble(program('\tRL (IX+5),B', '\tSRL (IY),A'))).map((e) => e.replace(/^.* write /, ''))).toEqual(['DB 0DDH,0CBH,05H,10H.', 'DB 0FDH,0CBH,00H,3FH.']);
  });
  // zmac reads ? as the hex digit F after $ (and in a number: 1?H is 1FH), so
  // DB $? is DB 0FH. The assembler refuses a ? among hex digits.
  zit('$? and $A? as numbers', () => {
    expect(runZmac(program('\tDB $?', '\tDB $A?', '\tDW 1?H')).bytes).toEqual([0x0f, 0xaf, 0x1f, 0x00]);
    expect(errorsOf(assemble(program('\tDB $?', '\tDB $A?', '\tDW 1?H'))).length).toBe(3);
  });
  // zmac reads the 8080's MOV and MVI too; the assembler gives the LD to write.
  zit('MOV and MVI', () => {
    const src = program('\tMOV A,B', '\tMOV M,A', '\tMVI A,5');
    expect(runZmac(src).bytes).toEqual([0x78, 0x77, 0x3e, 0x05]);
    expect(errorsOf(assemble(src)).map((e) => e.replace(/^.* write /, ''))).toEqual(['LD A,B.', 'LD (HL),A.', 'LD A,5.']);
    expect(bytesOf(program('\tLD A,B', '\tLD (HL),A', '\tLD A,5'))).toEqual(runZmac(src).bytes);
  });
  // A shift count outside 0 to 31 is C's undefined behaviour in zmac: the
  // pinned build wraps some counts and not others.
  zit('a shift count outside 0 to 31', () => {
    expect(runZmac(program('\tDB 1<<32', '\tDB 1 SHL 33', '\tDB -1>>32', '\tDB 7>>-1')).bytes).toEqual([0x01, 0x02, 0x00, 0x00]);
    expect(errorsOf(assemble(program('\tDB 1<<32', '\tDB 1 SHL 33', '\tDB -1>>32', '\tDB 7>>-1', '\tLD A,(IX-8>>1)')))).toEqual([
      '2: A shift count runs from 0 to 31; 32 is out of range.',
      '3: A shift count runs from 0 to 31; 33 is out of range.',
      '4: A shift count runs from 0 to 31; 32 is out of range.',
      '5: A shift count runs from 0 to 31; -1 is out of range.',
      '6: The displacement in (IX+d) runs from -128 to 127; 2147483644 ($7FFFFFFC) is out of range.',
    ]);
  });
  // An EQU that names a label below the DS it sizes: the pinned zmac does not
  // finish (it crashes), so there is no zmac image to differ from.
  zit('an EQU of a later label sizing a DS', () => {
    const src = program('N\tEQU LBL', '\tDS N', 'LBL:\tNOP');
    expect(runZmac(src).clean).toBe(false);
    expect(errorsOf(assemble(src))).toEqual(['3: DS cannot use LBL before LBL is defined, because the addresses after this line depend on it. Define LBL above the DS.']);
  });
});
