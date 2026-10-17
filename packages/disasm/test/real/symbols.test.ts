/**
 * Phase 3 on real programs: Asylum (a Model I game, listed with its hints) and Volcano Hunter (a Model III
 * game) with their ROM, hardware, and DOS addresses named from the cited tables. Both are copyrighted and
 * live only in the gitignored sample folders, so their tests skip when a file is absent; the first test
 * needs no sample, so the suite is never empty in CI.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { loadCmd } from '../../src/cmd.js';
import type { CmdModule } from '../../src/cmd.js';
import { emitZmac } from '../../src/emit/zmac.js';
import { applyHints, emptyAnnotations } from '../../src/hints/apply.js';
import { parseHints } from '../../src/hints/format.js';
import { programHash } from '../../src/hints/identity.js';
import { renderPass1Listing } from '../../src/listing.js';
import { analyze } from '../../src/pipeline.js';
import type { Analysis } from '../../src/pipeline.js';
import { loadRaw } from '../../src/raw.js';
import type { RawModule } from '../../src/raw.js';
import { selectSymbols } from '../../src/symbols/select.js';
import type { SymbolSelection, SymbolSet } from '../../src/symbols/select.js';
import { assemble, expectSameImage, skipIfNoZmac } from '../roundtrip/zmac.js';
import { readSample, resolveSample, skipIfMissing } from './samples.js';

const hex4 = (n: number): string => n.toString(16).toUpperCase().padStart(4, '0');
const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A load module or raw binary: the formats that have an entry address to round-trip. */
type Loaded = CmdModule | RawModule;

interface Listed {
  mod: Loaded;
  a: Analysis;
  tables: SymbolSet;
  listing: string;
}

/** The pass 1 listing of `mod` as the CLI prints it for `selection`, with the hints in `annotations`. */
function listing(mod: Loaded, selection: SymbolSelection, source: string, annotations = emptyAnnotations()): Listed {
  const tables = selectSymbols(selection);
  const a = analyze(mod, { annotations, tables });
  return { mod, a, tables, listing: renderPass1Listing(a, { source }) };
}

/** A sample .CMD listed for `selection`, with the hint file `hints` (in fixtures/hints/) applied, which must apply cleanly. */
function listed(file: string, selection: SymbolSelection, hints?: string): Listed {
  const bytes = readSample(file);
  const mod = loadCmd(bytes);
  if (hints === undefined) return listing(mod, selection, file);
  const parsed = parseHints(readFileSync(fileURLToPath(new URL(`../../../../fixtures/hints/${hints}`, import.meta.url)), 'utf8'));
  expect(parsed.errors).toEqual([]);
  const applied = applyHints(parsed.file, mod.image, programHash(bytes));
  expect(applied.errors).toEqual([]);
  expect(applied.unmatched).toEqual([]);
  expect(applied.warnings).toEqual([]);
  return listing(mod, selection, file, applied.annotations);
}

/** The CALL and JP rows of a listing whose target is a bare number, such as `CALL 0033H` or `JP NZ,1A19H`. */
function numericCalls(text: string): { row: string; target: number }[] {
  const found: { row: string; target: number }[] = [];
  for (const row of text.split('\n')) {
    const m = /^[0-9A-F]{4} {2}[0-9A-F ]{12} {2}(?:CALL|JP) (?:[A-Z]{1,2},)?([0-9A-F]{4})H(?![\w$@])/.exec(row);
    if (m !== null) found.push({ row, target: parseInt(m[1]!, 16) });
  }
  return found;
}

/** The numeric CALL and JP rows whose target is outside the program and has a name in the tables: there should be none. */
function leftNumeric({ a, tables, listing: text }: Listed): string[] {
  return numericCalls(text)
    .filter((c) => !a.space.image.isLoaded(c.target) && tables.code(c.target) !== undefined)
    .map((c) => c.row);
}

/**
 * Each transfer to an address outside the program that a table names, checked against the listing: the row of
 * the instruction must show the name (as the operand of a CALL or JP, or in the comment of an RST), and the
 * legend must define it. What is wrong, or nothing.
 */
function unnamedTransfers({ a, tables, listing: text }: Listed): string[] {
  const rows = new Map<number, string>();
  for (const row of text.split('\n')) {
    const m = /^([0-9A-F]{4}) {2}/.exec(row);
    if (m !== null) rows.set(parseInt(m[1]!, 16), row);
  }
  const problems: string[] = [];
  for (const x of a.pass1.xrefs) {
    if (a.space.image.isLoaded(x.to)) continue;
    const entry = tables.code(x.to);
    if (entry === undefined) continue;
    const shown = new RegExp(`(^|[\\s,(])${escapeRe(entry.name)}($|[\\s,):+])`);
    if (!shown.test(rows.get(x.from) ?? '')) problems.push(`$${hex4(x.from)} -> $${hex4(x.to)} is not shown as ${entry.name}`);
    if (!text.includes(`; table name ${entry.name} = `)) problems.push(`${entry.name} has no legend line`);
  }
  return problems;
}

/** The addresses pass 1 reaches outside the program that the tables name. */
const reachedNamed = ({ a, tables }: Listed): number[] => a.pass1.externals.filter((x) => tables.code(x) !== undefined);

/** `it` only when the sample is present and zmac is too (FUGLOY_REQUIRE_ZMAC=1 makes a missing zmac a failure). */
const withZmac = (file: string): typeof it | typeof it.skip => (resolveSample(file) === null ? it.skip : skipIfNoZmac());

/** Assembles the zmac source of a listing, with its table names defined, and compares the image and the entry with the program's. */
function expectRoundTrip({ mod, a }: Listed, file: string): string {
  const source = emitZmac(mod.image, a.pass1, a.transfer, { source: file, symbols: a.symbols, annotations: a.annotations, space: a.space, externals: a.externals, tablesUsed: a.tablesUsed });
  const { module: back } = assemble(source);
  expectSameImage(back.image, mod.image);
  expect(back.entry).toBe(mod.entry);
  return source;
}

/** Computed once per file: each takes a second or two. */
const memo = <T>(make: () => T): (() => T) => {
  let value: T | undefined;
  return () => (value ??= make());
};

// Needs no sample: the checks above must be able to fail, or the tests below prove nothing.
it('the checks see a CALL and a JP left numeric, and a transfer whose name is missing, in a listing made without tables', () => {
  // CALL 0033H / JP 0049H at $5200: the display and keyboard-wait routines of both ROMs
  const mod = loadRaw(Uint8Array.from([0xcd, 0x33, 0x00, 0xc3, 0x49, 0x00]), 0x5200);
  const selection: SymbolSelection = { machine: 3, dos: 'trsdos' };
  const named = listing(mod, selection, 'x.bin');
  expect(leftNumeric(named)).toEqual([]);
  expect(unnamedTransfers(named)).toEqual([]);
  expect(named.listing).toContain('CALL $VDCHAR');
  expect(named.listing).toContain('JP $KBWAIT');

  const bare = { ...named, listing: renderPass1Listing(analyze(mod), { source: 'x.bin' }) };
  expect(numericCalls(bare.listing).map((c) => c.target)).toEqual([0x0033, 0x0049]);
  expect(leftNumeric(bare)).toHaveLength(2);
  expect(unnamedTransfers(bare)).toHaveLength(4); // each transfer shows no name and has no legend line
});

// Asylum is a Model I program: Model I ROM, hardware, and LDOS 5.1, with the hints that unpack its loader stream and relocate its game.
const ASYLUM = 'asylum16.cmd';
const MODEL_I: SymbolSelection = { machine: 1, dos: 'ldos' };
const asylum = memo(() => listed(ASYLUM, MODEL_I, 'asylum16.hints'));
/** The ROM addresses its pass 1 reaches with the hints: the RST vectors, the keyboard, display, cassette, and BASIC routines it calls, and $0112, which is banner text and no routine. */
const ASYLUM_ROM = [0x0000, 0x0008, 0x0010, 0x0020, 0x002b, 0x0030, 0x0033, 0x0038, 0x0112, 0x01f8, 0x0212, 0x0235, 0x0264, 0x0287, 0x0296, 0x093e, 0x1a19];

skipIfMissing(ASYLUM)('asylum16: with its hints, pass 1 reaches the ROM routines the game calls', () => {
  const l = asylum();
  const rom = l.a.pass1.externals.filter((x) => x < 0x3800);
  expect(rom).toEqual(expect.arrayContaining(ASYLUM_ROM));
  expect(l.a.pass1.instructions.has(0x43ae)).toBe(true); // the game, at its runtime address
});

skipIfMissing(ASYLUM)('asylum16: names every ROM routine it reaches, in the operand or the RST comment, and defines each in the legend', () => {
  const l = asylum();
  expect(reachedNamed(l)).toEqual(expect.arrayContaining(ASYLUM_ROM.filter((x) => x !== 0x0112)));
  expect(unnamedTransfers(l)).toEqual([]);
});

skipIfMissing(ASYLUM)('asylum16: no CALL or JP goes to a bare number that the Model I tables name', () => {
  const l = asylum();
  expect(leftNumeric(l)).toEqual([]);
  // what stays numeric is no routine of the ROM: banner text at $0112, and addresses of the load file that decoded data produced
  const unnamed = l.a.pass1.externals.filter((x) => x < 0x3800 && l.tables.code(x) === undefined);
  expect(unnamed).toEqual([0x0112]);
});

skipIfMissing(ASYLUM)('asylum16: calls the display routine by name, CALL $VDCHAR, with its purpose', () => {
  const l = asylum();
  const purpose = l.tables.code(0x0033)!.purpose;
  expect(l.listing).toMatch(new RegExp(`^8074 {2}CD 33 00 +CALL \\$VDCHAR +; ${escapeRe(purpose)}$`, 'm'));
  expect(l.listing).toMatch(/^8079 {2}C3 33 00 +JP \$VDCHAR +; /m);
  expect(l.listing).toContain('; symbols: Model I ROM, hardware, LDOS 5.1\n');
});

withZmac(ASYLUM)('asylum16: the zmac source, with the table names defined, assembles to the same image and entry', () => {
  const source = expectRoundTrip(asylum(), ASYLUM);
  expect(source).toContain('\tCALL\t$VDCHAR');
  expect(source).toContain('$VDCHAR\tEQU\t0033H');
});

// Volcano Hunter writes Model III port $EC (clock interrupt, video, cassette motor, and I/O bus modes), so the default machine fits.
// The game calls no ROM or DOS routine, so pass 1 alone reaches none; its hints (fixtures/hints/volcano.hints) move the game to the address
// it runs at and reach the one ROM routine the file holds.
const VOLCANO = 'volcano.cmd';
const MODEL_III: SymbolSelection = { machine: 3, dos: 'trsdos' };
const volcano = memo(() => listed(VOLCANO, MODEL_III));
const volcanoHinted = memo(() => listed(VOLCANO, MODEL_III, 'volcano.hints'));

skipIfMissing(VOLCANO)('volcano: writes the mode port by name, OUT (MODEPORT),A, and defines it in the legend', () => {
  const l = volcano();
  expect(l.listing).toMatch(/^[0-9A-F]{4} {2}D3 EC +OUT \(MODEPORT\),A$/m);
  expect(l.listing).toMatch(/^; table name MODEPORT = port \$EC: /m);
  expect(l.listing).toContain('; symbols: Model III ROM, hardware, TRSDOS 1.3\n');
});

skipIfMissing(VOLCANO)('volcano: pass 1 alone reaches no ROM or DOS address, so no transfer is left unnamed or numeric', () => {
  const l = volcano();
  expect(l.a.pass1.externals).toEqual([]);
  expect(unnamedTransfers(l)).toEqual([]);
  expect(leftNumeric(l)).toEqual([]);
});

withZmac(VOLCANO)('volcano: the zmac source, with MODEPORT defined, assembles to the same image and entry', () => {
  const source = expectRoundTrip(volcano(), VOLCANO);
  expect(source).toContain('\tOUT\t(MODEPORT),A');
  expect(source).toContain('MODEPORT\tEQU\t0ECH');
});

skipIfMissing(VOLCANO)('volcano: its hints move the game to $42E9, where pass 1 decodes it from $6132 without a note and writes the mode port there', () => {
  const l = volcanoHinted();
  expect(l.a.annotations.relocations).toEqual([{ fileAddr: 0x52e9, length: 0x3d14, runAddr: 0x42e9 }]);
  expect(l.listing).toContain('; relocated: file $52E9-$8FFC executes at $42E9-$7FFC\n');
  expect(l.a.pass1.instructions.has(0x6132)).toBe(true);
  expect(l.a.pass1.diagnostics).toEqual([]);
  expect(l.listing).toMatch(/^GAME:\n6132 {2}F3 +DI +; /m);
  expect(l.listing).toMatch(/^6135 {2}D3 EC +OUT \(MODEPORT\),A$/m);
  // without the hints, the JP at $9131 lands on the file's $6132, which holds data, and the descent runs into overlaps
  expect(volcano().a.pass1.diagnostics.length).toBeGreaterThan(0);
});

skipIfMissing(VOLCANO)('volcano: with its hints, pass 1 reaches the ROM delay from the RST vectors and names it, CALL $DELAY at $4000 and $4003', () => {
  const l = volcanoHinted();
  expect(l.a.pass1.externals).toEqual([0x0060]);
  expect(reachedNamed(l)).toEqual([0x0060]);
  const purpose = l.tables.code(0x0060)!.purpose;
  expect(l.listing).toMatch(new RegExp(`^4000 {2}CD 60 00 +CALL \\$DELAY +; entry; .*; ${escapeRe(purpose)}$`, 'm'));
  expect(l.listing).toMatch(new RegExp(`^4003 {2}CD 60 00 +CALL \\$DELAY +; entry; .*; ${escapeRe(purpose)}$`, 'm'));
  expect(l.listing).toMatch(/^; table name \$DELAY = \$0060: /m);
  expect(unnamedTransfers(l)).toEqual([]);
  expect(leftNumeric(l)).toEqual([]);
});

withZmac(VOLCANO)('volcano: with its hints, the zmac source assembles to the same image and entry, the game under .PHASE and the delay by name', () => {
  const source = expectRoundTrip(volcanoHinted(), VOLCANO);
  expect(source).toContain('\t.PHASE\t42E9H\n');
  expect(source).toContain('\tCALL\t$DELAY');
  expect(source).toContain('$DELAY\tEQU\t0060H');
});
