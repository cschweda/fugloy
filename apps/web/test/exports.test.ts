import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadCmd, openProgram, renderSession, withHintText } from '@fugloy/disasm';
import { exportFile, exportKinds } from '../app/utils/exports';

const ex = (p: string): string => fileURLToPath(new URL(`../../../examples/${p}`, import.meta.url));
const selection = { machine: 3, dos: 'trsdos' } as const;
const sea = withHintText(
  openProgram(new Uint8Array(readFileSync(ex('sea-dragon/seadrg01.cmd'))), { name: 'seadrg01.cmd', selection }),
  readFileSync(ex('sea-dragon/seadrg01.hints'), 'utf8'),
  'seadrg01.hints',
);
const raw = (bytes: number[], base = 0x7000) => openProgram(Uint8Array.from(bytes), { name: 'blob.bin', base, selection });
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);

describe('exportFile', () => {
  it('zmac is exactly renderSession zmac, named by the stem', () => {
    const f = exportFile(sea, 'zmac');
    expect(dec(f.bytes)).toBe(renderSession(sea, 'zmac'));
    expect(f.filename).toBe('seadrg01.z80');
    expect(f.warnings).toEqual([]);
  });

  it('hints and IR have their own names and content', () => {
    expect(exportFile(sea, 'hints').filename).toBe('seadrg01.hints');
    expect(dec(exportFile(sea, 'hints').bytes)).toContain('fugloy-hints 1');
    const ir = exportFile(sea, 'ir');
    expect(ir.filename).toBe('seadrg01.ir.json');
    expect(dec(ir.bytes)).toBe(renderSession(sea, 'ir'));
    expect(() => JSON.parse(dec(ir.bytes))).not.toThrow();
  });

  it('cmd reloads to the same image and entry', () => {
    const f = exportFile(sea, 'cmd');
    expect(f.filename).toBe('seadrg01.cmd');
    const back = loadCmd(f.bytes);
    expect(back.image.bytes).toEqual(sea.module.image.bytes);
    expect(back.image.loaded).toEqual(sea.module.image.loaded);
    expect(back.entry).toBe(sea.analysis.entry);
  });

  it('cmd of ARMOUR.III (overlapping patch) reloads to the same image and entry, stem ARMOUR', () => {
    const s = openProgram(new Uint8Array(readFileSync(ex('armored-patrol/ARMOUR.III'))), { name: 'ARMOUR.III', selection });
    const f = exportFile(s, 'cmd');
    expect(f.filename).toBe('ARMOUR.cmd');
    const back = loadCmd(f.bytes);
    expect(back.image.bytes).toEqual(s.module.image.bytes);
    expect(back.image.loaded).toEqual(s.module.image.loaded);
    expect(back.entry).toBe(s.analysis.entry);
  });

  it('cas has no warnings for Sea Dragon', () => {
    const f = exportFile(sea, 'cas');
    expect(f.filename).toBe('seadrg01.cas');
    expect(f.warnings).toEqual([]);
    expect(Array.from(f.bytes.subarray(256, 258))).toEqual([0xa5, 0x55]);
  });

  it('cas of a program that calls the DOS still exports, warning that it will not run from tape', () => {
    const s = raw([0xcd, 0x2d, 0x40, 0xc9], 0x5000);
    const f = exportFile(s, 'cas');
    expect(f.bytes.length).toBeGreaterThan(256);
    expect(f.warnings).toEqual(['calls the DOS; it will not run from tape']);
  });

  it('cas of blocks below $4200 still exports, warning about the ROM', () => {
    const f = exportFile(raw([0x3e, 0x01, 0xc9], 0x4000), 'cas');
    expect(f.bytes.length).toBeGreaterThan(256);
    expect(f.warnings).toEqual(['loads under $4200, over memory the ROM uses while loading a tape']);
  });

  it('cas is refused with "no entry point" when there is none, and cmd writes 03 00', () => {
    const s = { ...raw([0xc9]), analysis: { ...raw([0xc9]).analysis, entry: null, transfer: null } };
    expect(() => exportFile(s, 'cas')).toThrow('no entry point');
    expect(Array.from(exportFile(s, 'cmd').bytes.subarray(-2))).toEqual([3, 0]);
  });
});

describe('exportKinds', () => {
  it('offers all five for a .CMD and a raw program', () => {
    expect(exportKinds(sea)).toEqual(['zmac', 'hints', 'ir', 'cmd', 'cas']);
    expect(exportKinds(raw([0xc9]))).toEqual(['zmac', 'hints', 'ir', 'cmd', 'cas']);
  });

  it('does not offer cmd for a .BAS program, whose cas is a BASIC tape', () => {
    const bas = Uint8Array.from([0xe9, 0x42, 0x0a, 0x00, 0x80, 0x00, 0x00, 0x00]);
    const s = openProgram(bas, { name: 'HELLO.BAS', selection });
    expect(s.module.format).toBe('bas');
    expect(exportKinds(s)).not.toContain('cmd');
    expect(exportKinds(s)).toContain('cas');
    const f = exportFile(s, 'cas');
    expect(f.filename).toBe('HELLO.cas');
    expect(Array.from(f.bytes.subarray(256, 260))).toEqual([0xa5, 0xd3, 0xd3, 0xd3]);
  });
});
