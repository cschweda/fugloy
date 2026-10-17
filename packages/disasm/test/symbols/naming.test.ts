/**
 * Rendering table names (design spec §4.5, §5.3): the operands, the comments that
 * explain them, the listing header and legend, the zmac EQUs, and the IR fields.
 * Tables here are in memory, so each test names its own entries.
 */
import { TABLES as OPCODES, decodeAt } from '@fugloy/z80';
import { describe, expect, it } from 'vitest';
import { ExternalNames, externalUses } from '../../src/analysis/externals.js';
import { operandUse, operandValue, SymbolTable } from '../../src/analysis/symbols.js';
import { loadBas } from '../../src/bas.js';
import { commentEntries, externalComment, previousInstruction, renderInstruction, renderOperands } from '../../src/emit/operands.js';
import { emitZmac, instructionLine } from '../../src/emit/zmac.js';
import { emptyAnnotations } from '../../src/hints/apply.js';
import * as disasm from '../../src/index.js';
import { buildIr } from '../../src/ir.js';
import { renderPass1Listing } from '../../src/listing.js';
import { analyze } from '../../src/pipeline.js';
import type { AnalyzeOptions } from '../../src/pipeline.js';
import { loadRaw } from '../../src/raw.js';
import { selectSymbols, SymbolSet } from '../../src/symbols/select.js';
import type { SymbolSelection } from '../../src/symbols/select.js';
import type { RomComparison } from '../../src/symbols/types.js';
import { writeBasic } from '../writers/basic-tokenizer.js';
import { entry, tablesOf } from './helpers.js';

const MODEL_III: SymbolSelection = { machine: 3, dos: 'trsdos' };
const MODEL_I: SymbolSelection = { machine: 1, dos: 'ldos' };
const MODEL_IV: SymbolSelection = { machine: 4, dos: 'none' };

const syncheck = entry('rom-model3', 'routine', 0x0008, '$SYNCHK', { purpose: 'check the next character', cite: [{ source: 'm3-basic', page: '12/3' }] });
const vdchar = entry('rom-model3', 'routine', 0x0033, '$VDCHAR', { purpose: 'display the character in A' });
const kbwait = entry('rom-model3', 'routine', 0x0049, '$KBWAIT', { purpose: 'wait for a key', cite: [{ source: 'm3-basic', page: '12/12' }] });
const cursor = entry('rom-model3', 'variable', 0x4020, 'CURSOR', { length: 2, purpose: 'cursor position' });
const video = entry('hardware-model3', 'region', 0x3c00, 'VIDEO', { length: 1024, coined: true, purpose: 'video memory', cite: [{ source: 'm3-trm', page: '14' }] });
const modeport = entry('hardware-model3', 'port', 0xec, 'MODEPORT', { coined: true, purpose: 'mode select', cite: [{ source: 'm3-trm', page: '22' }] });
const jp2dos = entry('dos-trsdos13', 'routine', 0x402d, '$JP2DOS', { purpose: 'return to TRSDOS READY', cite: [{ source: 'trsdos13', page: '86' }] });
const dsply = entry('svc-lsdos6', 'svc', 10, '@DSPLY', { purpose: 'display a line', cite: [{ source: 'soltoff', page: '101' }] });

/** Every ROM address above is the same on both machines, so none of their comments carries a machine tag. */
const SHARED = { '0008': 'shared', '0033': 'shared', '0049': 'shared', '4020': 'shared' } as const;

const model3 = selectSymbols(
  MODEL_III,
  tablesOf({ 'rom-model3': [syncheck, vdchar, kbwait, cursor], 'hardware-model3': [video, modeport], 'dos-trsdos13': [jp2dos] }),
  SHARED,
);
const model4 = selectSymbols(MODEL_IV, tablesOf({ 'svc-lsdos6': [dsply] }), {});

const BASE = 0x5200;
const program = (bytes: number[], opts: AnalyzeOptions = {}) => analyze(loadRaw(Uint8Array.from(bytes), BASE), opts);
const listingOf = (bytes: number[], opts: AnalyzeOptions = {}): string[] => renderPass1Listing(program(bytes, opts), { source: 'x.bin' }).split('\n');
const zmacOf = (bytes: number[], opts: AnalyzeOptions = {}): string => {
  const a = program(bytes, opts);
  return emitZmac(a.module.image, a.pass1, a.transfer, { source: 'x.bin', symbols: a.symbols, annotations: a.annotations, space: a.space, externals: a.externals, tablesUsed: a.tablesUsed });
};

/** The text and comment of the listing row at `addr`. */
function row(lines: string[], addr: number): { text: string; comment: string | undefined } {
  const prefix = `${addr.toString(16).toUpperCase().padStart(4, '0')}  `;
  const line = lines.find((l) => l.startsWith(prefix));
  if (line === undefined) throw new Error(`no row at ${prefix}: ${lines.join('\n')}`);
  const m = /^[0-9A-F]{4} {2}.{12} {2}(.*?) *(?:; (.*))?$/.exec(line);
  if (m === null) throw new Error(`cannot read the row: ${line}`);
  return { text: m[1]!, comment: m[2] };
}

describe('operands named from the tables', () => {
  it('names a call target and explains it in the comment: CALL 0049H is CALL $KBWAIT, "wait for a key"', () => {
    const lines = listingOf([0x00, 0xcd, 0x49, 0x00, 0xc9], { tables: model3 });
    expect(row(lines, 0x5201)).toEqual({ text: 'CALL $KBWAIT', comment: 'wait for a key' });
  });

  it('names a jump target from the DOS table and joins the comment after the entry mark: JP 402DH is JP $JP2DOS', () => {
    const lines = listingOf([0xc3, 0x2d, 0x40], { tables: model3 });
    expect(row(lines, 0x5200)).toEqual({ text: 'JP $JP2DOS', comment: 'entry; return to TRSDOS READY' });
  });

  it('names the target of JR, JR cc, and DJNZ', () => {
    // at $0000 a displacement of $47 lands on $0049
    const at0 = (opcode: number): string => renderInstruction(decodeAt([opcode, 0x47], 0, 0x0000), new SymbolTable(), model3Names());
    expect(at0(0x18)).toBe('JR $KBWAIT');
    expect(at0(0x20)).toBe('JR NZ,$KBWAIT');
    expect(at0(0x10)).toBe('DJNZ $KBWAIT');
  });

  it('names an address loaded into a register pair from the data names: LD HL,3C00H is LD HL,VIDEO', () => {
    const lines = listingOf([0x00, 0x21, 0x00, 0x3c, 0xc9], { tables: model3 });
    expect(row(lines, 0x5201)).toEqual({ text: 'LD HL,VIDEO', comment: undefined });
  });

  it('writes an address inside a region as NAME+offset in the listing\'s number format: LD HL,3D40H is LD HL,VIDEO+0140H', () => {
    const lines = listingOf([0x00, 0x21, 0x40, 0x3d, 0xc9], { tables: model3 });
    expect(row(lines, 0x5201).text).toBe('LD HL,VIDEO+0140H');
  });

  it('names a memory operand, with the offset inside a variable: (4020H) is (CURSOR) and (4021H) is (CURSOR+0001H)', () => {
    const lines = listingOf([0x00, 0x3a, 0x20, 0x40, 0x3a, 0x21, 0x40, 0x32, 0x21, 0x40, 0x2a, 0x20, 0x40, 0xc9], { tables: model3 });
    expect(row(lines, 0x5201).text).toBe('LD A,(CURSOR)');
    expect(row(lines, 0x5204).text).toBe('LD A,(CURSOR+0001H)');
    expect(row(lines, 0x5207).text).toBe('LD (CURSOR+0001H),A');
    expect(row(lines, 0x520a).text).toBe('LD HL,(CURSOR)');
  });

  it('names a port: OUT (0ECH),A is OUT (MODEPORT),A and IN A,(0ECH) is IN A,(MODEPORT)', () => {
    const lines = listingOf([0x00, 0xd3, 0xec, 0xdb, 0xec, 0xc9], { tables: model3 });
    expect(row(lines, 0x5201).text).toBe('OUT (MODEPORT),A');
    expect(row(lines, 0x5203).text).toBe('IN A,(MODEPORT)');
  });

  it('keeps a port number a number when the instruction has no port operand: IN A,(C)', () => {
    const lines = listingOf([0x00, 0xed, 0x78, 0xc9], { tables: model3 });
    expect(row(lines, 0x5201).text).toBe('IN A,(C)');
  });

  it('leaves RST numeric and puts the routine\'s name and purpose in the comment', () => {
    const lines = listingOf([0x00, 0xcf, 0x2c, 0xc9], { tables: model3 });
    expect(row(lines, 0x5201)).toEqual({ text: 'RST 08H', comment: '$SYNCHK: check the next character' });
  });

  it('names a call but not the same number used as a count: CALL 0033H and LD BC,0033H in one program', () => {
    const lines = listingOf([0x00, 0xcd, 0x33, 0x00, 0x01, 0x33, 0x00, 0xc9], { tables: model3 });
    expect(row(lines, 0x5201)).toEqual({ text: 'CALL $VDCHAR', comment: 'display the character in A' });
    expect(row(lines, 0x5204)).toEqual({ text: 'LD BC,0033H', comment: undefined });
  });

  it('never names an 8-bit immediate or LD SP,nn, whatever table key it matches', () => {
    // LD A,49H / CP 0ECH / ADD A,33H / LD SP,3C00H / LD (HL),20H
    const lines = listingOf([0x00, 0x3e, 0x49, 0xfe, 0xec, 0xc6, 0x33, 0x31, 0x00, 0x3c, 0x36, 0x20, 0xc9], { tables: model3 });
    expect(row(lines, 0x5201).text).toBe('LD A,49H');
    expect(row(lines, 0x5203).text).toBe('CP 0ECH');
    expect(row(lines, 0x5205).text).toBe('ADD A,33H');
    expect(row(lines, 0x5207).text).toBe('LD SP,3C00H');
    expect(row(lines, 0x520a).text).toBe('LD (HL),20H');
  });

  it('names nothing at an address inside the image: a call into the program is its own label', () => {
    const own = entry('rom-model3', 'routine', 0x5206, '$MINE');
    const tables = selectSymbols(MODEL_III, tablesOf({ 'rom-model3': [own] }), {});
    const lines = listingOf([0xcd, 0x06, 0x52, 0xc9, 0x00, 0x00, 0xc9], { tables });
    expect(row(lines, 0x5200).text).toBe('CALL SUB_5206');
  });

  it('gives the program\'s own symbol first when it has one at the address', () => {
    const symbols = new SymbolTable();
    symbols.set({ addr: 0x0049, name: 'MYKEY', kind: 'sub', source: 'user' });
    symbols.set({ addr: 0x3c00, name: 'MYSCREEN', kind: 'data', source: 'user' });
    const names = model3Names();
    expect(renderOperands(decodeAt([0xcd, 0x49, 0x00], 0), symbols, names)).toBe('MYKEY');
    expect(renderOperands(decodeAt([0x21, 0x00, 0x3c], 0), symbols, names)).toBe('HL,MYSCREEN');
    expect(renderOperands(decodeAt([0x3a, 0x00, 0x3c], 0), symbols, names)).toBe('A,(MYSCREEN)');
    expect(renderOperands(decodeAt([0x21, 0x40, 0x3d], 0), symbols, names)).toBe('HL,VIDEO+0140H'); // only the exact address is the program's
  });

  it('does not let a program symbol at $00EC hide port $EC, which is a number and not an address', () => {
    const symbols = new SymbolTable();
    symbols.set({ addr: 0x00ec, name: 'MINE', kind: 'data', source: 'user' });
    expect(renderOperands(decodeAt([0xd3, 0xec], 0), symbols, model3Names())).toBe('(MODEPORT),A');
  });

  it('takes table names without a symbol table, and no names without tables', () => {
    expect(renderOperands(decodeAt([0xcd, 0x49, 0x00], 0), undefined, model3Names())).toBe('$KBWAIT');
    expect(renderOperands(decodeAt([0xcd, 0x49, 0x00], 0), new SymbolTable(), new ExternalNames(undefined, () => false, []))).toBe('0049H');
    expect(renderOperands(decodeAt([0xcd, 0x49, 0x00], 0))).toBe('0049H');
  });

  it('leaves the table name out when the program already has a name that equals it ignoring case, and says so in the header', () => {
    const annotations = { ...emptyAnnotations(), names: new Map([[0x5200, 'video']]) };
    const lines = listingOf([0x21, 0x00, 0x3c, 0xc9], { tables: model3, annotations });
    expect(row(lines, 0x5200).text).toBe('LD HL,3C00H');
    expect(lines).toContain('; table name VIDEO not used: the program has its own video');
  });
});

/** The external names of the model 3 tables with nothing loaded. */
function model3Names(): ExternalNames {
  return new ExternalNames(model3, () => false, []);
}

describe('comments for named transfers', () => {
  const call = decodeAt([0xcd, 0x49, 0x00], 0);

  it('gives the purpose of a routine the instruction transfers to', () => {
    expect(externalComment(call, undefined, model3Names())).toBe('wait for a key');
    expect(externalComment(decodeAt([0xc2, 0x2d, 0x40], 0), undefined, model3Names())).toBe('return to TRSDOS READY');
    expect(externalComment(decodeAt([0x18, 0x47], 0, 0x0000), undefined, model3Names())).toBe('wait for a key');
  });

  it('gives no comment for a name that is not a transfer, an operand left numeric, or no tables', () => {
    expect(externalComment(decodeAt([0x21, 0x00, 0x3c], 0), undefined, model3Names())).toBeUndefined();
    expect(externalComment(decodeAt([0x3a, 0x20, 0x40], 0), undefined, model3Names())).toBeUndefined();
    expect(externalComment(decodeAt([0xd3, 0xec], 0), undefined, model3Names())).toBeUndefined();
    expect(externalComment(decodeAt([0x01, 0x33, 0x00], 0), undefined, model3Names())).toBeUndefined();
    expect(externalComment(decodeAt([0xcd, 0x34, 0x12], 0), undefined, model3Names())).toBeUndefined();
    expect(externalComment(call, undefined, new ExternalNames(undefined, () => false, []))).toBeUndefined();
  });

  it('gives no comment where the program\'s own symbol names the target', () => {
    const symbols = new SymbolTable();
    symbols.set({ addr: 0x0049, name: 'MYKEY', kind: 'sub', source: 'user' });
    expect(externalComment(call, undefined, model3Names(), symbols)).toBeUndefined();
  });

  it('gives RST n the name and purpose of the routine at n: NAME: purpose', () => {
    expect(externalComment(decodeAt([0xcf], 0), undefined, model3Names())).toBe('$SYNCHK: check the next character');
    expect(externalComment(decodeAt([0xd7], 0), undefined, model3Names())).toBeUndefined(); // RST 10H has no entry
  });

  it('tags a ROM name the comparison does not class as shared with its machine', () => {
    const onModel3 = (comparison: RomComparison): string | undefined => {
      const e = entry('rom-model3', 'routine', 0x0049, '$KBWAIT', { purpose: 'wait for a key' });
      return externalComment(call, undefined, new ExternalNames(selectSymbols(MODEL_III, tablesOf({ 'rom-model3': [e] }), comparison), () => false, []));
    };
    expect(onModel3({ '0049': 'shared' })).toBe('wait for a key');
    expect(onModel3({ '0049': 'different' })).toBe('wait for a key [Model III]');
    expect(onModel3({ '0049': 'model3-only' })).toBe('wait for a key [Model III]');
    expect(onModel3({})).toBe('wait for a key [Model III]'); // an address the comparison does not list is not known to be shared
    const e1 = entry('rom-model1', 'routine', 0x0049, '$KBWAIT', { purpose: 'wait for a key' });
    const onModel1 = new ExternalNames(selectSymbols({ machine: 1, dos: 'none' }, tablesOf({ 'rom-model1': [e1] }), { '0049': 'different' }), () => false, []);
    expect(externalComment(call, undefined, onModel1)).toBe('wait for a key [Model I]');
  });

  it('puts no tag on a name from a table that is not a ROM table', () => {
    const different = selectSymbols(MODEL_III, tablesOf({ 'dos-trsdos13': [jp2dos] }), { '402D': 'different' });
    expect(externalComment(decodeAt([0xc3, 0x2d, 0x40], 0), undefined, new ExternalNames(different, () => false, []))).toBe('return to TRSDOS READY');
  });

  it('tags the comment of a listing row, after the hint comment', () => {
    const different = selectSymbols(MODEL_III, tablesOf({ 'rom-model3': [kbwait] }), { '0049': 'different' });
    const annotations = { ...emptyAnnotations(), comments: new Map([[0x5201, 'read the key']]) };
    const lines = listingOf([0x00, 0xcd, 0x49, 0x00, 0xc9], { tables: different, annotations });
    expect(row(lines, 0x5201)).toEqual({ text: 'CALL $KBWAIT', comment: 'read the key; wait for a key [Model III]' });
  });

  describe('of RST n', () => {
    const rst08 = decodeAt([0xcf], 0);
    const onModel3 = (comparison: RomComparison): string | undefined =>
      externalComment(rst08, undefined, new ExternalNames(selectSymbols(MODEL_III, tablesOf({ 'rom-model3': [syncheck] }), comparison), () => false, []));

    it('carry the machine tag after NAME: purpose, as a named transfer does (spec 4.6)', () => {
      expect(onModel3({ '0008': 'different' })).toBe('$SYNCHK: check the next character [Model III]');
      expect(onModel3({ '0008': 'model3-only' })).toBe('$SYNCHK: check the next character [Model III]');
      expect(onModel3({})).toBe('$SYNCHK: check the next character [Model III]'); // an address the comparison does not list is not known to be shared
      const sync1 = entry('rom-model1', 'routine', 0x0008, '$SYNCHK', { purpose: 'check the next character' });
      const onModel1 = new ExternalNames(selectSymbols({ machine: 1, dos: 'none' }, tablesOf({ 'rom-model1': [sync1] }), { '0008': 'different' }), () => false, []);
      expect(externalComment(rst08, undefined, onModel1)).toBe('$SYNCHK: check the next character [Model I]');
    });

    it('carry no tag where the comparison classes the vector as shared', () => {
      expect(onModel3({ '0008': 'shared' })).toBe('$SYNCHK: check the next character');
    });

    it('are tagged in the comment column of a listing row, after the hint comment', () => {
      const different = selectSymbols(MODEL_III, tablesOf({ 'rom-model3': [syncheck] }), { '0008': 'different' });
      const annotations = { ...emptyAnnotations(), comments: new Map([[0x5201, 'check the comma']]) };
      const lines = listingOf([0x00, 0xcf, 0x2c, 0xc9], { tables: different, annotations });
      expect(row(lines, 0x5201)).toEqual({ text: 'RST 08H', comment: 'check the comma; $SYNCHK: check the next character [Model III]' });
      expect(row(listingOf([0x00, 0xcf, 0x2c, 0xc9], { tables: model3 }), 0x5201).comment).toBe('$SYNCHK: check the next character'); // shared: untagged
    });

    it('are tagged in zmac source too', () => {
      const different = selectSymbols(MODEL_III, tablesOf({ 'rom-model3': [syncheck] }), {});
      expect(zmacOf([0xcf, 0x2c, 0xc9], { tables: different })).toContain('\tRST\t08H\t; $SYNCHK: check the next character [Model III]\n');
    });

    it('are not tagged when the vector is a service call, which is not a ROM name', () => {
      // the empty comparison tags every ROM name, and a service call is not one
      expect(externalComment(decodeAt([0xef], 0, 2), decodeAt([0x3e, 0x0a], 0), new ExternalNames(selectSymbols(MODEL_IV, tablesOf({ 'svc-lsdos6': [dsply] }), {}), () => false, []))).toBe(
        '@DSPLY (SVC 10): display a line',
      );
    });
  });
});

describe('service calls on a Model 4', () => {
  const ldA10 = decodeAt([0x3e, 0x0a], 0);
  const rst28 = decodeAt([0xef], 0, 2);
  const four = new ExternalNames(model4, () => false, []);

  it('names RST 28H after LD A,n in the comment: NAME (SVC n): purpose', () => {
    expect(externalComment(rst28, ldA10, four)).toBe('@DSPLY (SVC 10): display a line');
  });

  it('names nothing else: the operand stays numeric, and LD A,n keeps its number', () => {
    const lines = listingOf([0x00, 0x3e, 0x0a, 0xef, 0xc9], { tables: model4 });
    expect(row(lines, 0x5201)).toEqual({ text: 'LD A,0AH', comment: undefined });
    expect(row(lines, 0x5203)).toEqual({ text: 'RST 28H', comment: '@DSPLY (SVC 10): display a line' });
  });

  it('needs the number loaded into A by the instruction right before, and a service call of that number', () => {
    expect(externalComment(rst28, undefined, four)).toBeUndefined();
    expect(externalComment(rst28, decodeAt([0x3e, 0x0b], 0), four)).toBeUndefined(); // no SVC 11
    expect(externalComment(rst28, decodeAt([0x06, 0x0a], 0), four)).toBeUndefined(); // LD B,10
    expect(externalComment(rst28, decodeAt([0x21, 0x0a, 0x00], 0), four)).toBeUndefined(); // LD HL,10
    expect(externalComment(rst28, decodeAt([0xaf], 0), four)).toBeUndefined(); // XOR A
    expect(externalComment(decodeAt([0xdf], 0, 2), ldA10, four)).toBeUndefined(); // RST 18H is not the service call
  });

  it('applies on a Model 4 only, whatever the tables hold', () => {
    const asModel3 = new ExternalNames(selectSymbols(MODEL_III, tablesOf({ 'svc-lsdos6': [dsply] }), {}), () => false, []);
    expect(asModel3.svc(10)).toBeUndefined();
    expect(externalComment(rst28, ldA10, asModel3)).toBeUndefined();
    // a Model III set that was handed a service call anyway still does not read RST 28H as one
    const odd = new ExternalNames(new SymbolSet(MODEL_III, [dsply], {}), () => false, []);
    expect(odd.svc(10)).toBe(dsply);
    expect(externalComment(rst28, ldA10, odd)).toBeUndefined();
  });

  it('gives no comment when a label makes the RST a place other code jumps to, since A is not known there', () => {
    // 5200 LD A,10 ; 5202 RST 28H ; 5203 JR 5202
    const bytes = [0x3e, 0x0a, 0xef, 0x18, 0xfd];
    const lines = listingOf(bytes, { tables: model4 });
    expect(row(lines, 0x5202).comment).toBeUndefined();
    // the same without the jump
    expect(row(listingOf([0x3e, 0x0a, 0xef, 0xc9], { tables: model4 }), 0x5202).comment).toBe('@DSPLY (SVC 10): display a line');
  });
});

describe('previousInstruction', () => {
  it('is the instruction that ends right before the address, with no label or data in between', () => {
    const a = program([0x3e, 0x0a, 0xef, 0xc9]);
    expect(previousInstruction(a.pass1.instructions, a.symbols, 0x5202)?.mnemonic).toBe('LD');
    expect(previousInstruction(a.pass1.instructions, a.symbols, 0x5203)?.mnemonic).toBe('RST');
    expect(previousInstruction(a.pass1.instructions, a.symbols, 0x5200)).toBeUndefined();
  });

  it('is nothing across a data byte: the inline parameter of RST 08H', () => {
    const a = program([0xcf, 0x2c, 0xc9]);
    expect(previousInstruction(a.pass1.instructions, a.symbols, 0x5202)).toBeUndefined();
  });

  it('is nothing where the program has a symbol', () => {
    const a = program([0x3e, 0x0a, 0xef, 0x18, 0xfd]);
    expect(a.symbols.has(0x5202)).toBe(true);
    expect(previousInstruction(a.pass1.instructions, a.symbols, 0x5202)).toBeUndefined();
    expect(previousInstruction(a.pass1.instructions, undefined, 0x5202)?.mnemonic).toBe('LD');
  });
});

describe('the operand classifier', () => {
  /** The use of each operand of the instruction these bytes decode to. */
  const uses = (bytes: number[], at = 0x5200): (string | undefined)[] => {
    const ins = decodeAt(bytes, 0, at);
    return ins.operands.map((op) => operandUse(ins, op));
  };

  it.each([
    ['CALL 0049H', [0xcd, 0x49, 0x00], ['code']],
    ['CALL Z,0049H', [0xcc, 0x49, 0x00], [undefined, 'code']],
    ['JP 402DH', [0xc3, 0x2d, 0x40], ['code']],
    ['JP NZ,402DH', [0xc2, 0x2d, 0x40], [undefined, 'code']],
    ['JR 5200H', [0x18, 0xfe], ['code']],
    ['JR NZ,5200H', [0x20, 0xfe], [undefined, 'code']],
    ['DJNZ 5200H', [0x10, 0xfe], ['code']],
    ['LD HL,3C00H', [0x21, 0x00, 0x3c], [undefined, 'data']],
    ['LD BC,3C00H', [0x01, 0x00, 0x3c], [undefined, 'data']],
    ['LD DE,3C00H', [0x11, 0x00, 0x3c], [undefined, 'data']],
    ['LD IX,3C00H', [0xdd, 0x21, 0x00, 0x3c], [undefined, 'data']],
    ['LD IY,3C00H', [0xfd, 0x21, 0x00, 0x3c], [undefined, 'data']],
    ['LD SP,3C00H', [0x31, 0x00, 0x3c], [undefined, undefined]],
    ['LD A,(3C00H)', [0x3a, 0x00, 0x3c], [undefined, 'data']],
    ['LD (3C00H),A', [0x32, 0x00, 0x3c], ['data', undefined]],
    ['LD HL,(3C00H)', [0x2a, 0x00, 0x3c], [undefined, 'data']],
    ['LD (3C00H),HL', [0x22, 0x00, 0x3c], ['data', undefined]],
    ['LD BC,(3C00H)', [0xed, 0x4b, 0x00, 0x3c], [undefined, 'data']],
    ['LD (3C00H),SP', [0xed, 0x73, 0x00, 0x3c], ['data', undefined]],
    ['OUT (0ECH),A', [0xd3, 0xec], ['port', undefined]],
    ['IN A,(0ECH)', [0xdb, 0xec], [undefined, 'port']],
    ['IN A,(C)', [0xed, 0x78], [undefined, undefined]],
    ['RST 08H', [0xcf], [undefined]],
    ['LD A,49H', [0x3e, 0x49], [undefined, undefined]],
    ['LD (HL),20H', [0x36, 0x20], [undefined, undefined]],
    ['JP (HL)', [0xe9], [undefined]],
    ['RET', [0xc9], []],
  ] as [string, number[], (string | undefined)[]][])('classifies the operands of %s', (_text, bytes, expected) => {
    expect(uses(bytes)).toEqual(expected);
  });

  it('gives the address or port number an operand refers to', () => {
    const value = (bytes: number[], at = 0x5200): (number | undefined)[] => decodeAt(bytes, 0, at).operands.map(operandValue);
    expect(value([0x18, 0x47], 0x0000)).toEqual([0x0049]);
    expect(value([0xcd, 0x49, 0x00])).toEqual([0x0049]);
    expect(value([0x3a, 0x20, 0x40])).toEqual([undefined, 0x4020]);
    expect(value([0xd3, 0xec])).toEqual([0xec, undefined]);
    expect(value([0xcf])).toEqual([undefined]);
  });

  it('is exported from the package root', () => {
    expect(disasm.operandUse).toBe(operandUse);
    expect(disasm.externalComment).toBe(externalComment);
  });

  it('is the rule the renderer and externalUses share: they name the same operands in every encoding', () => {
    const code = entry('rom-model3', 'routine', 0x3412, 'CODEX');
    const data = entry('hardware-model3', 'region', 0x3400, 'DATAX', { length: 0x100 });
    const port = entry('hardware-model3', 'port', 0x12, 'PORTX');
    const names = new ExternalNames(selectSymbols(MODEL_III, tablesOf({ 'rom-model3': [code], 'hardware-model3': [data, port] }), {}), () => false, []);
    const symbols = new SymbolTable();
    const sections: { prefix: number[]; cb: boolean; table: keyof typeof OPCODES }[] = [
      { prefix: [], cb: false, table: 'base' },
      { prefix: [0xcb], cb: false, table: 'cb' },
      { prefix: [0xed], cb: false, table: 'ed' },
      { prefix: [0xdd], cb: false, table: 'dd' },
      { prefix: [0xfd], cb: false, table: 'fd' },
      { prefix: [0xdd, 0xcb], cb: true, table: 'ddcb' },
      { prefix: [0xfd, 0xcb], cb: true, table: 'fdcb' },
    ];
    const seen = { CODEX: 0, DATAX: 0, PORTX: 0 };
    let encodings = 0;
    for (const s of sections) {
      for (let op = 0; op < 256; op++) {
        if (OPCODES[s.table][op]!.prefix !== undefined) continue;
        // operand bytes $12 $34: an immediate or address of $3412, a port of $12, a relative jump from $33FE to $3412
        const ins = decodeAt(s.cb ? [...s.prefix, 0x12, op] : [...s.prefix, op, 0x12, 0x34], 0, 0x33fe);
        const printed = renderInstruction(ins, symbols, names);
        const listed = externalUses([ins], names, symbols).map((e) => e.name).sort();
        const shown = (['CODEX', 'DATAX', 'PORTX'] as const).filter((n) => printed.includes(n));
        for (const n of shown) seen[n]++;
        expect(listed, `${printed} (${ins.bytes.map((b) => b.toString(16)).join(' ')})`).toEqual([...shown].sort());
        encodings++;
      }
    }
    expect(encodings).toBe(7 * 256 - 6);
    expect(seen.CODEX).toBeGreaterThan(10); // CALL, JP, and their conditional forms, JR, DJNZ
    expect(seen.DATAX).toBeGreaterThan(10);
    expect(seen.PORTX).toBe(2); // IN A,(n) and OUT (n),A
  });
});

describe('the pass 1 listing header', () => {
  /** The 27-byte routine of the social card: clear the screen, wait for ENTER, jump to DOS. */
  const ROUTINE = [0xf3, 0x31, 0x00, 0x70, 0x21, 0x00, 0x3c, 0x11, 0x01, 0x3c, 0x01, 0xff, 0x03, 0x36, 0x20, 0xed, 0xb0, 0xcd, 0x49, 0x00, 0xfe, 0x0d, 0x20, 0xf9, 0xc3, 0x2d, 0x40];

  it('says which tables it used on the line after the pass 1 line, and how many external targets were named', () => {
    const lines = listingOf(ROUTINE, { tables: model3 });
    expect(lines[1]).toBe('; pass 1: roots $5200; 27 of 27 bytes decoded as code (100%); 2 external targets (2 named); 0 notes');
    expect(lines[2]).toBe('; symbols: Model III ROM, hardware, TRSDOS 1.3');
  });

  it('counts the targets no table names: three external targets, two named', () => {
    const lines = listingOf([0xcd, 0x49, 0x00, 0xcd, 0x34, 0x12, 0xc3, 0x2d, 0x40], { tables: model3 });
    expect(lines[1]).toContain('3 external targets (2 named)');
  });

  it('says "1 external target (1 named)" in the singular', () => {
    const lines = listingOf([0xcd, 0x49, 0x00, 0xc9], { tables: model3 });
    expect(lines[1]).toContain('; 1 external target (1 named);');
  });

  it('leaves the count alone when there is no external target', () => {
    const lines = listingOf([0xc9], { tables: model3 });
    expect(lines[1]).toContain('; 0 external targets;');
    expect(lines[2]).toBe('; symbols: Model III ROM, hardware, TRSDOS 1.3');
  });

  it('lists a legend line for each name used, in table order then address: name, address, purpose, citation', () => {
    const lines = listingOf(ROUTINE, { tables: model3 });
    expect(lines.slice(3, 6)).toEqual([
      '; table name $KBWAIT = $0049: wait for a key (m3-basic 12/12)',
      '; table name VIDEO = $3C00: video memory (m3-trm 14)',
      '; table name $JP2DOS = $402D: return to TRSDOS READY (trsdos13 86)',
    ]);
    expect(lines.filter((l) => l.startsWith('; table name'))).toHaveLength(3);
  });

  it('shows a port as "port $EC" and cites every source', () => {
    const two = { ...modeport, cite: [{ source: 'm3-trm', page: '22' }, { source: 'decker', page: '53' }] };
    const tables = selectSymbols(MODEL_III, tablesOf({ 'hardware-model3': [two] }), {});
    const lines = listingOf([0xd3, 0xec, 0xc9], { tables });
    expect(lines).toContain('; table name MODEPORT = port $EC: mode select (m3-trm 22, decker 53)');
  });

  it('lists the RST and service-call names that appear only in comments, with the rest', () => {
    const rst = listingOf([0xcf, 0x2c, 0xcd, 0x49, 0x00, 0xc9], { tables: model3 });
    expect(rst.filter((l) => l.startsWith('; table name'))).toEqual([
      '; table name $SYNCHK = $0008: check the next character (m3-basic 12/3)',
      '; table name $KBWAIT = $0049: wait for a key (m3-basic 12/12)',
    ]);
    const four = listingOf([0x3e, 0x0a, 0xef, 0xc9], { tables: model4 });
    expect(four[2]).toBe('; symbols: Model 4 service calls (LS-DOS 6)');
    expect(four).toContain('; table name @DSPLY = SVC 10: display a line (soltoff 101)');
  });

  it('lists a name once, whether it is used in an operand, a DW row, or a comment', () => {
    // CALL 0008H and RST 08H, and a DW of 0008H in a declared table
    const bytes = [0xcd, 0x08, 0x00, 0xcf, 0x2c, 0xc9, 0x08, 0x00];
    const annotations = { ...emptyAnnotations(), tables: [{ addr: 0x5206, count: 1, width: 2 }] };
    const lines = listingOf(bytes, { tables: model3, annotations });
    expect(lines.filter((l) => l.startsWith('; table name $SYNCHK'))).toHaveLength(1);
  });

  it('lists a dropped name only when the program uses the address, and gives the program\'s own spelling', () => {
    const annotations = { ...emptyAnnotations(), names: new Map([[0x5200, 'VIDEO']]) };
    const used = listingOf([0x21, 0x00, 0x3c, 0xc9], { tables: model3, annotations });
    expect(used).toContain('; table name VIDEO not used: the program has its own VIDEO');
    expect(used.filter((l) => l.startsWith('; table name VIDEO ='))).toEqual([]);
    const unused = listingOf([0xc9], { tables: model3, annotations });
    expect(unused.filter((l) => l.startsWith('; table name'))).toEqual([]);
  });

  it('lists a dropped name once the legend is over, in table order', () => {
    const annotations = { ...emptyAnnotations(), names: new Map([[0x5200, 'video'], [0x5203, 'cursor']]) };
    const lines = listingOf([0x21, 0x00, 0x3c, 0x3a, 0x20, 0x40, 0xc3, 0x2d, 0x40], { tables: model3, annotations });
    const names = lines.filter((l) => l.startsWith('; table name'));
    expect(names).toEqual([
      '; table name $JP2DOS = $402D: return to TRSDOS READY (trsdos13 86)',
      '; table name CURSOR not used: the program has its own cursor',
      '; table name VIDEO not used: the program has its own video',
    ]);
  });

  it('counts a dropped name that only a comment would have used', () => {
    const tables = selectSymbols(MODEL_III, tablesOf({ 'rom-model3': [syncheck] }), SHARED);
    const annotations = { ...emptyAnnotations(), names: new Map([[0x5200, '$synchk']]) };
    const lines = listingOf([0xcf, 0x2c, 0xc9], { tables, annotations });
    expect(lines).toContain('; table name $SYNCHK not used: the program has its own $synchk');
    expect(row(lines, 0x5200).comment).toBe('entry');
  });

  it('prints nothing about tables without them, and changes no existing line', () => {
    const lines = listingOf(ROUTINE);
    expect(lines[1]).toBe('; pass 1: roots $5200; 27 of 27 bytes decoded as code (100%); 2 external targets; 0 notes');
    expect(lines.filter((l) => l.startsWith('; symbols') || l.startsWith('; table name'))).toEqual([]);
    expect(row(lines, 0x5211).text).toBe('CALL 0049H');
  });

  it('names the Model I tables, and no DOS with none', () => {
    const one = selectSymbols(MODEL_I, tablesOf({}), {});
    expect(listingOf([0xc9], { tables: one })[2]).toBe('; symbols: Model I ROM, hardware, LDOS 5.1');
    const bare = selectSymbols({ machine: 3, dos: 'none' }, tablesOf({}), {});
    expect(listingOf([0xc9], { tables: bare })[2]).toBe('; symbols: Model III ROM, hardware, no DOS');
  });
});

describe('DW rows', () => {
  /** RET; a 3-entry jump table at $5210; three typed words at $5218. */
  const bytes = (() => {
    const b = new Array<number>(0x20).fill(0);
    b[0] = 0xc9;
    b.splice(0x10, 6, 0x49, 0x00, 0x2d, 0x40, 0x00, 0x3c);
    b.splice(0x18, 6, 0x00, 0x3c, 0x40, 0x3d, 0x49, 0x00);
    return b;
  })();
  const annotations = { ...emptyAnnotations(), tables: [{ addr: 0x5210, count: 3, width: 2 }], overrides: [{ addr: 0x5218, kind: 'words' as const, length: 6 }] };

  it('names the entries of a declared jump table from the code names and typed words from the data names', () => {
    const lines = listingOf(bytes, { tables: model3, annotations });
    expect(row(lines, 0x5210).text).toBe('DW $KBWAIT,$JP2DOS');
    expect(row(lines, 0x5214).text).toBe('DW 3C00H'); // a table entry is a code address: nothing routine-shaped at $3C00
    expect(row(lines, 0x5218).text).toBe('DW VIDEO,VIDEO+0140H');
    expect(row(lines, 0x521c).text).toBe('DW 0049H'); // a typed word is a data address: $0049 is a routine
  });

  it('names the same words in the zmac source, and defines each name once', () => {
    const text = zmacOf(bytes, { tables: model3, annotations });
    expect(text).toContain('TBL_5210:\n\tDW\t$KBWAIT,$JP2DOS,3C00H\n');
    expect(text).toContain('\tDW\tVIDEO,VIDEO+0140H,0049H\n');
    for (const name of ['$KBWAIT', '$JP2DOS', 'VIDEO']) expect(text.split('\n').filter((l) => l.startsWith(`${name}\tEQU\t`)), name).toHaveLength(1);
    expect(text).not.toContain('CURSOR');
  });

  it('counts the words in the header and the IR', () => {
    const a = program(bytes, { tables: model3, annotations });
    expect(a.tablesUsed.map((e) => e.name)).toEqual(['$KBWAIT', 'VIDEO', '$JP2DOS']);
    expect(renderPass1Listing(a).split('\n')[1]).toContain('3 external targets (2 named)');
    expect(buildIr(a.module, a.pass1, 'x.bin', a).tableNames?.map((n) => n.name)).toEqual(['$KBWAIT', 'VIDEO', '$JP2DOS']);
  });

  it('gives the program\'s own name first: a table entry that points into the program is its label', () => {
    const into = [0xc9, ...new Array<number>(0x0f).fill(0), 0x00, 0x52];
    const lines = listingOf(into, { tables: model3, annotations: { ...emptyAnnotations(), tables: [{ addr: 0x5210, count: 1, width: 2 }] } });
    expect(row(lines, 0x5210).text).toBe('DW L5200');
  });

  it('leaves a word numeric where a label inside it breaks the pairing', () => {
    // a name at $5219 sits inside the first word of the region, so the region's words no longer start where it does
    const named = { ...annotations, names: new Map([[0x5219, 'INSIDE']]) };
    const text = zmacOf(bytes, { tables: model3, annotations: named });
    expect(text).toContain('\tDB\t00H\nINSIDE:\n');
    expect(text).not.toContain('VIDEO,VIDEO+0140H');
  });

  it('names no word without tables', () => {
    const lines = listingOf(bytes, { annotations });
    expect(row(lines, 0x5210).text).toBe('DW 0049H,402DH');
    expect(row(lines, 0x5218).text).toBe('DW 3C00H,3D40H');
  });

  it('keeps a .BAS program\'s line headers numeric: the line number 15360 is not the screen', () => {
    const prog = loadBas(writeBasic([{ number: 15360, text: 'END' }, { number: 15370, text: 'DEFUSR=28672' }], 0x7000));
    const a = analyze(prog, { tables: model3 });
    const text = emitZmac(prog.image, a.pass1, a.transfer, { symbols: a.symbols, annotations: a.annotations, space: a.space, externals: a.externals, tablesUsed: a.tablesUsed });
    expect(text).toContain('\tDW\t7006H,3C00H\n');
    expect(text).not.toContain('VIDEO');
    expect(a.tablesUsed).toEqual([]);
  });
});

describe('emitZmac with table names', () => {
  it('writes the name in the operand and the purpose as a trailing comment', () => {
    const text = zmacOf([0xcd, 0x49, 0x00, 0xc3, 0x2d, 0x40], { tables: model3 });
    expect(text).toContain('\tCALL\t$KBWAIT\t; wait for a key\n');
    expect(text).toContain('\tJP\t$JP2DOS\t; return to TRSDOS READY\n');
  });

  it('defines each name used once, before the program\'s own EQUs, as NAME, EQU, value, purpose', () => {
    // CALL 0049H twice, a port, and a program symbol inside an instruction (a name at $5208, inside LD HL,3C00H)
    const bytes = [0xcd, 0x49, 0x00, 0xcd, 0x49, 0x00, 0xd3, 0xec, 0x21, 0x00, 0x3c, 0xc9];
    const annotations = { ...emptyAnnotations(), names: new Map([[0x5209, 'MID']]) };
    const lines = zmacOf(bytes, { tables: model3, annotations }).split('\n');
    expect(lines.filter((l) => l.startsWith('$KBWAIT\tEQU'))).toEqual(['$KBWAIT\tEQU\t0049H\t; wait for a key']);
    expect(lines.slice(1, 4)).toEqual(['$KBWAIT\tEQU\t0049H\t; wait for a key', 'MODEPORT\tEQU\t0ECH\t; mode select', 'VIDEO\tEQU\t3C00H\t; video memory']); // table order, then number
    expect(lines.indexOf('MID\tEQU\t5209H')).toBeGreaterThan(3);
  });

  it('writes a port\'s EQU as a byte and a memory name\'s as a word', () => {
    const text = zmacOf([0xd3, 0xec, 0x21, 0x00, 0x3c, 0xc9], { tables: model3 });
    expect(text).toContain('MODEPORT\tEQU\t0ECH\t');
    expect(text).toContain('VIDEO\tEQU\t3C00H\t');
    expect(text).toContain('\tOUT\t(MODEPORT),A\n');
    expect(text).toContain('\tLD\tHL,VIDEO\n');
  });

  it('defines no name for a service call or an RST, which appear only in comments', () => {
    const rst = zmacOf([0xcf, 0x2c, 0xc9], { tables: model3 });
    expect(rst).toContain('\tRST\t08H\t; $SYNCHK: check the next character\n');
    expect(rst).not.toContain('EQU');
    const svc = zmacOf([0x3e, 0x0a, 0xef, 0xc9], { tables: model4 });
    expect(svc).toContain('\tRST\t28H\t; @DSPLY (SVC 10): display a line\n');
    expect(svc).toContain('\tLD\tA,0AH\n');
    expect(svc).not.toContain('EQU');
  });

  it('writes no EQU for a service call even if the caller lists one', () => {
    const a = program([0x3e, 0x0a, 0xef, 0xc9], { tables: model4 });
    const text = emitZmac(a.module.image, a.pass1, a.transfer, { externals: a.externals, tablesUsed: [dsply, kbwait] });
    expect(text).not.toContain('@DSPLY\tEQU');
    expect(text).toContain('$KBWAIT\tEQU\t0049H\t');
  });

  it('joins the comment after the hint comment', () => {
    const annotations = { ...emptyAnnotations(), comments: new Map([[0x5200, 'read the key']]) };
    expect(zmacOf([0xcd, 0x49, 0x00, 0xc9], { tables: model3, annotations })).toContain('\tCALL\t$KBWAIT\t; read the key; wait for a key\n');
  });

  it('defines the names itself when it is given the external names but not the list', () => {
    const a = program([0xcd, 0x49, 0x00, 0x21, 0x00, 0x3c, 0xc9], { tables: model3 });
    const text = emitZmac(a.module.image, a.pass1, a.transfer, { symbols: a.symbols, externals: a.externals });
    expect(text).toContain('$KBWAIT\tEQU\t0049H\t');
    expect(text).toContain('VIDEO\tEQU\t3C00H\t');
  });

  it('is unchanged without tables: no EQU, no comment, numbers in the operands', () => {
    const a = program([0xcd, 0x49, 0x00, 0xc9]);
    const plain = emitZmac(a.module.image, a.pass1, a.transfer, { symbols: a.symbols });
    expect(emitZmac(a.module.image, a.pass1, a.transfer, { symbols: a.symbols, externals: a.externals, tablesUsed: a.tablesUsed })).toBe(plain);
    expect(plain).toContain('\tCALL\t0049H\n');
    expect(plain).not.toContain('EQU');
  });

  it('writes a name through instructionLine too', () => {
    const ins = decodeAt([0xcd, 0x49, 0x00], 0);
    expect(instructionLine(ins, undefined, model3Names())).toBe('\tCALL\t$KBWAIT');
    expect(instructionLine(ins)).toBe('\tCALL\t0049H');
  });
});

describe('the IR with table names', () => {
  const bytes = [0xcd, 0x49, 0x00, 0xd3, 0xec, 0xc3, 0x2d, 0x40];

  it('carries the machine, the DOS, and each name used with its address, kind, table, purpose, and citations', () => {
    const a = program(bytes, { tables: model3 });
    const ir = buildIr(a.module, a.pass1, 'x.bin', a);
    expect(ir.machine).toBe(3);
    expect(ir.dos).toBe('trsdos');
    expect(ir.tableNames).toEqual([
      { key: 0x0049, name: '$KBWAIT', kind: 'routine', table: 'rom-model3', purpose: 'wait for a key', cite: [{ source: 'm3-basic', page: '12/12' }] },
      { key: 0x00ec, name: 'MODEPORT', kind: 'port', table: 'hardware-model3', purpose: 'mode select', cite: [{ source: 'm3-trm', page: '22' }] },
      { key: 0x402d, name: '$JP2DOS', kind: 'routine', table: 'dos-trsdos13', purpose: 'return to TRSDOS READY', cite: [{ source: 'trsdos13', page: '86' }] },
    ]);
  });

  it('survives a trip through JSON', () => {
    const a = program(bytes, { tables: model3 });
    const ir = buildIr(a.module, a.pass1, 'x.bin', a);
    expect(JSON.parse(JSON.stringify(ir)).tableNames).toEqual(ir.tableNames);
  });

  it('lists the RST and service-call names the listing shows, with the call number as the key', () => {
    const four = program([0x3e, 0x0a, 0xef, 0xc9], { tables: model4 });
    const ir = buildIr(four.module, four.pass1, 'x.bin', four);
    expect(ir.machine).toBe(4);
    expect(ir.dos).toBe('none');
    expect(ir.tableNames).toEqual([{ key: 10, name: '@DSPLY', kind: 'svc', table: 'svc-lsdos6', purpose: 'display a line', cite: [{ source: 'soltoff', page: '101' }] }]);
    const rst = program([0xcf, 0x2c, 0xc9], { tables: model3 });
    expect(buildIr(rst.module, rst.pass1, 'x.bin', rst).tableNames?.map((n) => n.name)).toEqual(['$SYNCHK']);
  });

  it('has an empty list when tables were supplied and nothing in the program takes a name', () => {
    const a = program([0xc9], { tables: model3 });
    const ir = buildIr(a.module, a.pass1, 'x.bin', a);
    expect(ir.machine).toBe(3);
    expect(ir.tableNames).toEqual([]);
  });

  it('has none of the three fields without tables', () => {
    const a = program(bytes);
    const ir = buildIr(a.module, a.pass1, 'x.bin', a);
    expect(Object.keys(ir)).not.toContain('machine');
    expect(Object.keys(ir)).not.toContain('dos');
    expect(Object.keys(ir)).not.toContain('tableNames');
    expect(Object.keys(buildIr(a.module, a.pass1))).not.toContain('tableNames');
  });
});

describe('commentEntries', () => {
  it('lists the entries a comment names, in table order, once: RST entry points and service calls as well as transfers', () => {
    const a = program([0xcf, 0x2c, 0xcd, 0x49, 0x00, 0xcf, 0x2c, 0xc9], { tables: model3 });
    expect(commentEntries(a.pass1.instructions, a.externals, a.symbols)).toEqual([syncheck, kbwait]);
    const four = program([0x3e, 0x0a, 0xef, 0x3e, 0x0a, 0xef, 0xc9], { tables: model4 });
    expect(commentEntries(four.pass1.instructions, four.externals, four.symbols)).toEqual([dsply]);
  });

  it('lists nothing without tables', () => {
    const a = program([0xcf, 0x2c, 0xcd, 0x49, 0x00, 0xc9]);
    expect(commentEntries(a.pass1.instructions, a.externals, a.symbols)).toEqual([]);
  });
});

describe('with the committed tables', () => {
  /** The generated tables for a machine and DOS, as the CLI uses them. */
  const real = (selection: SymbolSelection): SymbolSet => selectSymbols(selection);
  const listingWith = (selection: SymbolSelection, bytes: number[]): string[] => listingOf(bytes, { tables: real(selection) });

  it('comments RST 28H after LD A,0AH on a Model 4 as @DSPLY (SVC 10), and leaves the operand numeric', () => {
    const lines = listingWith(MODEL_IV, [0x00, 0x3e, 0x0a, 0xef, 0xc9]);
    expect(row(lines, 0x5201)).toEqual({ text: 'LD A,0AH', comment: undefined });
    expect(row(lines, 0x5203).comment).toMatch(/^@DSPLY \(SVC 10\): \S/);
    expect(lines.filter((l) => l.startsWith('; table name @DSPLY = SVC 10: '))).toHaveLength(1);
  });

  it('names a service call by its number: @KEY 1, @ABORT 21, @EXIT 22, and nothing for the reserved 23', () => {
    const comment = (n: number): string | undefined => row(listingWith(MODEL_IV, [0x00, 0x3e, n, 0xef, 0xc9]), 0x5203).comment;
    expect(comment(1)).toMatch(/^@KEY \(SVC 1\): /);
    expect(comment(21)).toMatch(/^@ABORT \(SVC 21\): /);
    expect(comment(22)).toMatch(/^@EXIT \(SVC 22\): /);
    expect(comment(23)).toBeUndefined();
  });

  it('names JP 402DH $JP2DOS under TRSDOS and @EXIT under LDOS, on a Model III, and @EXIT under LDOS on a Model I', () => {
    const jump = [0x00, 0xc3, 0x2d, 0x40];
    expect(row(listingWith({ machine: 3, dos: 'trsdos' }, jump), 0x5201).text).toBe('JP $JP2DOS');
    expect(row(listingWith({ machine: 3, dos: 'ldos' }, jump), 0x5201).text).toBe('JP @EXIT');
    expect(row(listingWith({ machine: 1, dos: 'ldos' }, jump), 0x5201).text).toBe('JP @EXIT');
    expect(row(listingWith({ machine: 3, dos: 'none' }, jump), 0x5201).text).toBe('JP 402DH');
  });

  it('names CALL 4420H $INIT under TRSDOS and @INIT under LDOS on a Model III, and gives each machine its own @CMD address', () => {
    const call = (addr: number): number[] => [0x00, 0xcd, addr & 0xff, addr >> 8, 0xc9];
    expect(row(listingWith({ machine: 3, dos: 'trsdos' }, call(0x4420)), 0x5201).text).toBe('CALL $INIT');
    expect(row(listingWith({ machine: 3, dos: 'ldos' }, call(0x4420)), 0x5201).text).toBe('CALL @INIT');
    expect(row(listingWith({ machine: 1, dos: 'ldos' }, call(0x4400)), 0x5201).text).toBe('CALL @CMD');
    expect(row(listingWith({ machine: 3, dos: 'ldos' }, call(0x4296)), 0x5201).text).toBe('CALL @CMD');
    expect(row(listingWith({ machine: 3, dos: 'ldos' }, call(0x4400)), 0x5201).text).toBe('CALL 4400H'); // EXTDBG$ is storage on the Model III
    expect(row(listingWith({ machine: 1, dos: 'ldos' }, call(0x4296)), 0x5201).text).toBe('CALL 4296H');
  });

  it('names storage that ends in a dollar sign as the manuals print it: HIGH$ and LDRV$ (and the Model I TIME$)', () => {
    expect(row(listingWith({ machine: 1, dos: 'ldos' }, [0x00, 0x2a, 0x49, 0x40, 0x3a, 0x08, 0x43, 0x21, 0x41, 0x40, 0xc9]), 0x5201).text).toBe('LD HL,(HIGH$)');
    expect(row(listingWith({ machine: 1, dos: 'ldos' }, [0x00, 0x2a, 0x49, 0x40, 0x3a, 0x08, 0x43, 0x21, 0x41, 0x40, 0xc9]), 0x5204).text).toBe('LD A,(LDRV$)');
    expect(row(listingWith({ machine: 1, dos: 'ldos' }, [0x00, 0x2a, 0x49, 0x40, 0x3a, 0x08, 0x43, 0x21, 0x41, 0x40, 0xc9]), 0x5207).text).toBe('LD HL,TIME$');
    expect(row(listingWith({ machine: 3, dos: 'ldos' }, [0x00, 0x2a, 0x11, 0x44, 0x3a, 0x27, 0x44, 0xc9]), 0x5201).text).toBe('LD HL,(HIGH$)');
    expect(row(listingWith({ machine: 3, dos: 'ldos' }, [0x00, 0x2a, 0x11, 0x44, 0x3a, 0x27, 0x44, 0xc9]), 0x5204).text).toBe('LD A,(LDRV$)');
  });

  it('names the RAM jump vectors on the default machine as on the Model I: LD A,(4012H) and LD (4013H),HL read INTVEC, LD DE,4000H SYNCHKVEC', () => {
    const hook = [0x3a, 0x12, 0x40, 0x22, 0x13, 0x40, 0xc9];
    const vector = [0x00, 0x11, 0x00, 0x40, 0xc9];
    for (const selection of [MODEL_III, MODEL_I]) {
      const where = `${selection.machine} ${selection.dos}`;
      const lines = listingWith(selection, hook);
      expect(row(lines, 0x5200).text, where).toBe('LD A,(INTVEC)');
      expect(row(lines, 0x5203).text, where).toBe('LD (INTVEC+0001H),HL');
      expect(lines.filter((l) => l.startsWith('; table name INTVEC = $4012: ')), where).toHaveLength(1);
      expect(row(listingWith(selection, vector), 0x5201).text, where).toBe('LD DE,SYNCHKVEC');
    }
  });

  it('gives a control block\'s address the ROM\'s name on both machines and under every DOS, LDOS\'s PRDCB$ being a note: LD DE,4025H', () => {
    const load = [0x00, 0x11, 0x25, 0x40, 0xc9];
    for (const selection of [MODEL_I, { machine: 3, dos: 'ldos' }, MODEL_III, { machine: 3, dos: 'none' }] as const) {
      expect(row(listingWith(selection, load), 0x5201).text, `${selection.machine} ${selection.dos}`).toBe('LD DE,PRDCB');
    }
  });

  it('keeps the ROM names for the ROM-resident addresses LDOS also names: CALL 0049H is $KBWAIT under LDOS, not @KEY', () => {
    const call = [0x00, 0xcd, 0x49, 0x00, 0xc9];
    expect(row(listingWith({ machine: 3, dos: 'ldos' }, call), 0x5201).text).toBe('CALL $KBWAIT');
    expect(row(listingWith({ machine: 1, dos: 'ldos' }, call), 0x5201).text).toBe('CALL $KBWAIT');
  });
});
