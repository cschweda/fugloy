import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadCmd } from '../../src/cmd.js';
import { loadRaw } from '../../src/raw.js';
import { exportName } from '../../src/write/name.js';
import { writeCmd } from '../../src/write/cmd.js';
import { CmdWriter } from '../writers/cmd-writer.js';

const root = fileURLToPath(new URL('../../../../examples/', import.meta.url));
const programs = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) => readdirSync(`${root}${d.name}`).filter((f) => !/\.(md|hints)$/i.test(f)).map((f) => `${d.name}/${f}`));

describe('writeCmd', () => {
  it('finds the examples, including ARMOUR.III', () => {
    expect(programs.length).toBeGreaterThan(20);
    expect(programs).toContain('armored-patrol/ARMOUR.III');
  });

  it.each(programs)('round trips %s: same bytes, same loaded map, same entry', (rel) => {
    const mod = loadCmd(new Uint8Array(readFileSync(`${root}${rel}`)));
    const back = loadCmd(writeCmd(mod.image, { entry: mod.entry, name: 'PROG' }));
    expect(back.image.bytes).toEqual(mod.image.bytes);
    expect(back.image.loaded).toEqual(mod.image.loaded);
    expect(back.entry).toBe(mod.entry);
    expect(back.name).toBe('PROG');
  });

  it('writes a raw program at $7000 with a transfer record that loads back as a transfer', () => {
    const raw = loadRaw(Uint8Array.from([0x3e, 0x01, 0xc9]), 0x7000);
    const back = loadCmd(writeCmd(raw.image, { entry: 0x7000 }));
    expect([back.entry, back.entrySource]).toEqual([0x7000, 'transfer']);
    expect(back.name).toBeUndefined();
  });

  it('ends with 03 00 and no transfer when there is no entry, and splits runs into 256-byte records', () => {
    const raw = loadRaw(new Uint8Array(600).fill(7), 0x7000);
    const bytes = writeCmd(raw.image, { entry: null, name: 'LONGERTHAN8' });
    expect(Array.from(bytes.subarray(-2))).toEqual([3, 0]);
    const back = loadCmd(bytes);
    expect(back.name).toBe('LONGERTH');
    expect(back.records.filter((r) => r.type === 1).map((r) => (r as { dataLength: number }).dataLength)).toEqual([256, 256, 88]);
    expect(back.image.bytes).toEqual(raw.image.bytes);
  });
});

describe('CmdWriter', () => {
  it('is still exported from the test path', () => {
    expect(new CmdWriter().load(0x7000, [1]).transfer(0x7000).bytes().length).toBe(9);
  });
});

describe('exportName', () => {
  const named = (name?: string) => ({ format: 'cmd', name }) as never;
  it('uses the 05 name when it has no escape, else the cleaned file stem', () => {
    expect(exportName(named('SEADRG'), 'x.cmd', 8)).toBe('SEADRG');
    expect(exportName(named('SEA{00}'), 'sea-dragon 01.cmd', 8)).toBe('SEADRAGO');
    expect(exportName(named('SEA{00}'), 'sea-dragon 01.cmd', 6)).toBe('SEADRA');
    expect(exportName(named(undefined), 'reargrd1.cmd', 6)).toBe('REARGR');
    expect(exportName({ format: 'bas' } as never, 'C:\\a\\prog.bas', 6)).toBe('PROG');
    expect(exportName(named('LONGNAME9'), 'x', 6)).toBe('LONGNA');
  });
});
