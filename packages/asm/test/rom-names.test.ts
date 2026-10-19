/**
 * ROM, hardware, and DOS names (Ruling 5): predefined from @fugloy/disasm's
 * cited tables at the lowest priority, per model and DOS; the warning for an
 * address the Model I and Model III ROMs give different meanings; and the
 * suggestions for a name no table has.
 */
import { describe, expect, it } from 'vitest';
import { selectSymbols, SYMBOL_TABLES } from '../../disasm/src/index.js';
import type { Dos, Machine } from '../../disasm/src/index.js';
import { assemble, differentAddresses, romNames } from '../src/index.js';
import type { AsmOptions } from '../src/index.js';
import { diagnosticsOf, errorsOf } from './helpers.js';

const program = (...lines: string[]): string => ['\tORG 6000H', ...lines].join('\n') + '\n';

/** The bytes at $6000 onward, from a clean assembly (warnings allowed, listed in `warnings`). */
function assembled(source: string, options: AsmOptions = {}): { bytes: number[]; warnings: string[] } {
  const r = assemble(source, options);
  expect(errorsOf(r)).toEqual([]);
  const bytes: number[] = [];
  for (const run of r.image!.runs()) for (let a = run.start; a <= run.end; a++) bytes.push(r.image!.bytes[a]!);
  return { bytes, warnings: r.diagnostics.filter((d) => d.severity === 'warning').map((d) => `${d.line}: ${d.message}`) };
}

describe('ROM names resolve per model (Ruling 5)', () => {
  it('a routine both ROMs have at one address is the same on either model', () => {
    for (const model of [1, 3] as const) expect(assembled(program('\tCALL $VDCLS'), { model }).bytes).toEqual([0xcd, 0xc9, 0x01]);
  });
  it('a name the two ROMs put at different addresses takes the chosen model\'s', () => {
    expect(assembled(program('\tCALL KBDRIVER'), { model: 1 }).bytes).toEqual([0xcd, 0xe3, 0x03]);
    expect(assembled(program('\tCALL KBDRIVER'), { model: 3 }).bytes).toEqual([0xcd, 0x24, 0x30]);
  });
  it('the Model III is the default', () => {
    expect(assembled(program('\tCALL KBDRIVER')).bytes).toEqual([0xcd, 0x24, 0x30]);
    expect(assembled(program('\tCALL $RSINIT')).bytes).toEqual([0xcd, 0x5a, 0x00]);
  });
  it('names match in any case, as labels do', () => {
    expect(assembled(program('\tcall $vdcls', '\tCall $VdCls')).bytes).toEqual([0xcd, 0xc9, 0x01, 0xcd, 0xc9, 0x01]);
  });
  it('a port name is its number, so OUT (name),A works', () => {
    const port = SYMBOL_TABLES['hardware-model3'].find((e) => e.kind === 'port')!;
    expect(assembled(program(`\tOUT (${port.name}),A`), { model: 3 }).bytes).toEqual([0xd3, port.key]);
  });
  it('DOS names come only with the dos option', () => {
    expect(assembled(program('\tJP $JP2DOS'), { model: 3, dos: 'trsdos' }).bytes).toEqual([0xc3, 0x2d, 0x40]);
    expect(errorsOf(assemble(program('\tJP $JP2DOS'), { model: 3 }))).toEqual(['2: $JP2DOS is not defined. $JP2DOS is a TRSDOS 1.3 name; choose TRSDOS 1.3 as the DOS to use it.']);
    expect(assembled(program('\tJP @EXIT'), { model: 1, dos: 'ldos' }).bytes).toEqual([0xc3, 0x2d, 0x40]);
  });
  it('the Model 4 has the LS-DOS 6 service calls by number and the Model III ROM', () => {
    expect(assembled(program('\tLD A,@KEY', '\tRST 28H', '\tCALL $VDCLS'), { model: 4 }).bytes).toEqual([0x3e, 0x01, 0xef, 0xcd, 0xc9, 0x01]);
    expect(errorsOf(assemble(program('\tLD A,@KEY'), { model: 3 }))).toEqual(['2: @KEY is not defined. @KEY is an LS-DOS 6 service call, which only the Model 4 has.']);
  });
  it('a ROM name of the other model is not defined, and the message says whose it is', () => {
    expect(errorsOf(assemble(program('\tCALL $RSINIT'), { model: 1 }))).toEqual(['2: $RSINIT is not defined. $RSINIT is a Model III ROM name, and this program is assembled for the Model I.']);
    expect(errorsOf(assemble(program('\tLD HL,CTRLCHARTAB'), { model: 3 }))).toEqual(['2: CTRLCHARTAB is not defined. CTRLCHARTAB is a Model I ROM name, and this program is assembled for the Model III.']);
  });
  it('the symbol table lists the ROM names the source used, as kind rom on line 0', () => {
    const r = assemble(program('\tCALL $VDCLS', 'X:\tJP X'));
    expect(r.symbols.get('$VDCLS')).toEqual({ value: 0x01c9, line: 0, kind: 'rom' });
    expect(r.symbols.get('X')).toEqual({ value: 0x6003, line: 3, kind: 'label' });
    expect([...r.symbols.values()].filter((s) => s.kind === 'rom').length).toBe(1);
  });
  it('a ROM name works in DS and ORG, which only take names defined above them', () => {
    expect(assemble('\tORG $VDCLS+3E00H\n\tDS LOW $VDCLS\n\tNOP\n').image!.isLoaded(0x3fc9 + 0xc9)).toBe(true);
  });
  it('an unknown model or a model and DOS with no names throws a sentence', () => {
    expect(() => assemble('\tNOP\n', { model: 2 as 1 })).toThrow('The model is 1, 3, or 4, not 2.');
    expect(() => assemble('\tNOP\n', { model: 1, dos: 'trsdos' })).toThrow('TRSDOS 1.3 is the Model III DOS; for the Model I choose ldos or none.');
    expect(() => assemble('\tNOP\n', { model: 4, dos: 'ldos' })).toThrow('The Model 4 has no DOS names to choose: its names are the LS-DOS 6 service calls and the Model III ROM. Leave the DOS out.');
    expect(() => assemble('\tNOP\n', { model: 3, dos: 'cpm' as Dos })).toThrow('The DOS is trsdos, ldos, or none, not cpm.');
  });
});

describe('a definition in the source wins, with no message (Ruling 5)', () => {
  it("the emitter's EQU that defines a ROM name again with the same value", () => {
    const r = assemble(program('$VDCLS\tEQU\t01C9H\t; clear the screen', '\tCALL $VDCLS'), { model: 3 });
    expect(diagnosticsOf(r)).toEqual([]);
    expect(r.symbols.get('$VDCLS')).toEqual({ value: 0x01c9, line: 1 + 1, kind: 'equ' });
  });
  it('an EQU with another value', () => {
    const r = assemble(program('$VDCLS\tEQU\t1234H', '\tCALL $VDCLS'), { model: 3 });
    expect(diagnosticsOf(r)).toEqual([]);
    expect(Array.from(r.image!.bytes.subarray(0x6000, 0x6003))).toEqual([0xcd, 0x34, 0x12]);
  });
  it('a label of the same name, even below its use', () => {
    const r = assemble(program('\tCALL $KBWAIT', '$KBWAIT:\tRET'), { model: 3 });
    expect(diagnosticsOf(r)).toEqual([]);
    expect(Array.from(r.image!.bytes.subarray(0x6000, 0x6003))).toEqual([0xcd, 0x03, 0x60]);
  });
  it('a DEFL of the same name', () => {
    expect(assembled(program('$KBWAIT\tDEFL\t7', '\tLD A,$KBWAIT')).bytes).toEqual([0x3e, 0x07]);
  });
  it("every name of every selection, defined again as the emitter does, assembles with no message", () => {
    const selections: { machine: Machine; dos: Dos }[] = [
      { machine: 1, dos: 'ldos' },
      { machine: 1, dos: 'none' },
      { machine: 3, dos: 'trsdos' },
      { machine: 3, dos: 'ldos' },
      { machine: 3, dos: 'none' },
      { machine: 4, dos: 'none' },
    ];
    for (const { machine, dos } of selections) {
      const entries = selectSymbols({ machine, dos }).entries().filter((e) => e.kind !== 'svc');
      const lines = entries.map((e) => `${e.name}\tEQU\t${e.key.toString(16).toUpperCase().padStart(4, '0')}H`);
      // Every name used as an operand, so a redefinition with a different value would show in the bytes.
      lines.push('\tORG\t6000H', ...entries.map((e) => `\tDW\t${e.name}`));
      const r = assemble(`${lines.join('\n')}\n`, { model: machine, dos });
      expect(diagnosticsOf(r), `machine ${machine} with ${dos}`).toEqual([]);
      entries.forEach((e, i) => expect(r.image!.bytes[0x6000 + 2 * i]! | (r.image!.bytes[0x6001 + 2 * i]! << 8), e.name).toBe(e.key));
    }
  });
});

describe('the Model I/III warning', () => {
  const RSRCV_M3 =
    '$0050 means different things in the two ROMs: on the Model III it is $RSRCV (receive a character from the RS-232-C port; zero means none arrived), on the Model I CTRLCHARTAB (table of the control codes for ENTER, CLEAR, BREAK, the arrow keys, and space: eight two-byte entries). This line is right for the Model III only.';
  it('CALL of an address the two ROM tables class as different names both meanings', () => {
    const r = assemble(program('\tCALL 0050H'), { model: 3 });
    expect(r.ok).toBe(true);
    expect(diagnosticsOf(r)).toEqual([`2:7-12 warning: ${RSRCV_M3}`]);
    expect(r.diagnostics[0]!.code).toBe('rom-difference');
  });
  it('on the Model I it puts the Model I meaning first', () => {
    expect(assembled(program('\tCALL 0050H'), { model: 1 }).warnings).toEqual([
      '2: $0050 means different things in the two ROMs: on the Model I it is CTRLCHARTAB (table of the control codes for ENTER, CLEAR, BREAK, the arrow keys, and space: eight two-byte entries), on the Model III $RSRCV (receive a character from the RS-232-C port; zero means none arrived). This line is right for the Model I only.',
    ]);
  });
  it('the Model 4 is warned as the Model III, whose ROM it runs Model III code with', () => {
    expect(assembled(program('\tCALL 0050H'), { model: 4 }).warnings).toEqual([`2: ${RSRCV_M3}`]);
  });
  it('a ROM name at such an address warns too, and so does a JP or an address in parentheses', () => {
    expect(assembled(program('\tCALL $RSRCV', '\tJP NZ,01D9H', '\tLD A,(0212H)', '\tLD HL,PRDRIVER'), { model: 3 }).warnings.map((w) => w.slice(0, 9))).toEqual([
      '2: $0050 ',
      '3: $01D9 ',
      '4: $0212 ',
      '5: $03C2 ',
    ]);
  });
  it('a plain number elsewhere, a shared address, or a name the source defines does not warn', () => {
    expect(assembled(program('\tLD HL,0050H', '\tLD A,50H', '\tCALL 0060H', '\tDW 0050H'), { model: 3 }).warnings).toEqual([]);
    expect(assembled(program('MINE\tEQU\t0050H', '\tLD HL,MINE'), { model: 3 }).warnings).toEqual([]);
  });
  it('a line with an error gets no warning as well', () => {
    expect(diagnosticsOf(assemble(program('\tCALL Z,0050H,1'), { model: 3 })).every((d) => !d.includes('warning'))).toBe(true);
  });
  it('covers every address the comparison classes as different', () => {
    expect(differentAddresses()).toEqual([0x0050, 0x01d9, 0x0212, 0x03c2]);
    for (const a of differentAddresses()) {
      const hex = `0${a.toString(16).toUpperCase().padStart(4, '0')}H`;
      expect(assembled(program(`\tCALL ${hex}`)).warnings.length, hex).toBe(1);
    }
  });
});

describe('suggestions for a name no table has', () => {
  it('CALL CLSS suggests the nearest ROM name, with what it is', () => {
    expect(errorsOf(assemble(program('\tCALL CLSS')))).toEqual(['2: CLSS is not defined. Did you mean $VDCLS, the Model III ROM routine at $01C9 (clear the screen)?']);
  });
  it('a ROM name without its $ finds it', () => {
    expect(errorsOf(assemble(program('\tCALL KBWAIT')))).toEqual(['2: KBWAIT is not defined. Did you mean $KBWAIT, the Model III ROM routine at $0049 (wait for a key and return it in A)?']);
  });
  it('a near name of the source wins over a ROM name', () => {
    expect(errorsOf(assemble(program('KBWAIT2:\tRET', '\tCALL KBWAIT')))).toEqual(['3: KBWAIT is not defined. Did you mean KBWAIT2?']);
  });
  it('a word far from every name gets no guess', () => {
    expect(errorsOf(assemble(program('\tCALL LATER')))).toEqual(['2: LATER is not defined.']);
  });
});

describe('the table names and the lexer', () => {
  const all = Object.values(SYMBOL_TABLES).flat();
  it('no table name is $ followed by hex digits only (it would read as a number) or with a ?', () => {
    expect(all.filter((e) => /^\$[0-9A-Fa-f?]+$/.test(e.name)).map((e) => e.name)).toEqual([]);
  });
  it('every table name reads as one name: defined by an EQU and used, it assembles with no message', () => {
    for (const e of all) {
      const r = assemble(`${e.name}\tEQU\t5\n\tORG\t6000H\n\tDB\t${e.name}\n`);
      expect(diagnosticsOf(r), e.name).toEqual([]);
      expect(r.image!.bytes[0x6000], e.name).toBe(5);
    }
  });
  it('romNames keys every name of the selection in upper case', () => {
    const names = romNames(3, 'trsdos');
    for (const e of selectSymbols({ machine: 3, dos: 'trsdos' }).entries()) expect(names.get(e.name.toUpperCase())?.value).toBe(e.key);
  });
});
