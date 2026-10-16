import { describe, expect, it } from 'vitest';
import { decodeAt } from '@fugloy/z80';
import { recursiveDescent } from '../src/analysis/descent.js';
import { SymbolTable } from '../src/analysis/symbols.js';
import type { Symbol } from '../src/analysis/symbols.js';
import { loadCmd } from '../src/cmd.js';
import { renderOperands } from '../src/emit/operands.js';
import { emitZmac } from '../src/emit/zmac.js';
import { applyHints } from '../src/hints/apply.js';
import { emptyAnnotations } from '../src/hints/apply.js';
import type { Annotations } from '../src/hints/apply.js';
import { analyze } from '../src/pipeline.js';
import { CMD_FIXTURES, HINT_FIXTURES } from './fixtures.js';
import { image } from './images.js';

const table = (...syms: [number, string, Symbol['kind']][]): SymbolTable => {
  const t = new SymbolTable();
  for (const [addr, name, kind] of syms) t.set({ addr, name, kind, source: 'synth' });
  return t;
};
const ann = (partial: Partial<Annotations>): Annotations => ({ ...emptyAnnotations(), ...partial });

describe('renderOperands', () => {
  const syms = table([0x6005, 'L6005', 'code'], [0x7000, 'DATA_7000', 'data']);
  it('names jump, call, and relative targets, data references, and memory operands that have symbols', () => {
    expect(renderOperands(decodeAt([0xc3, 0x05, 0x60], 0), syms)).toBe('L6005');
    expect(renderOperands(decodeAt([0xc2, 0x05, 0x60], 0), syms)).toBe('NZ,L6005');
    expect(renderOperands(decodeAt([0xcd, 0x05, 0x60], 0), syms)).toBe('L6005');
    expect(renderOperands(decodeAt([0x18, 0x03], 0, 0x6000), syms)).toBe('L6005');
    expect(renderOperands(decodeAt([0x21, 0x00, 0x70], 0), syms)).toBe('HL,DATA_7000');
    expect(renderOperands(decodeAt([0x32, 0x00, 0x70], 0), syms)).toBe('(DATA_7000),A');
    expect(renderOperands(decodeAt([0x2a, 0x00, 0x70], 0), syms)).toBe('HL,(DATA_7000)');
  });
  it('keeps numbers where there is no symbol or the operand is not a reference', () => {
    expect(renderOperands(decodeAt([0xcd, 0x33, 0x00], 0), syms)).toBe('0033H');
    expect(renderOperands(decodeAt([0x31, 0x00, 0x70], 0), syms)).toBe('SP,7000H');
    expect(renderOperands(decodeAt([0x3e, 0x12], 0), syms)).toBe('A,12H');
    expect(renderOperands(decodeAt([0xd3, 0x12], 0), syms)).toBe('(12H),A');
    expect(renderOperands(decodeAt([0x21, 0x00, 0x70], 0))).toBe('HL,7000H');
  });
});

describe('emitZmac with symbols', () => {
  it('defines a label on its own line before the row at its address and uses it in operands', () => {
    const img = image({ 0x6000: [0xcd, 0x04, 0x60, 0xc9, 0xc9] });
    const a = analyze({ format: 'raw', image: img, base: 0x6000, entry: 0x6000 });
    const text = emitZmac(img, a.pass1, 0x6000, { symbols: a.symbols });
    expect(text).toContain('\tCALL\tSUB_6004\n\tRET\nSUB_6004:\n\tRET\n');
  });

  it('splits DB rows at every symbol address so each label precedes exactly its own byte', () => {
    const img = image({ 0x7000: [1, 2, 3, 4, 5, 6, 7, 8, 9] });
    const a = analyze({ format: 'raw', image: img, base: 0x7000, entry: 0x7000 }, { annotations: ann({ overrides: [{ addr: 0x7000, kind: 'bytes', length: 9 }], names: new Map([[0x7002, 'TWO'], [0x7003, 'THREE']]) }) });
    const text = emitZmac(img, a.pass1, null, { symbols: a.symbols, annotations: a.annotations });
    expect(text).toContain('\tDB\t01H,02H\nTWO:\n\tDB\t03H\nTHREE:\n\tDB\t04H,05H,06H,07H,08H,09H\n');
  });

  it('emits a symbol inside an instruction as EQU, never as a label line', () => {
    const img = image({ 0x6000: [0x21, 0x00, 0x3c, 0xc9] });
    const a = analyze({ format: 'raw', image: img, base: 0x6000, entry: 0x6000 }, { annotations: ann({ names: new Map([[0x6001, 'MID']]) }) });
    const text = emitZmac(img, a.pass1, 0x6000, { symbols: a.symbols, annotations: a.annotations });
    expect(text.split('\n')[1]).toBe('MID\tEQU\t6001H');
    expect(text).not.toContain('MID:');
    expect(text).toContain('\tORG\t6000H\n\tLD\tHL,3C00H\n\tRET\n');
  });

  it('emits words as DW with symbol names, an odd trailing byte as DB, and a table as DW of labels', () => {
    const img = image({ 0x6000: [0xc9], 0x6010: [0x00, 0x60, 0x10, 0x70, 0xff], 0x7010: [0xc9] });
    const a = analyze({ format: 'raw', image: img, base: 0x6000, entry: 0x6000 }, { annotations: ann({ tables: [{ addr: 0x6010, count: 2, width: 2 }], overrides: [{ addr: 0x6014, kind: 'words', length: 1 }] }) });
    const text = emitZmac(img, a.pass1, 0x6000, { symbols: a.symbols, annotations: a.annotations });
    expect(text).toContain('TBL_6010:\n\tDW\tL6000,L7010\n\tDB\t0FFH\n');
  });

  it('appends hint comments to the row at their address and splits rows for them', () => {
    const img = image({ 0x6000: [0x21, 0x00, 0x3c, 0xc9, 1, 2, 3] });
    const a = analyze({ format: 'raw', image: img, base: 0x6000, entry: 0x6000 }, { annotations: ann({ comments: new Map([[0x6000, 'set up video'], [0x6005, 'second byte']]) }) });
    const text = emitZmac(img, a.pass1, 0x6000, { symbols: a.symbols, annotations: a.annotations });
    expect(text).toContain('\tLD\tHL,3C00H\t; set up video\n');
    expect(text).toContain('\tDB\t01H\n\tDB\t02H,03H\t; second byte\n');
  });

  it('emits no label lines, EQU, or comments when there are no symbols or annotations, and empty ones change nothing', () => {
    const img = image({ 0x6000: [0x21, 0x00, 0x3c, 0x36, 0x41, 0xc9], 0x7000: [0, 1, 2, 3, 4, 5, 6, 7, 8] });
    const p = recursiveDescent(img, [0x6000]);
    const plain = emitZmac(img, p, 0x6000);
    expect(plain).toBe(['; Fugløy pass 1, 2 runs, 15 bytes, entry 6000H', '\tORG\t6000H', '\tLD\tHL,3C00H', '\tLD\t(HL),41H', '\tRET', '\tORG\t7000H', '\tDB\t00H,01H,02H,03H,04H,05H,06H,07H', '\tDB\t08H', '\tEND\t6000H', ''].join('\n'));
    expect(emitZmac(img, p, 0x6000, { symbols: new SymbolTable(), annotations: emptyAnnotations() })).toBe(plain);
  });

  it('renders the hint-paths fixture with every path', () => {
    const bytes = CMD_FIXTURES['hint-paths']!();
    const mod = loadCmd(bytes);
    const applied = applyHints(HINT_FIXTURES['hint-paths']!(), mod.image);
    expect(applied.warnings).toEqual([]);
    const a = analyze(mod, { annotations: applied.annotations });
    const text = emitZmac(mod.image, a.pass1, a.transfer, { source: 'hint-paths.cmd', symbols: a.symbols, annotations: a.annotations });
    expect(text).toContain('MIDCALL\tEQU\t6001H\n');
    expect(text).toContain('\tCALL\tPRINT\t; call PRINT, then dispatch through the table\n');
    expect(text).toContain('\tLD\tHL,DATA_6040\n');
    expect(text).toContain('\tLD\tA,(FLAGS)\n\tLD\t(FLAGS),A\n\tLD\tHL,DISPATCH\n');
    expect(text).toContain('L6019:\n\tJR\tL6019\nL601B:\n\tRET\n');
    expect(text).toContain('PRINT:\n\tLD\tA,41H\n\tCALL\t0033H\n\tRET\n');
    expect(text).toContain('DISPATCH:\n\tDW\tL6019,L601B\n');
    expect(text).toContain('DATA_6040:\n\tDW\t1234H,5678H,0AABBH\n');
    expect(text).toContain('FLAGS:\n\tDB\t01H,02H,03H,04H\n\tDB\t48H,45H,4CH,4CH,4FH,0DH\n\tDB\t0FFH\n');
    expect(text.trimEnd().endsWith('\tEND\t6000H')).toBe(true);
  });
});
