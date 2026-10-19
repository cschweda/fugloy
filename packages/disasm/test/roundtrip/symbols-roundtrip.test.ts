/**
 * Table names change no byte: the zmac source, with an EQU for each name it uses,
 * assembles back to the identical image under every machine and DOS.
 */
import { describe, expect } from 'vitest';
import { emitZmac } from '../../src/emit/zmac.js';
import { emptyAnnotations } from '../../src/hints/apply.js';
import type { Annotations } from '../../src/hints/apply.js';
import { analyze } from '../../src/pipeline.js';
import { loadRaw } from '../../src/raw.js';
import { selectSymbols } from '../../src/symbols/select.js';
import type { SymbolSelection, SymbolSet } from '../../src/symbols/select.js';
import { entry, tablesOf } from '../symbols/helpers.js';
import { assemble, expectSameImage, withAssembler } from './zmac.js';

const test = withAssembler();

/** The 27-byte routine of the social card: clear the screen, wait for ENTER, jump to DOS. */
const ROUTINE = Uint8Array.from([0xf3, 0x31, 0x00, 0x70, 0x21, 0x00, 0x3c, 0x11, 0x01, 0x3c, 0x01, 0xff, 0x03, 0x36, 0x20, 0xed, 0xb0, 0xcd, 0x49, 0x00, 0xfe, 0x0d, 0x20, 0xf9, 0xc3, 0x2d, 0x40]);

/** Analyzes `bytes` at $5200 with `tables`, writes zmac source, assembles it, and checks that the image is the one that went in. */
function roundTrip(bytes: Uint8Array, tables: SymbolSet, annotations: Annotations = emptyAnnotations()): string {
  const mod = loadRaw(bytes, 0x5200);
  const a = analyze(mod, { tables, annotations });
  const source = emitZmac(mod.image, a.pass1, a.transfer, { source: 'x.bin', symbols: a.symbols, annotations: a.annotations, space: a.space, externals: a.externals, tablesUsed: a.tablesUsed });
  expectSameImage(assemble(source, { model: tables.selection.machine, dos: tables.selection.dos }).module.image, mod.image);
  return source;
}

describe('the 27-byte routine under the real tables', () => {
  const selections: SymbolSelection[] = [
    { machine: 3, dos: 'trsdos' },
    { machine: 3, dos: 'ldos' },
    { machine: 1, dos: 'ldos' },
    { machine: 3, dos: 'none' },
  ];
  for (const selection of selections) {
    test(`assembles back to the identical image under machine ${selection.machine} with ${selection.dos}`, () => {
      roundTrip(ROUTINE, selectSymbols(selection));
    });
  }

  test('writes the Model III names as operands and defines them: CALL $KBWAIT and JP $JP2DOS', () => {
    const source = roundTrip(ROUTINE, selectSymbols({ machine: 3, dos: 'trsdos' }));
    expect(source).toContain('\tCALL\t$KBWAIT');
    expect(source).toContain('\tJP\t$JP2DOS');
    expect(source).toContain('$KBWAIT\tEQU\t0049H');
    expect(source).toContain('$JP2DOS\tEQU\t402DH');
  });

  test('is unchanged without tables, in source and in image', () => {
    const mod = loadRaw(ROUTINE, 0x5200);
    const a = analyze(mod);
    const source = emitZmac(mod.image, a.pass1, a.transfer, { symbols: a.symbols, annotations: a.annotations, space: a.space, externals: a.externals, tablesUsed: a.tablesUsed });
    expect(source).toContain('\tCALL\t0049H');
    expect(source).not.toContain('EQU');
    expectSameImage(assemble(source).module.image, mod.image);
  });
});

describe('a program that uses every kind of reference, under in-memory tables', () => {
  const syncheck = entry('rom-model3', 'routine', 0x0008, '$SYNCHK', { purpose: 'check the next character' });
  const vdchar = entry('rom-model3', 'routine', 0x0033, '$VDCHAR', { purpose: 'display the character in A' });
  const kbwait = entry('rom-model3', 'routine', 0x0049, '$KBWAIT', { purpose: 'wait for a key' });
  const cursor = entry('rom-model3', 'variable', 0x4020, 'CURSOR', { length: 2 });
  const video = entry('hardware-model3', 'region', 0x3c00, 'VIDEO', { length: 1024, coined: true });
  const modeport = entry('hardware-model3', 'port', 0xec, 'MODEPORT', { coined: true });
  const jp2dos = entry('dos-trsdos13', 'routine', 0x402d, '$JP2DOS', { purpose: 'return to TRSDOS READY' });
  /** The ROM addresses are the same on both machines, so no comment carries a machine tag. */
  const shared = { '0008': 'shared', '0033': 'shared', '0049': 'shared', '4020': 'shared' } as const;
  const tables = selectSymbols({ machine: 3, dos: 'trsdos' }, tablesOf({ 'rom-model3': [syncheck, vdchar, kbwait, cursor], 'hardware-model3': [video, modeport], 'dos-trsdos13': [jp2dos] }), shared);

  /** Calls, a count, the screen, a variable, a port, an RST, jumps; a jump table at $5240; typed words at $5248. */
  const code = [
    0xcd, 0x49, 0x00, //       5200 CALL $KBWAIT
    0xcd, 0x33, 0x00, //       5203 CALL $VDCHAR
    0x01, 0x33, 0x00, //       5206 LD BC,0033H
    0x21, 0x00, 0x3c, //       5209 LD HL,VIDEO
    0x11, 0x40, 0x3d, //       520C LD DE,VIDEO+0140H
    0x3a, 0x20, 0x40, //       520F LD A,(CURSOR)
    0x32, 0x21, 0x40, //       5212 LD (CURSOR+0001H),A
    0x2a, 0x20, 0x40, //       5215 LD HL,(CURSOR)
    0xd3, 0xec, //             5218 OUT (MODEPORT),A
    0xdb, 0xec, //             521A IN A,(MODEPORT)
    0xcf, 0x2c, //             521C RST 08H / DB ','
    0x3e, 0x49, //             521E LD A,49H
    0xc2, 0x2d, 0x40, //       5220 JP NZ,$JP2DOS
    0xc3, 0x30, 0x52, //       5223 JP L5230
  ];
  const bytes = new Uint8Array(0x50);
  bytes.set(code, 0);
  bytes[0x30] = 0xc9; //                                  5230 RET
  bytes.set([0x49, 0x00, 0x2d, 0x40, 0x30, 0x52], 0x40); // 5240 DW $KBWAIT,$JP2DOS,L5230
  bytes.set([0x00, 0x3c, 0x40, 0x3d, 0x49, 0x00], 0x48); // 5248 DW VIDEO,VIDEO+0140H,0049H
  const annotations: Annotations = { ...emptyAnnotations(), tables: [{ addr: 0x5240, count: 3, width: 2 }], overrides: [{ addr: 0x5248, kind: 'words', length: 6 }] };

  test('assembles back to the identical image', () => {
    const source = roundTrip(bytes, tables, annotations);
    for (const text of [
      '\tCALL\t$KBWAIT\t; wait for a key',
      '\tLD\tHL,VIDEO\n',
      '\tLD\tDE,VIDEO+0140H\n',
      '\tLD\tA,(CURSOR)\n',
      '\tLD\t(CURSOR+0001H),A\n',
      '\tOUT\t(MODEPORT),A\n',
      '\tIN\tA,(MODEPORT)\n',
      '\tRST\t08H\t; $SYNCHK: check the next character\n',
      '\tLD\tBC,0033H\n',
      '\tJP\tNZ,$JP2DOS\t; return to TRSDOS READY\n',
      '\tDW\t$KBWAIT,$JP2DOS,L5230\n',
      '\tDW\tVIDEO,VIDEO+0140H,0049H\n',
    ]) {
      expect(source).toContain(text);
    }
  });

  test('assembles back to the identical image when the comments carry machine tags, an RST\'s included', () => {
    // an empty comparison does not class any ROM address as shared, so every ROM name's comment is tagged
    const untrusted = selectSymbols({ machine: 3, dos: 'trsdos' }, tablesOf({ 'rom-model3': [syncheck, vdchar, kbwait, cursor], 'hardware-model3': [video, modeport], 'dos-trsdos13': [jp2dos] }), {});
    const source = roundTrip(bytes, untrusted, annotations);
    expect(source).toContain('\tCALL\t$KBWAIT\t; wait for a key [Model III]\n');
    expect(source).toContain('\tRST\t08H\t; $SYNCHK: check the next character [Model III]\n');
    expect(source).toContain('\tJP\tNZ,$JP2DOS\t; return to TRSDOS READY\n'); // a DOS name is not a ROM name
  });

  test('defines each name once', () => {
    const source = roundTrip(bytes, tables, annotations);
    for (const name of ['$KBWAIT', '$VDCHAR', 'CURSOR', 'VIDEO', 'MODEPORT', '$JP2DOS']) {
      expect(source.split('\n').filter((l) => l.startsWith(`${name}\tEQU\t`)), name).toHaveLength(1);
    }
    expect(source).not.toContain('$SYNCHK\tEQU'); // an RST appears only in its comment
  });

  test('keeps the address numeric where the program has a name equal to the table\'s ignoring case, and still assembles', () => {
    // zmac folds case: defining both `video:` and `VIDEO EQU` would stop it
    const named: Annotations = { ...emptyAnnotations(), names: new Map([[0x5200, 'video']]) };
    const source = roundTrip(Uint8Array.from([0x21, 0x00, 0x3c, 0xc9]), tables, named);
    expect(source).toContain('video:\n\tLD\tHL,3C00H\n');
    expect(source).not.toContain('VIDEO\tEQU');
  });

  test('assembles a relocated piece that calls a ROM routine and holds typed words, at its runtime address', () => {
    // file $5210-$5217 runs at $6000: CALL 0049H / RET / DW 3C00H,3D40H
    const moved = new Uint8Array(0x20);
    moved[0] = 0xc9;
    moved.set([0xcd, 0x49, 0x00, 0xc9, 0x00, 0x3c, 0x40, 0x3d], 0x10);
    const relocated: Annotations = {
      ...emptyAnnotations(),
      relocations: [{ fileAddr: 0x5210, length: 8, runAddr: 0x6000 }],
      overrides: [{ addr: 0x6004, kind: 'words', length: 4 }],
      entries: [0x6000],
    };
    const source = roundTrip(moved, tables, relocated);
    expect(source).toContain('\t.PHASE\t6000H\n\tCALL\t$KBWAIT\t; wait for a key\n\tRET\n\tDW\tVIDEO,VIDEO+0140H\n\t.DEPHASE\n');
  });
});

describe('every name in the committed tables', () => {
  // The DOS tables bring names zmac has not seen from the ROM and hardware tables: LDOS's end in a dollar sign (HIGH$, TIME$, S1DCB$), and its drivers are bare
  // words (SEEK, SELECT). One program per selection uses every name the way a listing would, and the pinned zmac must assemble it to the image that went in.
  const selections: SymbolSelection[] = [
    { machine: 1, dos: 'ldos' },
    { machine: 1, dos: 'none' },
    { machine: 3, dos: 'trsdos' },
    { machine: 3, dos: 'ldos' },
    { machine: 3, dos: 'none' },
  ];
  for (const selection of selections) {
    test(`assembles a program that uses each name of machine ${selection.machine} with ${selection.dos}`, () => {
      const set = selectSymbols(selection);
      const code: number[] = [];
      for (const e of set.entries()) {
        // a routine or vector is called, a port is written, and anything else has its address loaded
        if (e.kind === 'port') code.push(0xd3, e.key);
        else if (e.kind === 'routine' || e.kind === 'vector') code.push(0xcd, e.key & 0xff, e.key >> 8);
        else code.push(0x21, e.key & 0xff, e.key >> 8);
      }
      code.push(0xc9);
      const source = roundTrip(Uint8Array.from(code), set);
      for (const e of set.entries()) expect(source.split('\n').some((l) => l.startsWith(`${e.name}\tEQU\t`)), e.name).toBe(true);
    });
  }

  test('writes the dollar-sign names as operands and defines them: LD HL,(HIGH$) and LD A,(LDRV$) under LDOS on a Model I', () => {
    const source = roundTrip(Uint8Array.from([0x2a, 0x49, 0x40, 0x3a, 0x08, 0x43, 0x21, 0x41, 0x40, 0xcd, 0x67, 0x44, 0xc3, 0x2d, 0x40]), selectSymbols({ machine: 1, dos: 'ldos' }));
    for (const text of ['\tLD\tHL,(HIGH$)\n', '\tLD\tA,(LDRV$)\n', '\tLD\tHL,TIME$\n', '\tCALL\t@DSPLY\t', '\tJP\t@EXIT\t', 'HIGH$\tEQU\t4049H', 'LDRV$\tEQU\t4308H', 'TIME$\tEQU\t4041H']) {
      expect(source).toContain(text);
    }
  });
});
