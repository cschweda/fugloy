/**
 * Directives, the image, the listing, and the source map. What zmac does in
 * each case is pinned in zmac-probes.test.ts; these tests fix the exact
 * values, messages, and the listing and source map that zmac has no
 * counterpart for.
 */
import { describe, expect, it } from 'vitest';
import { assemble, DEFAULT_ORIGIN } from '../src/index.js';
import type { AsmResult } from '../src/index.js';
import { bytesOf, diagnosticsOf, errorsOf } from './helpers.js';

const program = (...lines: string[]): string => ['\tORG 6000H', ...lines].join('\n') + '\n';

/** The image's loaded runs as [start, bytes]. */
function runsOf(r: AsmResult): [number, number[]][] {
  expect(errorsOf(r)).toEqual([]);
  return r.image!.runs().map((run) => [run.start, Array.from(r.image!.bytes.subarray(run.start, run.end + 1))]);
}

const valueOf = (r: AsmResult, name: string): number | undefined => r.symbols.get(name)?.value;

describe('ORG', () => {
  it('places code at each ORG, leaving gaps unloaded', () => {
    const r = assemble(program('\tDB 1', '\tORG 7000H', '\tDB 2,3', '\tORG 5FFFH', '\tDW 0302H'));
    expect(runsOf(r)).toEqual([
      [0x5fff, [0x02, 0x03]],
      [0x7000, [0x02, 0x03]],
    ]);
    // $6000 holds 03 from the DW at $5FFF, which overwrote the DB 1.
  });
  it('an ORG over bytes already placed: the later bytes win, with a warning naming both lines', () => {
    const r = assemble(program('\tDB 1,2,3', '\tORG 6001H', '\tDB 9'));
    expect(runsOf(r)).toEqual([[0x6000, [1, 9, 3]]]);
    expect(diagnosticsOf(r)).toEqual(['4:2-6 warning: Line 4 writes over $6001, which line 2 already filled; the later bytes win, as in zmac.']);
  });
  it('the overlap warning gives the whole range', () => {
    const r = assemble(program('\tDB 1,2,3,4', '\tORG 6001H', '\tDB 7,8'));
    expect(diagnosticsOf(r)).toEqual(['4:2-8 warning: Line 4 writes over $6001 to $6002, which line 2 already filled; the later bytes win, as in zmac.']);
  });
  it('a label on an ORG line takes the address before the ORG, with a warning that says how to name the new one', () => {
    const r = assemble(program('\tNOP', 'LA\tORG 7000H', '\tNOP'));
    expect(valueOf(r, 'LA')).toBe(0x6001);
    expect(diagnosticsOf(r)).toEqual(['3:1-3 warning: LA is $6001, the address before this ORG, as in zmac. To name $7000, put LA on the line after the ORG.']);
  });
  it('ORG takes one address in range', () => {
    expect(errorsOf(assemble('\tORG 10000H\n'))).toEqual(['1: ORG takes an address, 0 to 65535; 65536 ($10000) is out of range.']);
    expect(errorsOf(assemble('\tORG\n'))).toEqual(['1: ORG needs an address after it.']);
  });
});

describe('Ruling 4: where a program starts', () => {
  it('with no ORG anywhere, the program starts at $5200 with an info note', () => {
    const r = assemble('\tNOP\n\tRET\n');
    expect(DEFAULT_ORIGIN).toBe(0x5200);
    expect(runsOf(r)).toEqual([[0x5200, [0x00, 0xc9]]]);
    expect(diagnosticsOf(r)).toEqual(['1:1-5 info: There is no ORG, so the program starts at $5200.']);
    expect(r.entry).toBeNull();
  });
  it('with an ORG later, code before it is an error that asks for the ORG first', () => {
    const r = assemble('\tNOP\n\tDS 2\n\tORG 6000H\n\tNOP\n');
    expect(errorsOf(r)).toEqual([
      '1: This line comes before the first ORG, so zmac would put it at $0000. Put the ORG first.',
      '2: This line comes before the first ORG, so zmac would put it at $0001. Put the ORG first.',
    ]);
    expect(r.image).toBeNull();
  });
  it('a source that places nothing gets no note', () => {
    expect(diagnosticsOf(assemble('K\tEQU 5\nX\tDEFL 1\n'))).toEqual([]);
  });
  it('a label alone, with no ORG, does get the note', () => {
    expect(diagnosticsOf(assemble('START:\n'))).toEqual(['1:1-7 info: There is no ORG, so the program starts at $5200.']);
  });
  it('with an ORG later, a label and an EQU before it are fine; the label is 0, as in zmac', () => {
    const r = assemble('X\tEQU 5\nY:\n\tORG 6000H\n\tDW Y,X\n');
    expect(runsOf(r)).toEqual([[0x6000, [0, 0, 5, 0]]]);
    expect(diagnosticsOf(r)).toEqual([]);
  });
});

describe('EQU', () => {
  it('defines a value, forward references included', () => {
    const r = assemble(program('\tLD A,K', 'K\tEQU 2*J', 'J\tEQU 21'));
    expect(runsOf(r)).toEqual([[0x6000, [0x3e, 42]]]);
    expect(r.symbols.get('K')).toEqual({ value: 42, line: 3, kind: 'equ' });
  });
  it('may be repeated with the same value', () => {
    const r = assemble(program('K\tEQU 5', 'K\tEQU 2+3', '\tDB K'));
    expect(runsOf(r)).toEqual([[0x6000, [5]]]);
    expect(r.symbols.get('K')).toEqual({ value: 5, line: 2, kind: 'equ' });
  });
  it('repeated with another value is an error naming both lines and values', () => {
    expect(errorsOf(assemble(program('K\tEQU 5', 'K\tEQU 6', '\tDB K')))).toEqual(['3: K is defined twice with different values, 5 on line 2 and 6 on line 3. Rename one of them.']);
  });
  it('shows its value in the listing', () => {
    const r = assemble(program('K\tEQU 3C00H'));
    expect(r.listing[1]).toEqual({ line: 2, address: null, load: null, bytes: [], text: 'K\tEQU 3C00H', value: 0x3c00 });
  });
});

describe('DEFL and =', () => {
  it('redefine a name; each use takes the definition above it', () => {
    const r = assemble(program('X\tDEFL 1', '\tDB X', 'X\tDEFL X+1', '\tDB X', 'Y\t= 5', '\tDB Y', 'Y\t= 6', '\tDB Y'));
    expect(runsOf(r)).toEqual([[0x6000, [1, 2, 5, 6]]]);
    // The value and the line come from the same (last) definition.
    expect(r.symbols.get('X')).toEqual({ value: 2, line: 4, kind: 'defl' });
  });
  it('a use above every definition takes the last one, as zmac does', () => {
    expect(bytesOf(program('\tDB K', 'K\tDEFL 5', 'K\tDEFL 6'))).toEqual([6]);
  });
  it('DEFL may refer to a label defined below it', () => {
    expect(bytesOf(program('X\tDEFL LBL+1', '\tDW X', 'LBL:\tNOP'))).toEqual([0x03, 0x60, 0x00]);
  });
  it('DEFL and EQU cannot share a name', () => {
    expect(errorsOf(assemble(program('K\tEQU 5', 'K\tDEFL 6')))).toEqual(['3: K is defined twice, on lines 2 and 3. Rename one of them.']);
    expect(errorsOf(assemble(program('K\tDEFL 5', 'K:\tNOP')))).toEqual(['3: K is defined twice, on lines 2 and 3. Rename one of them.']);
  });
  it('shows each value in the listing', () => {
    const r = assemble(program('X\tDEFL 1', 'X\tDEFL X+1'));
    expect(r.listing.map((l) => l.value)).toEqual([undefined, 1, 2]);
  });
  it('needs a name', () => {
    expect(errorsOf(assemble(program('\tDEFL 5')))).toEqual(['2: DEFL needs a name in front of it, as in COUNT DEFL 0.']);
  });
});

describe('DB, DEFB, DEFM, DW, DEFW', () => {
  it('$ is the address of each value', () => {
    expect(bytesOf(program('\tDB 1,LOW $,2,LOW $', '\tDW 5,$'))).toEqual([1, 0x01, 2, 0x03, 5, 0, 0x06, 0x60]);
  });
  it('mix strings and expressions', () => {
    expect(bytesOf(program("\tDB 'HI',0DH,'A'+1,\"x\",-1", "\tDEFM 'ok',0", "\tDEFB 1,'''',2", "\tDW 'A',1234H,$", '\tDEFW -1'))).toEqual([
      0x48, 0x49, 0x0d, 0x42, 0x78, 0xff, 0x6f, 0x6b, 0x00, 0x01, 0x27, 0x02, 0x41, 0x00, 0x34, 0x12, 0x10, 0x60, 0xff, 0xff,
    ]);
  });
});

describe('DS and DEFS', () => {
  it('leaves a gap without a fill, and writes the fill with one', () => {
    const r = assemble(program('\tDB 1', 'BUF:\tDS 3', '\tDB 2', "\tDEFS 2,'A'", '\tDS 1,7FH', '\tDS 0', '\tDB LOW $', '\tDS 4'));
    expect(runsOf(r)).toEqual([
      [0x6000, [1]],
      [0x6004, [2, 0x41, 0x41, 0x7f, 0x08]],
    ]);
    expect(valueOf(r, 'BUF')).toBe(0x6001);
    expect(r.listing[2]).toEqual({ line: 3, address: 0x6001, load: 0x6001, bytes: [], text: 'BUF:\tDS 3' });
  });
  it('rejects a bad count or fill, saying the limit', () => {
    expect(errorsOf(assemble(program('\tDS -1')))).toEqual(['2: DS reserves 0 to 65535 bytes; -1 is out of range.']);
    expect(errorsOf(assemble(program('\tDS 2,80H')))).toEqual(['2: DS fills with a byte from 0 to 127, as zmac requires; 128 ($80) is out of range. Write the bytes with DB instead.']);
    expect(errorsOf(assemble(program('\tDS 2,-1')))).toEqual(['2: DS fills with a byte from 0 to 127, as zmac requires; -1 is out of range. Write the bytes with DB instead.']);
    expect(errorsOf(assemble(program('\tDS 2,300')))).toEqual(['2: DS fills with a byte from 0 to 127, as zmac requires; 300 ($012C) is out of range.']);
    expect(errorsOf(assemble(program('\tDS 3,1,2')))).toEqual(['2: DS takes a count and at most one fill byte, as in DS 10 or DS 10,0.']);
    expect(errorsOf(assemble(program('\tDS')))).toEqual(['2: DS needs a count after it, as in DS 10.']);
    expect(errorsOf(assemble(program('\tDS A')))).toEqual(['2: DS needs a count; A is a register.']);
  });
  it('a forward EQU in the count is an error (Review Focus 2), but in the fill it is fine', () => {
    expect(errorsOf(assemble(program('\tDS N', '\tNOP', 'N\tEQU 2')))).toEqual([
      '2: DS cannot use N before N is defined, because the addresses after this line depend on it. Define N above the DS.',
    ]);
    expect(bytesOf(program('\tDS 2,FILL', 'FILL\tEQU 7'))).toEqual([7, 7]);
  });
  it('a count that reaches a later name through an EQU or DEFL is an error at the DS operand (Review Focus 2)', () => {
    expect(diagnosticsOf(assemble(program('N\tEQU LBL', '\tDS N', 'LBL:\tNOP')))).toEqual([
      '3:5-6 error: DS cannot use LBL before LBL is defined, because the addresses after this line depend on it. Define LBL above the DS.',
    ]);
    expect(errorsOf(assemble(program('N\tEQU X', 'X\tDEFL 1', '\tDS N', '\tDB 0AAH', 'X\tDEFL 100', '\tDW N')))).toEqual([
      '4: DS cannot use N here: N uses X on line 2, before X is defined on line 3, and the addresses after this line depend on it. Define X above line 2.',
    ]);
    expect(errorsOf(assemble(program('Y\tDEFL X', 'X\tDEFL 1', '\tDS Y', 'X\tDEFL 100')))).toEqual([
      '4: DS cannot use Y here: Y uses X on line 2, before X is defined on line 3, and the addresses after this line depend on it. Define X above line 2.',
    ]);
    expect(errorsOf(assemble(program('N\tEQU X', 'X\tDEFL 1', '\tORG N')))).toEqual([
      '4: ORG cannot use N here: N uses X on line 2, before X is defined on line 3, and the addresses after this line depend on it. Define X above line 2.',
    ]);
  });
  it('a DEFL defined above the DS sizes it with the definition above it', () => {
    expect(runsOf(assemble(program('X\tDEFL 1', '\tDS X', '\tNOP', 'X\tDEFL 100')))).toEqual([[0x6001, [0]]]);
  });
  it('a count from an EQU above works', () => {
    expect(runsOf(assemble(program('N\tEQU 2', '\tDS N', '\tNOP')))).toEqual([[0x6002, [0]]]);
  });
});

describe('.PHASE and .DEPHASE', () => {
  const PHASED = program('START:\tLD HL,SRC', '\tJP RUN', 'SRC:', '\t.PHASE 4000H', 'RUN:\tNOP', 'LOOP:\tJR LOOP', '\tDW $', '\t.DEPHASE', 'AFTER:\tDW $', '\tEND START');

  it('puts the bytes at the load address and the labels and $ at the run address', () => {
    const r = assemble(PHASED);
    expect(runsOf(r)).toEqual([[0x6000, [0x21, 0x06, 0x60, 0xc3, 0x00, 0x40, 0x00, 0x18, 0xfe, 0x03, 0x40, 0x0b, 0x60]]]);
    expect(valueOf(r, 'RUN')).toBe(0x4000);
    expect(valueOf(r, 'LOOP')).toBe(0x4001);
    expect(valueOf(r, 'SRC')).toBe(0x6006);
    expect(valueOf(r, 'AFTER')).toBe(0x600b);
    expect(r.entry).toBe(0x6000);
  });
  it('the listing shows both addresses', () => {
    const r = assemble(PHASED);
    expect(r.listing[6]).toEqual({ line: 7, address: 0x4001, load: 0x6007, bytes: [0x18, 0xfe], text: 'LOOP:\tJR LOOP' });
    expect(r.listing[9]).toEqual({ line: 10, address: 0x600b, load: 0x600b, bytes: [0x0b, 0x60], text: 'AFTER:\tDW $' });
  });
  it('the source map is keyed by the run address', () => {
    const r = assemble(PHASED);
    expect(r.sourceMap.lineOf(0x4001)).toBe(7);
    expect(r.sourceMap.lineOf(0x4002)).toBe(7);
    expect(r.sourceMap.addressesOf(7)).toEqual([0x4001, 0x4002]);
    expect(r.sourceMap.lineOf(0x6007)).toBeNull();
  });
  it('inside .PHASE, DS with no fill writes zeros, as zmac does', () => {
    expect(runsOf(assemble(program('\t.PHASE 4000H', '\tDS 2', '\tDB 1', '\t.DEPHASE', '\tDB 2')))).toEqual([[0x6000, [0, 0, 1, 2]]]);
  });
  it('rejects ORG inside .PHASE, a nested .PHASE, and a stray .DEPHASE', () => {
    expect(errorsOf(assemble(program('\t.PHASE 4000H', '\tORG 7000H', '\t.DEPHASE')))).toEqual(['3: ORG cannot be used inside .PHASE (line 2). End it with .DEPHASE first.']);
    expect(errorsOf(assemble(program('\t.PHASE 4000H', '\t.PHASE 5000H', '\t.DEPHASE')))).toEqual(['3: .PHASE is already in effect since line 2. End it with .DEPHASE first.']);
    expect(errorsOf(assemble(program('\t.DEPHASE')))).toEqual(['2: .DEPHASE has no .PHASE to end.']);
  });
  it('.PHASE needs an address, defined above it', () => {
    expect(errorsOf(assemble(program('\t.PHASE')))).toEqual(['2: .PHASE needs an address after it.']);
    expect(errorsOf(assemble(program('\t.PHASE 10000H')))).toEqual(['2: .PHASE takes an address, 0 to 65535; 65536 ($10000) is out of range.']);
  });
});

describe('END', () => {
  it('gives the entry', () => {
    expect(assemble(program('S:\tNOP', '\tEND S')).entry).toBe(0x6000);
    expect(assemble(program('S:\tNOP', '\tEND S+1')).entry).toBe(0x6001);
  });
  it('without an entry, or with no END, the entry is null', () => {
    expect(assemble(program('\tNOP', '\tEND')).entry).toBeNull();
    expect(assemble(program('\tNOP')).entry).toBeNull();
  });
  it('ignores every line after it, which still appears in the listing', () => {
    const r = assemble(program('S:\tNOP', '\tEND S', '\tthis is junk ((', 'S:\tNOP'));
    expect(diagnosticsOf(r)).toEqual([]);
    expect(runsOf(r)).toEqual([[0x6000, [0]]]);
    expect(r.listing.slice(3)).toEqual([
      { line: 4, address: null, load: null, bytes: [], text: '\tthis is junk ((' },
      { line: 5, address: null, load: null, bytes: [], text: 'S:\tNOP' },
    ]);
  });
  it('rejects a bad entry', () => {
    expect(errorsOf(assemble(program('\tEND HL')))).toEqual(['2: END needs an entry address; HL is a register.']);
    expect(errorsOf(assemble(program('\tEND 1,2')))).toEqual(['2: END takes at most one entry address.']);
    expect(errorsOf(assemble(program('\tEND 10000H')))).toEqual(['2: END takes an address, 0 to 65535; 65536 ($10000) is out of range.']);
    expect(errorsOf(assemble(program('\tNOP', '\tEND LATER', 'LATER\tNOP')))).toEqual(['3: LATER is not defined.']);
  });
});

describe('the source map', () => {
  /**
   * Every byte a line emitted is found again: addressesOf gives the line's
   * run addresses, linesOf at each of them names the line with the bytes from
   * there on, candidates come in source order, and lineOf is the first.
   */
  function roundTrips(r: AsmResult): void {
    expect(errorsOf(r)).toEqual([]);
    for (const l of r.listing) {
      const addrs = r.sourceMap.addressesOf(l.line);
      expect(addrs).toEqual(l.bytes.map((_, k) => (l.address! + k) & 0xffff));
      addrs.forEach((a, k) => {
        const lines = r.sourceMap.linesOf(a);
        expect(lines).toContainEqual({ line: l.line, bytes: l.bytes.slice(k) });
        expect(lines.map((c) => c.line)).toEqual([...lines.map((c) => c.line)].sort((x, y) => x - y));
        expect(r.sourceMap.lineOf(a)).toBe(lines[0]!.line);
      });
    }
  }

  it('round-trips every emitted byte', () => {
    const r = assemble(program('START:\tLD A,1', '\tDB 1,2,3', '\tDS 2', '\tDS 2,9', '\tDW 1234H', '\t.PHASE 4000H', 'PP:\tJP PP', '\t.DEPHASE', '\tORG 7000H', '\tLD (IX+1),5', '\tEND START'));
    roundTrips(r);
    expect(r.sourceMap.lineOf(0x5fff)).toBeNull();
    expect(r.sourceMap.linesOf(0x5fff)).toEqual([]);
  });
  it('round-trips over an ORG overlap, where both lines ran at those addresses', () => {
    const r = assemble(program('\tDB 1,2,3', '\tORG 6000H', '\tDS 2', '\tDB 9'));
    roundTrips(r);
    expect(r.sourceMap.linesOf(0x6002)).toEqual([
      { line: 2, bytes: [3] },
      { line: 5, bytes: [9] },
    ]);
  });
  it('a relocating loader: lines that share a run address are all candidates, first in source order', () => {
    const r = assemble(program('LDR:\tLD HL,BLK', '\tJP 6000H', 'BLK:', '\t.PHASE 6000H', 'RUN:\tNOP', '\tJR RUN', '\t.DEPHASE', '\tEND LDR'));
    roundTrips(r);
    expect(r.entry).toBe(0x6000);
    expect(r.sourceMap.lineOf(0x6000)).toBe(2);
    expect(r.sourceMap.linesOf(0x6000)).toEqual([
      { line: 2, bytes: [0x21, 0x06, 0x60] },
      { line: 6, bytes: [0x00] },
    ]);
    expect(r.sourceMap.linesOf(0x6001)).toEqual([
      { line: 2, bytes: [0x06, 0x60] },
      { line: 7, bytes: [0x18, 0xfd] },
    ]);
    expect(r.sourceMap.addressesOf(2)).toEqual([0x6000, 0x6001, 0x6002]);
    expect(r.sourceMap.addressesOf(7)).toEqual([0x6001, 0x6002]);
  });
});
