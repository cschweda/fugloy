/**
 * Emu phase 3's deliverable (spec §11): a scripted session produces a label file Fugløy's
 * disassembler consumes. The synthetic session needs no ROM, so CI runs it: a .CMD whose loop calls
 * one subroutine four times, the subroutine reading a table that sits where a static disassembler
 * would decode it as code. The Sea Dragon session needs the Model III ROM from fugloy.mcp.json and
 * checks the committed examples/sea-dragon/seadrg01.labels.json; packages/disasm's
 * sea-dragon-labels.test.ts applies that file without a ROM.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openProgram, parseLabelFile, renderSession, withLabelFile } from '@fugloy/disasm';
import { Machine } from '../../src/index.js';
import { configuredRom, ROM_TEST_TIMEOUT } from '../rom.js';
import { buildCmd, sampleRom } from '../unit/label-sample.js';
import { SEA_DRAGON_LABELS, seaDragonLabelText } from './sea-dragon-session.js';

/**
 * The program, at $7000. XOR A sets Z, so the JR Z at $7014 is always taken and the table at $7016
 * never runs; a static disassembler follows the fall-through too and decodes the table's bytes
 * 01 02 03 04 as LD BC,0302H / INC B.
 */
const CODE = [
  0xf3, //                 7000  DI
  0x31, 0x00, 0x7f, //     7001  LD SP,7F00H
  0x0e, 0x00, //           7004  LD C,0
  0x21, 0x16, 0x70, //     7006  LD HL,7016H    the table
  0x06, 0x04, //           7009  LD B,4
  0xcd, 0x20, 0x70, //     700B  CALL 7020H     taken 4×
  0x10, 0xfb, //           700E  DJNZ 700BH
  0x32, 0x50, 0x70, //     7010  LD (7050H),A   the sum, under a write watch
  0xaf, //                 7013  XOR A
  0x28, 0x04, //           7014  JR Z,701AH     always taken
  0x01, 0x02, 0x03, 0x04, // 7016  the table, read and never run
  0x76, //                 701A  HALT
  0, 0, 0, 0, 0, //        701B  (padding)
  0x7e, //                 7020  LD A,(HL)      the subroutine: add the next table byte to C
  0x23, //                 7021  INC HL
  0x81, //                 7022  ADD A,C
  0x4f, //                 7023  LD C,A
  0xc9, //                 7024  RET
];
const cmd = buildCmd([{ name: 'SESSION' }, { addr: 0x7000, data: CODE }], 0x7000);

/** The scripted session: load, coverage, a 10,000-deep trace, a write watch, run to the HALT. */
function session() {
  const m = new Machine({ roms: { level2: sampleRom() } });
  m.load.cmd(cmd);
  m.debug.coverage.enable();
  m.debug.trace.enable({ depth: 10_000 });
  const watch = m.debug.watch(0x7050, 1, { write: true });
  const r = m.run({ until: 'halt', cycles: 100_000 });
  const file = m.debug.labelFile({ input: 'none: the program reads no keys' });
  return { m, r, watch, file, json: JSON.stringify(file), hits: m.debug.hits(), trace: m.debug.trace.last(10_000) };
}

const listingOf = (file) => {
  const base = openProgram(cmd, { name: 'session.cmd' });
  if (file === undefined) return renderSession(base, 'listing');
  const { file: parsed, errors } = parseLabelFile(JSON.stringify(file));
  expect(errors).toEqual([]);
  return renderSession(withLabelFile(base, parsed, 'session.labels.json'), 'listing');
};

describe('a scripted session\'s label file feeds the disassembler, synthetic ROM', () => {
  it('the session runs to its HALT, with the watch and the trace filled', () => {
    const { m, r, watch, hits, trace } = session();
    expect(r.reason).toBe('halt');
    expect(m.mem.read(0x7050, 1)[0]).toBe(1 + 2 + 3 + 4);
    expect(hits).toEqual([expect.objectContaining({ id: watch, kind: 'write', pc: 0x7010, addr: 0x7050, value: 10 })]);
    expect(trace.length).toBeGreaterThan(20);
    expect(trace.at(-1).pc).toBe(0x701a);
  });

  it('the disassembler takes the table as data, the subroutine as observed code, and says so in the header', () => {
    const { file } = session();
    expect(file.labels.map((l) => [l.addr, l.name, l.source])).toEqual([[0x7000, 'ENTRY', 'loader'], [0x7020, 'SUB_7020', 'observed']]);

    // Without the label file the table's bytes decode as code; with it they do not.
    expect(listingOf()).toMatch(/^7016 .*LD BC,0302H/m);
    const listing = listingOf(file);
    expect(listing).not.toMatch(/^7016 .*LD BC/m);
    expect(listing).not.toMatch(/^7019 .*INC B/m);
    expect(listing).toMatch(/^7016 +01 02 03 04 /m);
    expect(listing).toMatch(/^SUB_7020:/m);
    expect(listing).toContain('; observed: called 4× from 1 site');
    expect(listing).toMatch(/^; labels: session\.labels\.json: 1 name, \d+ roots, 1 data run applied$/m);
  });

  it('two runs end with identical hit logs, traces, and label files', () => {
    const a = session();
    const b = session();
    expect(b.hits).toEqual(a.hits);
    expect(b.trace).toEqual(a.trace);
    expect(b.json).toBe(a.json);
  });
});

const rom = configuredRom('model3');

describe.skipIf(rom === null)('the Sea Dragon session on the Model III ROM', { timeout: ROM_TEST_TIMEOUT }, () => {
  it('writes the committed examples/sea-dragon/seadrg01.labels.json byte for byte', () => {
    const text = seaDragonLabelText(rom);
    expect(text, 'regenerate with: node packages/emu/scripts/sea-dragon-labels.mjs').toBe(readFileSync(SEA_DRAGON_LABELS, 'utf8'));
  });
});
