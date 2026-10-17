/**
 * Names in .BAS listings (design spec §5.4): a note line after a BASIC line whose
 * PEEK, POKE, or DEFUSR argument is a constant address the selected tables name.
 * Tables here are in memory, so each test names its own entries, except in the
 * last block, which lists with the committed tables as the CLI does.
 */
import { describe, expect, it } from 'vitest';
import { loadBas } from '../../src/bas.js';
import { basAddresses, basReferences } from '../../src/basic/addresses.js';
import { parseLine } from '../../src/basic/parser.js';
import { emptyAnnotations } from '../../src/hints/apply.js';
import { renderBasListing, renderPass1Listing } from '../../src/listing.js';
import { analyze } from '../../src/pipeline.js';
import { selectSymbols } from '../../src/symbols/select.js';
import type { SymbolSelection, SymbolSet } from '../../src/symbols/select.js';
import type { RomComparison } from '../../src/symbols/types.js';
import { BAS_FIXTURES } from '../fixtures.js';
import { tokenizeLine, writeBasic } from '../writers/basic-tokenizer.js';
import type { BasicLineSpec } from '../writers/basic-tokenizer.js';
import { entry, tablesOf } from './helpers.js';
import type { Tables } from './helpers.js';

const parsed = (text: string) => parseLine(tokenizeLine(text));
const addresses = (text: string): number[] => basAddresses(parsed(text));

describe('basAddresses', () => {
  it('finds the addresses POKE writes: POKE 16526,0:POKE 16527,82 is [16526, 16527]', () => {
    expect(addresses('POKE 16526,0:POKE 16527,82')).toEqual([16526, 16527]);
  });

  it('finds the address a PEEK reads: X=PEEK(14400) is [14400]', () => {
    expect(addresses('X=PEEK(14400)')).toEqual([14400]);
  });

  it('finds the address DEFUSR is given, in hex as well as decimal: DEFUSR3=&H7D00 is [0x7D00]', () => {
    expect(addresses('DEFUSR3=&H7D00')).toEqual([0x7d00]);
    expect(addresses('DEFUSR=32000')).toEqual([0x7d00]);
  });

  it('reads an address written negative as the address it stands for: POKE -1,0 is [0xFFFF]', () => {
    expect(addresses('POKE -1,0')).toEqual([0xffff]);
    expect(addresses('X=PEEK(-32768)')).toEqual([0x8000]);
    expect(addresses('POKE -2,0')).toEqual([0xfffe]);
  });

  it('finds nothing in a number that is not an address: PRINT 16526 is []', () => {
    expect(addresses('PRINT 16526')).toEqual([]);
    expect(addresses('X=16526:GOTO 16526')).toEqual([]);
  });

  it('finds a PEEK anywhere inside an expression, in the order the line reads them', () => {
    expect(addresses('X=PEEK(16548)+256*PEEK(16549)')).toEqual([16548, 16549]);
    expect(addresses('A(PEEK(14400))=INT(PEEK(14401)/2)')).toEqual([14400, 14401]);
    expect(addresses('X=-PEEK(14400)+(1-PEEK(14401))')).toEqual([14400, 14401]);
    expect(addresses('X=USR(PEEK(14400))')).toEqual([14400]);
    expect(addresses('X=FNA(PEEK(14400))')).toEqual([14400]);
    expect(addresses('POKE 15360,PEEK(14400)')).toEqual([15360, 14400]);
    expect(addresses('DEFUSR=PEEK(16526)')).toEqual([16526]);
  });

  it('finds a PEEK in an IF condition, a PRINT item, a FOR bound, an ON selector, and a DEF FN body', () => {
    expect(addresses('IF PEEK(14400)=128 THEN 255')).toEqual([14400]);
    expect(addresses('PRINT PEEK(16526)')).toEqual([16526]);
    expect(addresses('FOR I=PEEK(16548) TO 10')).toEqual([16548]);
    expect(addresses('FOR I=1 TO PEEK(16548) STEP PEEK(16549)')).toEqual([16548, 16549]);
    expect(addresses('ON PEEK(14400) GOTO 100,200')).toEqual([14400]);
    expect(addresses('ON PEEK(14400) GOSUB 100,200')).toEqual([14400]);
    expect(addresses('DEF FNA(X)=PEEK(14400)+X')).toEqual([14400]);
  });

  it('finds a PEEK in every other place an expression can stand', () => {
    expect(addresses('PRINT@PEEK(14400),"X"')).toEqual([14400]);
    expect(addresses('PRINT TAB(PEEK(14400));"X"')).toEqual([14400]);
    expect(addresses('LPRINT PEEK(14400)')).toEqual([14400]);
    expect(addresses('OUT 255,PEEK(14400)')).toEqual([14400]);
    expect(addresses('CLEAR PEEK(16526)')).toEqual([16526]);
    expect(addresses('READ A(PEEK(14400))')).toEqual([14400]);
    expect(addresses('IF X THEN 100 ELSE PRINT PEEK(14400)')).toEqual([14400]);
  });

  it('reads the PEEKs, POKEs, and DEFUSRs of one line in the order it reads them', () => {
    expect(addresses('IF PEEK(14400)=128 THEN POKE 16526,0 ELSE PRINT PEEK(16527)')).toEqual([14400, 16526, 16527]);
    expect(addresses('PRINT PEEK(16526);:POKE 16527,PEEK(16526):DEFUSR=PEEK(16528)')).toEqual([16526, 16527, 16528]);
  });

  it('takes the PEEKs inside a POKE address that is itself no constant', () => {
    expect(addresses('POKE PEEK(16526)+256*PEEK(16527),0')).toEqual([16526, 16527]);
  });

  it('reads the statements of an IF branch like any others', () => {
    expect(addresses('IF X THEN POKE 16526,0 ELSE POKE 16527,0')).toEqual([16526, 16527]);
  });

  it('finds nothing where the address is not a literal, a minus sign and a literal, or in range', () => {
    expect(addresses('POKE A,0:X=PEEK(A)')).toEqual([]);
    expect(addresses('POKE 16526+1,0')).toEqual([]);
    expect(addresses('DEFUSR=A+1')).toEqual([]);
    expect(addresses('X=PEEK(70000)')).toEqual([]);
    expect(addresses('X=PEEK(-40000)')).toEqual([]);
    expect(addresses('X=PEEK(1.5)')).toEqual([]);
    expect(addresses('X=PEEK(A,B)')).toEqual([]);
  });

  it('lists an address once, where it first appears', () => {
    expect(addresses('POKE 16527,PEEK(16526):POKE 16527,PEEK(16527)')).toEqual([16527, 16526]);
  });

  it('finds nothing in a remark, in DATA, or in a string, which are text and not statements', () => {
    expect(addresses('REM POKE 16526,0:X=PEEK(14400)')).toEqual([]);
    expect(addresses("X=1:' DEFUSR=16526")).toEqual([]);
    expect(addresses('DATA 16526,14400')).toEqual([]);
    expect(addresses('PRINT "POKE 16526,0"')).toEqual([]);
  });

  it('finds nothing in a line that does not parse', () => {
    expect(basAddresses(parseLine(Uint8Array.from([0xb2, 0xfc, 0x41])))).toEqual([]);
  });
});

describe('basReferences', () => {
  it('says what the line does with each address: PEEK and POKE reach memory, DEFUSR calls a routine', () => {
    expect(basReferences(parsed('POKE 16526,0:X=PEEK(14400):DEFUSR1=73'))).toEqual([
      { addr: 16526, use: 'data' },
      { addr: 14400, use: 'data' },
      { addr: 73, use: 'code' },
    ]);
  });

  it('keeps the first use of an address a line makes more than once', () => {
    expect(basReferences(parsed('DEFUSR=16526:POKE 16526,0'))).toEqual([{ addr: 16526, use: 'code' }]);
  });
});

const MODEL_I: SymbolSelection = { machine: 1, dos: 'ldos' };

const usrvec = entry('rom-model1', 'variable', 0x408e, 'USRVEC', { length: 2, purpose: 'USR vector' });
const kbwait = entry('rom-model1', 'routine', 0x0049, '$KBWAIT', { purpose: 'wait for a key' });
const zoneStart = entry('rom-model1', 'routine', 0x7000, 'ZONE_START', { purpose: 'the routine at the start of the zone' });
const keyboard = entry('hardware-model1', 'region', 0x3800, 'KEYBOARD', { length: 256, coined: true, purpose: 'memory-mapped keyboard' });
const video = entry('hardware-model1', 'region', 0x3c00, 'VIDEO', { length: 1024, coined: true, purpose: 'video display memory' });
const zone = entry('hardware-model1', 'region', 0x7000, 'ZONE', { length: 16, coined: true, purpose: 'a data zone' });
const inside = entry('hardware-model1', 'region', 0x5200, 'INSIDE', { length: 16, coined: true, purpose: 'a zone the program sits in' });

/** The ROM addresses above are the same on both machines, so their notes carry no machine tag. */
const SHARED: RomComparison = { '408E': 'shared', '0049': 'shared', '7000': 'shared' };
const tables = (lists: Partial<Tables>, comparison: RomComparison = SHARED): SymbolSet => selectSymbols(MODEL_I, tablesOf(lists), comparison);
const TABLES = tables({ 'rom-model1': [usrvec, kbwait, zoneStart], 'hardware-model1': [keyboard, video, zone, inside] });

/** The note lines of a listing. */
const notes = (lines: string[]): string[] => lines.filter((l) => /^; {3}\d/.test(l));

/** Level II's usual start of program, $42E9. */
const BASE = 0x42e9;

function listing(specs: BasicLineSpec[], names?: SymbolSet, base = BASE): string[] {
  return renderBasListing(loadBas(writeBasic(specs, base)), names === undefined ? {} : { tables: names }).split('\n');
}

describe('the plain BASIC listing with tables', () => {
  it('puts a note line after a line that PEEKs, POKEs, or DEFUSRs a named address, and none after the others', () => {
    const lines = listing(
      [
        { number: 10, text: 'CLS' },
        { number: 20, text: 'POKE 16526,0:POKE 16527,82' },
        { number: 30, text: 'X=PEEK(14400)' },
        { number: 40, text: 'PRINT 16526' },
        { number: 50, text: 'DEFUSR1=73' },
        { number: 60, text: 'POKE 20000,1' },
      ],
      TABLES,
    );
    expect(lines.slice(1)).toEqual([
      '10 CLS',
      '20 POKE 16526,0:POKE 16527,82',
      ';   16526 = $408E USR vector (USRVEC)',
      ';   16527 = $408F USR vector (USRVEC+1)',
      '30 X=PEEK(14400)',
      ';   14400 = $3840 memory-mapped keyboard (KEYBOARD+64)',
      '40 PRINT 16526',
      '50 DEFUSR1=73',
      ';   73 = $0049 wait for a key ($KBWAIT)',
      '60 POKE 20000,1',
      '',
    ]);
  });

  it('prints the header and every BASIC line exactly as it does without tables', () => {
    const specs: BasicLineSpec[] = [
      { number: 10, text: 'POKE 16526,0' },
      { number: 20, text: 'PRINT "HI"' },
    ];
    const bare = listing(specs);
    const named = listing(specs, TABLES);
    expect(bare.filter((l) => l.startsWith(';   '))).toEqual([]);
    expect(named.filter((l) => !l.startsWith(';   '))).toEqual(bare);
    expect(named).toHaveLength(bare.length + 1);
  });

  it('adds no note for an address the tables do not name', () => {
    const specs: BasicLineSpec[] = [{ number: 10, text: 'POKE 20000,1:X=PEEK(20001):DEFUSR=20002' }, { number: 20, text: 'POKE 16529,0' }];
    expect(listing(specs, TABLES)).toEqual(listing(specs));
  });

  it('names a PEEK or POKE address from the data names first and a DEFUSR address from the code names first', () => {
    // $7000 is both a region (ZONE) and a routine (ZONE_START); $0049 only a routine, $3C00 only a region.
    const lines = listing(
      [
        { number: 10, text: 'POKE 28672,0:X=PEEK(28673)' },
        { number: 20, text: 'DEFUSR=28672:DEFUSR1=28673' },
        { number: 30, text: 'X=PEEK(73)' },
        { number: 40, text: 'DEFUSR2=15360' },
      ],
      TABLES,
    );
    expect(lines.slice(1)).toEqual([
      '10 POKE 28672,0:X=PEEK(28673)',
      ';   28672 = $7000 a data zone (ZONE)',
      ';   28673 = $7001 a data zone (ZONE+1)',
      '20 DEFUSR=28672:DEFUSR1=28673',
      ';   28672 = $7000 the routine at the start of the zone (ZONE_START)',
      ';   28673 = $7001 a data zone (ZONE+1)',
      '30 X=PEEK(73)',
      ';   73 = $0049 wait for a key ($KBWAIT)',
      '40 DEFUSR2=15360',
      ';   15360 = $3C00 video display memory (VIDEO)',
      '',
    ]);
  });

  it('notes a PEEK in an IF condition, a PRINT item, a FOR bound, an ON selector, and a DEF FN body', () => {
    const lines = listing(
      [
        { number: 10, text: 'IF PEEK(14400)=128 THEN 255' },
        { number: 20, text: 'PRINT PEEK(16526)' },
        { number: 30, text: 'FOR I=PEEK(15360) TO 10' },
        { number: 40, text: 'ON PEEK(14401) GOTO 100,200' },
        { number: 50, text: 'DEF FNA(X)=PEEK(16527)+X' },
      ],
      TABLES,
    );
    expect(lines.slice(1)).toEqual([
      '10 IF PEEK(14400)=128 THEN 255',
      ';   14400 = $3840 memory-mapped keyboard (KEYBOARD+64)',
      '20 PRINT PEEK(16526)',
      ';   16526 = $408E USR vector (USRVEC)',
      '30 FOR I=PEEK(15360) TO 10',
      ';   15360 = $3C00 video display memory (VIDEO)',
      '40 ON PEEK(14401) GOTO 100,200',
      ';   14401 = $3841 memory-mapped keyboard (KEYBOARD+65)',
      '50 DEF FNA(X)=PEEK(16527)+X',
      ';   16527 = $408F USR vector (USRVEC+1)',
      '',
    ]);
  });

  it('adds one note per distinct address, in the order the line reads them', () => {
    const lines = listing([{ number: 10, text: 'POKE 16527,PEEK(16526):POKE 16527,PEEK(16527)' }], TABLES);
    expect(lines.slice(2)).toEqual([';   16527 = $408F USR vector (USRVEC+1)', ';   16526 = $408E USR vector (USRVEC)', '']);
  });

  it('notes an address written negative by the address it stands for', () => {
    const top = tables({ 'rom-model1': [entry('rom-model1', 'variable', 0xffff, 'TOPBYTE', { purpose: 'the top byte of memory' })] }, { FFFF: 'shared' });
    const lines = listing([{ number: 10, text: 'POKE -1,0' }], top);
    expect(lines.slice(1)).toEqual(['10 POKE -1,0', ';   65535 = $FFFF the top byte of memory (TOPBYTE)', '']);
  });

  it('notes nothing inside the program itself, where the tables do not apply', () => {
    // The program is saved from $5200, so $5200 is its own first byte and $7000 is outside it.
    const lines = listing([{ number: 10, text: 'POKE 20992,0' }, { number: 20, text: 'POKE 28672,0' }], TABLES, 0x5200);
    expect(lines.slice(1)).toEqual(['10 POKE 20992,0', '20 POKE 28672,0', ';   28672 = $7000 a data zone (ZONE)', '']);
  });

  it('notes nothing without tables', () => {
    const lines = listing([{ number: 10, text: 'POKE 16526,0:X=PEEK(14400):DEFUSR=73' }]);
    expect(lines.filter((l) => l.startsWith(';   '))).toEqual([]);
  });

  it('adds no note under an unparsed line', () => {
    const lines = listing([{ number: 10, text: 'POKE 16526,0' }, { number: 20, raw: [0xb2, 0xfc, 0x41] }], TABLES);
    expect(lines.slice(2)).toEqual([';   16526 = $408E USR vector (USRVEC)', expect.stringMatching(/^20 \[unparsed: /), '']);
  });
});

describe('the pass 1 listing of a .BAS with hidden code', () => {
  // Line 20 is machine code, so the program lists with pass 1; its BASIC lines carry the same notes.
  const specs: BasicLineSpec[] = [
    { number: 10, text: 'POKE 15360,65:X=PEEK(16526)' },
    { number: 20, raw: [0xc3, 0x00, 0x00, 0xc9, 0x00, 0x3e] },
    { number: 30, text: 'X=PEEK(14400):DEFUSR=28672' },
    { number: 40, text: 'POKE 20000,1' },
  ];
  const prog = loadBas(writeBasic(specs, BASE));

  it('shows the same note lines as the plain listing, each after its BASIC line', () => {
    const plain = renderBasListing(prog, { tables: TABLES }).split('\n');
    const pass1 = renderPass1Listing(analyze(prog, { tables: TABLES })).split('\n');
    expect(notes(plain)).toEqual([
      ';   15360 = $3C00 video display memory (VIDEO)',
      ';   16526 = $408E USR vector (USRVEC)',
      ';   14400 = $3840 memory-mapped keyboard (KEYBOARD+64)',
      ';   28672 = $7000 the routine at the start of the zone (ZONE_START)',
    ]);
    expect(notes(pass1)).toEqual(notes(plain));
    const at = pass1.indexOf('10 POKE 15360,65:X=PEEK(16526)');
    expect(pass1.slice(at, at + 3)).toEqual(['10 POKE 15360,65:X=PEEK(16526)', ';   15360 = $3C00 video display memory (VIDEO)', ';   16526 = $408E USR vector (USRVEC)']);
    const later = pass1.indexOf('30 X=PEEK(14400):DEFUSR=28672');
    expect(pass1.slice(later, later + 4)).toEqual([
      '30 X=PEEK(14400):DEFUSR=28672',
      ';   14400 = $3840 memory-mapped keyboard (KEYBOARD+64)',
      ';   28672 = $7000 the routine at the start of the zone (ZONE_START)',
      '40 POKE 20000,1',
    ]);
  });

  it('notes a name the program took for a symbol of its own all the same, since a note is no operand', () => {
    // A hint file may name a code line after a table entry; assembly then keeps the number, but the note still says what the address is.
    const annotations = { ...emptyAnnotations(), names: new Map([[prog.lines[1]!.bodyAddr, 'video']]) };
    const analysis = analyze(prog, { tables: TABLES, annotations });
    expect(analysis.externals.dropped).toEqual([video]);
    const plain = renderBasListing(prog, { tables: TABLES }).split('\n');
    expect(notes(renderPass1Listing(analysis).split('\n'))).toEqual(notes(plain));
  });

  it('notes a PEEK in an IF condition, a PRINT item, a FOR bound, an ON selector, and a DEF FN body, as the plain listing does', () => {
    const own = loadBas(
      writeBasic(
        [
          { number: 10, text: 'IF PEEK(14400)=128 THEN 255' },
          { number: 20, raw: [0xc3, 0x00, 0x00, 0xc9, 0x00, 0x3e] },
          { number: 30, text: 'PRINT PEEK(16526)' },
          { number: 40, text: 'FOR I=PEEK(15360) TO 10' },
          { number: 50, text: 'ON PEEK(14401) GOTO 100,200' },
          { number: 60, text: 'DEF FNA(X)=PEEK(16527)+X' },
        ],
        BASE,
      ),
    );
    const lines = renderPass1Listing(analyze(own, { tables: TABLES })).split('\n');
    expect(notes(lines)).toEqual([
      ';   14400 = $3840 memory-mapped keyboard (KEYBOARD+64)',
      ';   16526 = $408E USR vector (USRVEC)',
      ';   15360 = $3C00 video display memory (VIDEO)',
      ';   14401 = $3841 memory-mapped keyboard (KEYBOARD+65)',
      ';   16527 = $408F USR vector (USRVEC+1)',
    ]);
    expect(notes(renderBasListing(own, { tables: TABLES }).split('\n'))).toEqual(notes(lines));
    const at = lines.indexOf('10 IF PEEK(14400)=128 THEN 255');
    expect(lines[at + 1]).toBe(';   14400 = $3840 memory-mapped keyboard (KEYBOARD+64)');
  });

  it('notes nothing inside the program itself, as the plain listing does not', () => {
    // Saved from $5200, the program holds $5200, which INSIDE names, so POKE 20992 gets no note and POKE 28672 does.
    const own = loadBas(writeBasic([{ number: 10, text: 'POKE 20992,0' }, { number: 20, raw: [0xc3, 0x00, 0x00, 0xc9, 0x00, 0x3e] }, { number: 30, text: 'POKE 28672,0' }], 0x5200));
    const lines = renderPass1Listing(analyze(own, { tables: TABLES })).split('\n');
    expect(notes(lines)).toEqual([';   28672 = $7000 a data zone (ZONE)']);
    expect(notes(renderBasListing(own, { tables: TABLES }).split('\n'))).toEqual(notes(lines));
  });

  it('notes nothing when the analysis has no tables', () => {
    expect(notes(renderPass1Listing(analyze(prog)).split('\n'))).toEqual([]);
  });
});

describe('the machine tag on a note', () => {
  // Spec section 4.6: a ROM name whose address differs between the machines carries the tag, as an RST comment does.
  const poke: BasicLineSpec[] = [{ number: 10, text: 'POKE 16526,0:POKE 16527,82' }];
  const MODEL_III: SymbolSelection = { machine: 3, dos: 'trsdos' };

  it('follows the parenthesized name of a ROM entry the other machine does not share: (USRVEC) [Model I]', () => {
    const names = tables({ 'rom-model1': [usrvec] }, { '408E': 'model1-only' });
    expect(listing(poke, names).slice(1)).toEqual([
      '10 POKE 16526,0:POKE 16527,82',
      ';   16526 = $408E USR vector (USRVEC) [Model I]',
      ';   16527 = $408F USR vector (USRVEC+1) [Model I]',
      '',
    ]);
  });

  it('leaves a shared ROM name untagged, and tags a different one and one the comparison does not list', () => {
    expect(notes(listing(poke, tables({ 'rom-model1': [usrvec] }, { '408E': 'shared' })))).toEqual([
      ';   16526 = $408E USR vector (USRVEC)',
      ';   16527 = $408F USR vector (USRVEC+1)',
    ]);
    expect(notes(listing(poke, tables({ 'rom-model1': [usrvec] }, { '408E': 'different' })))).toEqual([
      ';   16526 = $408E USR vector (USRVEC) [Model I]',
      ';   16527 = $408F USR vector (USRVEC+1) [Model I]',
    ]);
    expect(notes(listing(poke, tables({ 'rom-model1': [usrvec] }, {})))).toEqual([
      ';   16526 = $408E USR vector (USRVEC) [Model I]',
      ';   16527 = $408F USR vector (USRVEC+1) [Model I]',
    ]);
  });

  it('tags a DEFUSR address named from the code names too, and a Model III name [Model III]', () => {
    const routine = tables({ 'rom-model1': [kbwait] }, { '0049': 'model1-only' });
    expect(notes(listing([{ number: 10, text: 'DEFUSR1=73' }], routine))).toEqual([';   73 = $0049 wait for a key ($KBWAIT) [Model I]']);
    const curblink = entry('rom-model3', 'variable', 0x401c, 'CURBLINK', { purpose: 'cursor blink switch' });
    const model3 = selectSymbols(MODEL_III, tablesOf({ 'rom-model3': [curblink] }), { '401C': 'model3-only' });
    expect(listing([{ number: 10, text: 'POKE 16412,1' }], model3).slice(1)).toEqual([
      '10 POKE 16412,1',
      ';   16412 = $401C cursor blink switch (CURBLINK) [Model III]',
      '',
    ]);
  });

  it('never tags a hardware name, whatever the comparison says', () => {
    expect(notes(listing([{ number: 10, text: 'POKE 15360,65:X=PEEK(14400)' }], tables({ 'hardware-model1': [video, keyboard] }, {})))).toEqual([
      ';   15360 = $3C00 video display memory (VIDEO)',
      ';   14400 = $3840 memory-mapped keyboard (KEYBOARD+64)',
    ]);
  });

  it('puts the same tags in the pass 1 listing, with a hidden line to make it one', () => {
    const own = loadBas(writeBasic([...poke, { number: 20, raw: [0xc3, 0x00, 0x00, 0xc9, 0x00, 0x3e] }], BASE));
    const names = tables({ 'rom-model1': [usrvec] }, { '408E': 'model1-only' });
    const lines = renderPass1Listing(analyze(own, { tables: names })).split('\n');
    expect(notes(lines)).toEqual([';   16526 = $408E USR vector (USRVEC) [Model I]', ';   16527 = $408F USR vector (USRVEC+1) [Model I]']);
    expect(notes(renderBasListing(own, { tables: names }).split('\n'))).toEqual(notes(lines));
  });
});

describe('notes from the committed tables', () => {
  /** The CLI's default: a Model III with TRSDOS 1.3. */
  const DEFAULT = selectSymbols({ machine: 3, dos: 'trsdos' });
  const ON_MODEL_I = selectSymbols(MODEL_I);

  it('notes the program-start pointer that line 30 of prog-62c8.bas PEEKs, untagged, on the default machine as on the Model I', () => {
    for (const names of [DEFAULT, ON_MODEL_I]) {
      const lines = renderBasListing(loadBas(BAS_FIXTURES['prog-62c8']!()), { tables: names }).split('\n');
      const at = lines.indexOf('30 X=PEEK(16548)+256*PEEK(16549)');
      expect(at, names.selection.machine.toString()).toBeGreaterThan(0);
      expect(lines.slice(at + 1, at + 4), names.selection.machine.toString()).toEqual([
        expect.stringMatching(/^; {3}16548 = \$40A4 .+ \(PROGSTART\)$/),
        expect.stringMatching(/^; {3}16549 = \$40A5 .+ \(PROGSTART\+1\)$/),
        '40 IF X>0 THEN GOSUB 100 ELSE END',
      ]);
      expect(notes(lines), names.selection.machine.toString()).toHaveLength(2);
    }
  });

  it('notes a POKE of the USR address on the default machine: POKE 16526 and 16527 are USRVEC, untagged', () => {
    const lines = listing([{ number: 10, text: 'POKE 16526,0:POKE 16527,127:X=USR(0)' }], DEFAULT);
    expect(notes(lines)).toEqual([expect.stringMatching(/^; {3}16526 = \$408E .+ \(USRVEC\)$/), expect.stringMatching(/^; {3}16527 = \$408F .+ \(USRVEC\+1\)$/)]);
  });
});
