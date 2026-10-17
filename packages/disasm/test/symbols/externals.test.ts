/**
 * External names in Pass 2 (design spec §4.5, §5.2): the table names an address
 * outside the program may take, the program's own names that turn one away, and
 * the table entries a program's instructions end up using.
 */
import { decodeAt } from '@fugloy/z80';
import type { Instruction } from '@fugloy/z80';
import { describe, expect, it } from 'vitest';
import { ExternalNames, externalUses } from '../../src/analysis/externals.js';
import { SymbolTable } from '../../src/analysis/symbols.js';
import { emptyAnnotations } from '../../src/hints/apply.js';
import * as disasm from '../../src/index.js';
import { analyze } from '../../src/pipeline.js';
import { loadRaw } from '../../src/raw.js';
import { selectSymbols, SymbolSet } from '../../src/symbols/select.js';
import type { SymbolSelection } from '../../src/symbols/select.js';
import { entry, tablesOf } from './helpers.js';

const MODEL_III: SymbolSelection = { machine: 3, dos: 'trsdos' };
const MODEL_IV: SymbolSelection = { machine: 4, dos: 'none' };

const syncheck = entry('rom-model3', 'routine', 0x0008, '$SYNCHK', { purpose: 'check the next character' });
const vdchar = entry('rom-model3', 'routine', 0x0033, '$VDCHAR', { purpose: 'display the character in A' });
const kbwait = entry('rom-model3', 'routine', 0x0049, '$KBWAIT', { purpose: 'wait for a key' });
const romtable = entry('rom-model3', 'variable', 0x0020, 'ROMTABLE', { length: 4 });
const cursor = entry('rom-model3', 'variable', 0x4020, 'CURSOR', { length: 2 });
const usrvec = entry('rom-model3', 'vector', 0x408e, 'USRVEC', { length: 2 });
const keyboard = entry('hardware-model3', 'region', 0x3800, 'KEYBOARD', { length: 1024, coined: true });
const video = entry('hardware-model3', 'region', 0x3c00, 'VIDEO', { length: 1024, coined: true });
const modeport = entry('hardware-model3', 'port', 0xec, 'MODEPORT', { coined: true });
const jp2dos = entry('dos-trsdos13', 'routine', 0x402d, '$JP2DOS', { purpose: 'return to TRSDOS READY' });
const dsply = entry('svc-lsdos6', 'svc', 10, '@DSPLY', { purpose: 'display a line' });

/** Listed out of address order on purpose: nothing may depend on it. */
const model3 = selectSymbols(
  MODEL_III,
  tablesOf({ 'rom-model3': [kbwait, cursor, syncheck, usrvec, vdchar, romtable], 'hardware-model3': [video, modeport, keyboard], 'dos-trsdos13': [jp2dos] }),
  {},
);
const model4 = selectSymbols(MODEL_IV, tablesOf({ 'svc-lsdos6': [dsply] }), {});

const nothingLoaded = (): boolean => false;
const loadedBetween =
  (first: number, last: number) =>
  (addr: number): boolean =>
    addr >= first && addr <= last;
const external = new ExternalNames(model3, nothingLoaded, []);

describe('ExternalNames without tables', () => {
  const none = new ExternalNames(undefined, nothingLoaded, ['L5210']);

  it('names nothing and has no selection', () => {
    expect(none.code(0x0049)).toBeUndefined();
    expect(none.data(0x3c00)).toBeUndefined();
    expect(none.port(0xec)).toBeUndefined();
    expect(none.svc(10)).toBeUndefined();
    expect(none.machineTag(kbwait)).toBeUndefined();
    expect(none.dropped).toEqual([]);
    expect(none.selection).toBeUndefined();
  });
});

describe('ExternalNames.code', () => {
  it('names a routine or vector at an address outside the image, with the table name as its text', () => {
    expect(external.code(0x0049)).toEqual({ entry: kbwait, text: '$KBWAIT' });
    expect(external.code(0x402d)).toEqual({ entry: jp2dos, text: '$JP2DOS' });
    expect(external.code(0x408e)).toEqual({ entry: usrvec, text: 'USRVEC' });
  });

  it('names nothing the table has no routine at', () => {
    expect(external.code(0x004a)).toBeUndefined();
    expect(external.code(0x3c00)).toBeUndefined();
  });

  it('names nothing at a loaded address, though the table has a routine there', () => {
    const rom = new ExternalNames(model3, loadedBetween(0x0000, 0x0fff), []);
    expect(rom.code(0x0049)).toBeUndefined();
    expect(rom.code(0x402d)).toEqual({ entry: jp2dos, text: '$JP2DOS' });
  });
});

describe('ExternalNames.data', () => {
  it('gives the bare name at the start of a variable or region and NAME+offset inside it', () => {
    expect(external.data(0x3c00)).toEqual({ entry: video, text: 'VIDEO' });
    expect(external.data(0x3c00 + 0x140)).toEqual({ entry: video, text: 'VIDEO+0140H' });
    expect(external.data(0x3fff)).toEqual({ entry: video, text: 'VIDEO+03FFH' });
    expect(external.data(0x4021)).toEqual({ entry: cursor, text: 'CURSOR+0001H' });
  });

  it('ends a region at its last byte: $4000 is not VIDEO+0400H', () => {
    expect(external.data(0x4000)).toBeUndefined();
  });

  it('names nothing at a loaded address, though a region covers it', () => {
    const rom = new ExternalNames(model3, loadedBetween(0x3c00, 0x3c0f), []);
    expect(rom.data(0x3c08)).toBeUndefined();
    expect(rom.data(0x3c10)).toEqual({ entry: video, text: 'VIDEO+0010H' });
  });

  it('keeps a program loaded over system addresses (Volcano Hunter, $3C00-$4005) out of the hardware and DOS tables', () => {
    const volcano = new ExternalNames(model3, loadedBetween(0x3c00, 0x4005), []);
    expect(volcano.data(0x3c10)).toBeUndefined();
    expect(volcano.data(0x3fff)).toBeUndefined();
    expect(volcano.data(0x4005)).toBeUndefined();
    expect(volcano.data(0x3bf0)).toEqual({ entry: keyboard, text: 'KEYBOARD+03F0H' });
    expect(volcano.data(0x4020)).toEqual({ entry: cursor, text: 'CURSOR' });
    expect(volcano.code(0x402d)).toEqual({ entry: jp2dos, text: '$JP2DOS' });
  });
});

describe('ExternalNames.port and svc', () => {
  it('names a port by its number', () => {
    expect(external.port(0xec)).toEqual({ entry: modeport, text: 'MODEPORT' });
    expect(external.port(0xed)).toBeUndefined();
  });

  it('does not mistake a port number for an address: a loaded $00EC leaves port $EC named', () => {
    const rom = new ExternalNames(model3, loadedBetween(0x0000, 0x0fff), []);
    expect(rom.port(0xec)).toEqual({ entry: modeport, text: 'MODEPORT' });
  });

  it('gives a service call as its table entry, loaded memory or not', () => {
    const four = new ExternalNames(model4, loadedBetween(0x0000, 0xffff), []);
    expect(four.svc(10)).toBe(dsply);
    expect(four.svc(11)).toBeUndefined();
  });

  it('keeps ports and service calls apart from addresses of the same number', () => {
    expect(external.port(0x49)).toBeUndefined();
    expect(external.svc(0x49)).toBeUndefined();
    expect(external.code(0xec)).toBeUndefined();
  });
});

describe('ExternalNames.selection and machineTag', () => {
  it("report the tables' own selection and machine tags", () => {
    const tagged = new ExternalNames(selectSymbols(MODEL_III, tablesOf({ 'rom-model3': [kbwait, vdchar] }), { '0049': 'different', '0033': 'shared' }), nothingLoaded, []);
    expect(tagged.selection).toEqual(MODEL_III);
    expect(tagged.machineTag(kbwait)).toBe('[Model III]');
    expect(tagged.machineTag(vdchar)).toBeUndefined();
  });
});

describe('ExternalNames and the names the program uses itself', () => {
  const taken = (...names: string[]): ExternalNames => new ExternalNames(model3, nothingLoaded, names);

  it('drops a table name equal to a program name ignoring case, and lists it', () => {
    for (const name of ['VIDEO', 'video', 'Video']) {
      const names = taken('L5210', 'SUB_5340', name);
      expect(names.dropped, name).toEqual([video]);
      expect(names.data(0x3c00), name).toBeUndefined();
      expect(names.data(0x3d40), name).toBeUndefined();
    }
  });

  it('leaves every other table name alone', () => {
    const names = taken('video');
    expect(names.data(0x3800)).toEqual({ entry: keyboard, text: 'KEYBOARD' });
    expect(names.code(0x0049)).toEqual({ entry: kbwait, text: '$KBWAIT' });
    expect(names.port(0xec)).toEqual({ entry: modeport, text: 'MODEPORT' });
    expect(names.code(0x402d)).toEqual({ entry: jp2dos, text: '$JP2DOS' });
  });

  it('refuses a dropped entry through every lookup, whatever its kind', () => {
    const routine = entry('rom-model3', 'routine', 0x1000, 'ROUTINE');
    const variable = entry('rom-model3', 'variable', 0x2000, 'VARIABLE', { length: 4 });
    const vector = entry('rom-model3', 'vector', 0x3000, 'VECTOR', { length: 2 });
    const region = entry('hardware-model3', 'region', 0x4000, 'REGION', { length: 16 });
    const port = entry('hardware-model3', 'port', 0x10, 'PORT');
    const call = entry('svc-lsdos6', 'svc', 10, 'CALL');
    const everything = new SymbolSet(MODEL_III, [routine, variable, vector, region, port, call], {});
    const lookups = (names: ExternalNames): unknown[] => [names.code(0x1000), names.data(0x2001), names.code(0x3000), names.data(0x3001), names.data(0x4005), names.port(0x10), names.svc(10)];

    const offered = lookups(new ExternalNames(everything, nothingLoaded, []));
    expect(offered.filter((found) => found === undefined)).toEqual([]);

    const names = new ExternalNames(everything, nothingLoaded, ['routine', 'Variable', 'VECTOR', 'region', 'Port', 'call']);
    expect(lookups(names)).toEqual(Array(7).fill(undefined));
    expect(names.dropped).toEqual([routine, variable, vector, region, port, call]);
  });

  it('folds case on the table side too, so a table name in mixed case is dropped by a program name in capitals', () => {
    const screen = entry('hardware-model3', 'region', 0x3c00, 'Screen', { length: 1024, coined: true });
    const names = new ExternalNames(new SymbolSet(MODEL_III, [screen], {}), nothingLoaded, ['SCREEN']);
    expect(names.dropped).toEqual([screen]);
    expect(names.data(0x3c00)).toBeUndefined();
  });

  it('keeps KBWAIT and $KBWAIT apart, as zmac does', () => {
    const names = taken('KBWAIT');
    expect(names.dropped).toEqual([]);
    expect(names.code(0x0049)).toEqual({ entry: kbwait, text: '$KBWAIT' });
  });

  it('lists the dropped entries in table order, whether or not anything uses them', () => {
    expect(taken('MODEPORT', 'video', 'cursor').dropped).toEqual([cursor, video, modeport]);
    expect(taken('L5210').dropped).toEqual([]);
  });

  it('takes the program names from any iterable', () => {
    expect(new ExternalNames(model3, nothingLoaded, new Set(['video'])).dropped).toEqual([video]);
    expect(new ExternalNames(model3, nothingLoaded, new Map([['cursor', 1]]).keys()).dropped).toEqual([cursor]);
  });
});

describe('externalUses', () => {
  /** The instruction these bytes decode to when they sit at `at`. */
  const ins = (bytes: number[], at = 0x5200): Instruction => decodeAt(bytes, 0, at);
  const used = (instructions: Instruction[], names: ExternalNames = external): string[] => externalUses(instructions, names).map((e) => e.name);

  it.each([
    ['CALL 0049H', [0xcd, 0x49, 0x00], '$KBWAIT'],
    ['CALL Z,0049H', [0xcc, 0x49, 0x00], '$KBWAIT'],
    ['JP 402DH', [0xc3, 0x2d, 0x40], '$JP2DOS'],
    ['JP NZ,402DH', [0xc2, 0x2d, 0x40], '$JP2DOS'],
  ] as [string, number[], string][])('names the target of %s from the code names', (_text, bytes, name) => {
    expect(used([ins(bytes)])).toEqual([name]);
  });

  it('names the target of JR, JR cc, and DJNZ: at $0000 a displacement of $47 lands on $0049', () => {
    expect(used([ins([0x18, 0x47], 0x0000)])).toEqual(['$KBWAIT']);
    expect(used([ins([0x20, 0x47], 0x0000)])).toEqual(['$KBWAIT']);
    expect(used([ins([0x10, 0x47], 0x0000)])).toEqual(['$KBWAIT']);
  });

  it.each([
    ['LD HL,3C00H', [0x21, 0x00, 0x3c]],
    ['LD BC,3C00H', [0x01, 0x00, 0x3c]],
    ['LD DE,3C00H', [0x11, 0x00, 0x3c]],
    ['LD IX,3C00H', [0xdd, 0x21, 0x00, 0x3c]],
    ['LD IY,3C00H', [0xfd, 0x21, 0x00, 0x3c]],
    ['LD HL,(3C00H)', [0x2a, 0x00, 0x3c]],
    ['LD A,(3C00H)', [0x3a, 0x00, 0x3c]],
    ['LD (3C00H),A', [0x32, 0x00, 0x3c]],
    ['LD (3C00H),HL', [0x22, 0x00, 0x3c]],
    ['LD BC,(3C00H)', [0xed, 0x4b, 0x00, 0x3c]],
    ['LD (3C00H),SP', [0xed, 0x73, 0x00, 0x3c]],
  ] as [string, number[]][])('names the address %s refers to from the data names', (_text, bytes) => {
    expect(used([ins(bytes)])).toEqual(['VIDEO']);
  });

  it('counts the entry an offset into it belongs to', () => {
    expect(used([ins([0x21, 0x40, 0x3d])])).toEqual(['VIDEO']);
    expect(used([ins([0x3a, 0x21, 0x40])])).toEqual(['CURSOR']);
  });

  it('names no 16-bit immediate that is not an address reference: LD SP,nn is a constant', () => {
    expect(used([ins([0x31, 0x00, 0x3c])])).toEqual([]);
    expect(used([ins([0x31, 0x49, 0x00])])).toEqual([]);
  });

  it('names an IN or OUT port from the port names, and not IN r,(C), which has no port operand', () => {
    expect(used([ins([0xd3, 0xec])])).toEqual(['MODEPORT']);
    expect(used([ins([0xdb, 0xec])])).toEqual(['MODEPORT']);
    expect(used([ins([0xed, 0x78])])).toEqual([]);
  });

  it('keeps ports and addresses apart: OUT (49H),A is not $KBWAIT and CALL 00ECH is not MODEPORT', () => {
    expect(used([ins([0xd3, 0x49])])).toEqual([]);
    expect(used([ins([0xcd, 0xec, 0x00])])).toEqual([]);
  });

  it('never names an RST, which keeps its number and takes a comment instead', () => {
    expect(used([ins([0xcf])])).toEqual([]);
    expect(used([ins([0xff])])).toEqual([]);
  });

  it('never names an 8-bit immediate, whatever table key it matches', () => {
    // LD A,49H / CP 0ECH / ADD A,33H / LD B,08H: a routine, a port, a routine, an RST; LD (HL),20H / LD A,22H: inside ROMTABLE
    expect(used([ins([0x3e, 0x49]), ins([0xfe, 0xec]), ins([0xc6, 0x33]), ins([0x06, 0x08]), ins([0x36, 0x20]), ins([0x3e, 0x22])])).toEqual([]);
  });

  it('names a call to a routine but not the same number used as a count: CALL 0033H and LD BC,0033H', () => {
    const call = ins([0xcd, 0x33, 0x00]);
    const count = ins([0x01, 0x33, 0x00]);
    expect(used([call, count])).toEqual(['$VDCHAR']);
    expect(used([count])).toEqual([]);
  });

  it('counts a vector once, whether it is jumped to, read as a word, or reached at its second byte', () => {
    expect(used([ins([0xc3, 0x8e, 0x40]), ins([0x2a, 0x8e, 0x40]), ins([0x2a, 0x8f, 0x40]), ins([0xcd, 0x8e, 0x40])])).toEqual(['USRVEC']);
  });

  it('lists each entry once, in table order and then by key, whatever the order the instructions use them in', () => {
    const program = [
      ins([0xc3, 0x2d, 0x40]), // JP 402DH            dos-trsdos13
      ins([0x21, 0x00, 0x3c]), // LD HL,3C00H         hardware-model3, VIDEO
      ins([0xd3, 0xec]), //       OUT (0ECH),A        hardware-model3, MODEPORT
      ins([0xcd, 0x49, 0x00]), // CALL 0049H          rom-model3
      ins([0x3a, 0x20, 0x40]), // LD A,(4020H)        rom-model3, CURSOR: after VIDEO by address, before it by table
      ins([0xcd, 0x33, 0x00]), // CALL 0033H          rom-model3
      ins([0xcd, 0x49, 0x00]), // CALL 0049H again
      ins([0x3a, 0x01, 0x3c]), // LD A,(3C01H)        VIDEO again
    ];
    const expected = ['$VDCHAR', '$KBWAIT', 'CURSOR', 'MODEPORT', 'VIDEO', '$JP2DOS'];
    expect(used(program)).toEqual(expected);
    expect(used([...program].reverse())).toEqual(expected);
    expect(externalUses(program, external)[0]).toBe(vdchar);
  });

  it('takes any iterable of instructions, as Pass 1 keeps them in a Map', () => {
    const instructions = new Map([[0x5200, ins([0xcd, 0x49, 0x00])]]);
    expect(externalUses(instructions.values(), external)).toEqual([kbwait]);
  });

  it('skips an address the program has loaded', () => {
    const rom = new ExternalNames(model3, loadedBetween(0x0000, 0x00ff), []);
    expect(used([ins([0xcd, 0x49, 0x00]), ins([0xc3, 0x2d, 0x40])], rom)).toEqual(['$JP2DOS']);
  });

  it('skips a table name the program has taken, leaving the address numeric', () => {
    const names = new ExternalNames(model3, nothingLoaded, ['video']);
    expect(used([ins([0x21, 0x00, 0x3c]), ins([0xcd, 0x49, 0x00])], names)).toEqual(['$KBWAIT']);
  });

  it('skips an operand at an address the program has a symbol for, which the renderer names first', () => {
    const symbols = new SymbolTable();
    for (const addr of [0x0049, 0x3c00, 0x4020]) symbols.set({ addr, name: `MINE_${addr.toString(16)}`, kind: 'data', source: 'user' });
    const program = [ins([0xcd, 0x49, 0x00]), ins([0x21, 0x00, 0x3c]), ins([0x3a, 0x20, 0x40]), ins([0x18, 0x47], 0x0000)];
    expect(used(program)).toEqual(['$KBWAIT', 'CURSOR', 'VIDEO']);
    expect(externalUses(program, external, symbols)).toEqual([]);
  });

  it('does not let a program symbol at $00EC hide port $EC, which is a number and not an address', () => {
    const symbols = new SymbolTable();
    symbols.set({ addr: 0x00ec, name: 'MINE', kind: 'data', source: 'user' });
    expect(externalUses([ins([0xd3, 0xec])], external, symbols)).toEqual([modeport]);
  });

  it('lists no service call: those only ever appear in comments', () => {
    const four = new ExternalNames(model4, nothingLoaded, []);
    expect(used([ins([0x3e, 0x0a]), ins([0xef])], four)).toEqual([]);
  });

  it('lists nothing without tables', () => {
    expect(used([ins([0xcd, 0x49, 0x00]), ins([0x21, 0x00, 0x3c])], new ExternalNames(undefined, nothingLoaded, []))).toEqual([]);
  });
});

describe('analyze with tables', () => {
  /** The 27-byte routine of the social card: clear the screen, wait for ENTER, jump to DOS. */
  const ROUTINE = Uint8Array.from([0xf3, 0x31, 0x00, 0x70, 0x21, 0x00, 0x3c, 0x11, 0x01, 0x3c, 0x01, 0xff, 0x03, 0x36, 0x20, 0xed, 0xb0, 0xcd, 0x49, 0x00, 0xfe, 0x0d, 0x20, 0xf9, 0xc3, 0x2d, 0x40]);
  /** What the seed data holds for the routine's two external calls. */
  const seed = selectSymbols(MODEL_III, tablesOf({ 'rom-model3': [kbwait], 'dos-trsdos13': [jp2dos] }), {});

  it('names nothing without tables: no selection, nothing dropped, nothing used', () => {
    const a = analyze(loadRaw(ROUTINE, 0x5200));
    expect(a.externals.code(0x49)).toBeUndefined();
    expect(a.externals.data(0x3c00)).toBeUndefined();
    expect(a.externals.selection).toBeUndefined();
    expect(a.externals.dropped).toEqual([]);
    expect(a.tablesUsed).toEqual([]);
  });

  it("lists the two external calls of the routine: $0049 and $402D, in the tables' order", () => {
    const a = analyze(loadRaw(ROUTINE, 0x5200), { tables: seed });
    expect(a.tablesUsed.map((e) => e.key)).toEqual([0x0049, 0x402d]);
    expect(a.tablesUsed).toEqual([kbwait, jp2dos]);
    expect(a.externals.selection).toEqual(MODEL_III);
    expect(a.externals.code(0x0049)).toEqual({ entry: kbwait, text: '$KBWAIT' });
  });

  it('adds the screen when the hardware table has it: LD HL,3C00H and LD DE,3C01H are one entry', () => {
    const withVideo = selectSymbols(MODEL_III, tablesOf({ 'rom-model3': [kbwait], 'hardware-model3': [video], 'dos-trsdos13': [jp2dos] }), {});
    const a = analyze(loadRaw(ROUTINE, 0x5200), { tables: withVideo });
    expect(a.tablesUsed.map((e) => e.name)).toEqual(['$KBWAIT', 'VIDEO', '$JP2DOS']);
  });

  it('changes no analysis: the tables only add names', () => {
    const plain = analyze(loadRaw(ROUTINE, 0x5200));
    const named = analyze(loadRaw(ROUTINE, 0x5200), { tables: seed });
    expect(named.symbols.list()).toEqual(plain.symbols.list());
    expect(named.roots).toEqual(plain.roots);
    expect(named.pass1.externals).toEqual(plain.pass1.externals);
    expect([...named.pass1.instructions.keys()]).toEqual([...plain.pass1.instructions.keys()]);
    expect(named.proposals).toEqual(plain.proposals);
  });

  it("keeps the program's own addresses: a call into the image is its own label, never a ROM name", () => {
    // CALL 0049H at $0040, with a RET at $0049 inside the image.
    const program = Uint8Array.from([0xcd, 0x49, 0x00, ...Array(6).fill(0x00), 0xc9]);
    const a = analyze(loadRaw(program, 0x0040), { tables: seed });
    expect(a.symbols.get(0x0049)?.name).toBe('SUB_0049');
    expect(a.externals.code(0x0049)).toBeUndefined();
    expect(a.tablesUsed).toEqual([]);
  });

  it('treats a region relocated over the DOS page as loaded there, so a program running at $4400 keeps its own labels', () => {
    const cmd = entry('dos-ldos51-model1', 'routine', 0x4400, '@CMD');
    const tables = selectSymbols({ machine: 1, dos: 'ldos' }, tablesOf({ 'dos-ldos51-model1': [cmd] }), {});
    // JP 4400H, then 13 RETs that a relocate hint says run at $4400.
    const program = Uint8Array.from([0xc3, 0x00, 0x44, ...Array(13).fill(0xc9)]);
    const annotations = { ...emptyAnnotations(), relocations: [{ fileAddr: 0x5203, length: 13, runAddr: 0x4400 }] };

    const moved = analyze(loadRaw(program, 0x5200), { tables, annotations });
    expect(moved.space.image.isLoaded(0x4400)).toBe(true);
    expect(moved.symbols.get(0x4400)?.name).toBe('L4400');
    expect(moved.externals.code(0x4400)).toBeUndefined();
    expect(moved.tablesUsed).toEqual([]);

    const unmoved = analyze(loadRaw(program, 0x5200), { tables });
    expect(unmoved.tablesUsed).toEqual([cmd]);
  });

  it('drops a table name the hint file also gives, ignoring case, so the address stays numeric', () => {
    const tables = selectSymbols(MODEL_III, tablesOf({ 'hardware-model3': [video] }), {});
    const annotations = { ...emptyAnnotations(), names: new Map([[0x5200, 'video']]) };
    const a = analyze(loadRaw(Uint8Array.from([0x21, 0x00, 0x3c, 0xc9]), 0x5200), { tables, annotations });
    expect(a.symbols.get(0x5200)?.name).toBe('video');
    expect(a.externals.dropped).toEqual([video]);
    expect(a.externals.data(0x3c00)).toBeUndefined();
    expect(a.tablesUsed).toEqual([]);
  });

  it('drops a table name equal to a name the analysis synthesized for the program', () => {
    const lookalike = entry('rom-model3', 'routine', 0x0049, 'SUB_5204', { coined: true });
    const tables = selectSymbols(MODEL_III, tablesOf({ 'rom-model3': [lookalike] }), {});
    // CALL 5204H / RET: Pass 2 names $5204 SUB_5204, which the ROM name above would collide with.
    const a = analyze(loadRaw(Uint8Array.from([0xcd, 0x04, 0x52, 0xc9, 0xc9]), 0x5200), { tables });
    expect(a.symbols.get(0x5204)?.name).toBe('SUB_5204');
    expect(a.externals.dropped).toEqual([lookalike]);
  });

  it('leaves an address the program names itself to the program: the user name wins over the ROM name', () => {
    const annotations = { ...emptyAnnotations(), names: new Map([[0x0049, 'MYKEY']]) };
    const a = analyze(loadRaw(Uint8Array.from([0xcd, 0x49, 0x00, 0xc9]), 0x5200), { tables: seed, annotations });
    expect(a.symbols.get(0x0049)?.name).toBe('MYKEY');
    expect(a.tablesUsed).toEqual([]);
  });
});

describe('the package exports', () => {
  it('exports the external names for callers that hold an Analysis', () => {
    expect(disasm.ExternalNames).toBe(ExternalNames);
    expect(disasm.externalUses).toBe(externalUses);
  });
});
