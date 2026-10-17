import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { programFacts } from '../src/facts.js';
import { analyze } from '../src/pipeline.js';
import { loadRaw } from '../src/raw.js';
import { openProgram, withHintText } from '../src/session.js';

const dir = fileURLToPath(new URL('../../../examples/sea-dragon/', import.meta.url));
const sea = withHintText(
  openProgram(new Uint8Array(readFileSync(`${dir}seadrg01.cmd`)), { name: 'seadrg01.cmd', selection: { machine: 3, dos: 'trsdos' } }),
  readFileSync(`${dir}seadrg01.hints`, 'utf8'),
  'seadrg01.hints',
);

const raw = (bytes: number[]) => programFacts(analyze(loadRaw(new Uint8Array(bytes), 0x7000)));

describe('program facts of Sea Dragon 1', () => {
  const f = programFacts(sea.analysis);

  it('is a Model III program, on the evidence of port $EC', () => {
    expect(f.machine.fit).toBe('model3');
    expect(f.machine.evidence).toContainEqual(expect.objectContaining({ kind: 'port', key: 0xec, machine: 3 }));
    expect(f.machine.evidence.find((e) => e.key === 0xec)!.text).toBe('Writes port $EC (MODEPORT), which only the Model III has.');
  });

  it('names the ROM calls it uses and no DOS calls', () => {
    expect(f.romCalls.map((e) => e.name)).toContain('$DELAY');
    expect(f.romCalls.find((e) => e.name === '$DELAY')!.key).toBe(0x0060);
    expect(f.dosCalls).toEqual([]);
  });

  it('names the hardware it touches', () => {
    const names = f.hardware.map((e) => e.name);
    for (const n of ['VIDEO', 'KEYBOARD', 'MODEPORT', 'CASSETTE']) expect(names).toContain(n);
  });

  it('says how it loads', () => {
    expect(f.format).toBe('cmd');
    expect(f.loads).toEqual([{ start: 0x5200, end: 0x888f }]);
    expect(f.size).toBe(13968);
    expect(f.entry).toBe(0x8881);
    expect(f.entryHow).toBe('transfer');
    expect(f.relocations[0]).toEqual({ file: 0x5200, run: 0x497f, length: 0x3681 });
    expect(f.memoryNeeded).toBe(32);
    expect(f.records).toBeGreaterThan(0);
  });

  it('counts the code', () => {
    expect(f.code.percent).toBe(45);
    expect(f.code.of).toBe(13968);
    expect(f.code.routines).toBeGreaterThan(0);
  });
});

describe('machine fit from synthetic programs', () => {
  it('CALL 0033H / RET exists on both machines', () => {
    const f = raw([0xcd, 0x33, 0x00, 0xc9]);
    expect(f.machine.fit).toBe('both');
    expect(f.machine.evidence.every((e) => e.machine === 'both')).toBe(true);
    expect(f.entryHow).toBe('base');
    expect(f.memoryNeeded).toBe(16);
  });

  it('a lone RET is unknown', () => {
    const f = raw([0xc9]);
    expect(f.machine.fit).toBe('unknown');
    expect(f.machine.evidence).toEqual([]);
    expect(f.memoryNeeded).toBe(16);
  });

  it('writing port $EC and reading $37E0 conflicts', () => {
    // OUT ($EC),A ; LD A,($37E0) ; RET
    const f = raw([0xd3, 0xec, 0x3a, 0xe0, 0x37, 0xc9]);
    expect(f.machine.fit).toBe('conflict');
    expect(f.machine.evidence.map((e) => [e.kind, e.machine])).toEqual([['memory', 1], ['port', 3]]);
  });

  it('memory needed follows the highest address', () => {
    const at = (base: number) => programFacts(analyze(loadRaw(new Uint8Array([0xc9]), base))).memoryNeeded;
    expect([at(0x7fff), at(0x8000), at(0xbfff), at(0xc000)]).toEqual([16, 32, 32, 48]);
  });
});
