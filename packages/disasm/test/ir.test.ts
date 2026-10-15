import { describe, expect, it } from 'vitest';
import { recursiveDescent } from '../src/analysis/descent.js';
import { loadCmd } from '../src/cmd.js';
import { buildIr } from '../src/ir.js';
import { loadRaw } from '../src/raw.js';
import { CMD_FIXTURES } from './fixtures.js';

describe('buildIr', () => {
  it('builds a versioned IR for the non-contiguous fixture and matches the committed snapshot', () => {
    const mod = loadCmd(CMD_FIXTURES['non-contiguous']!());
    const ir = buildIr(mod, recursiveDescent(mod.image, [mod.entry!]), 'non-contiguous.cmd');
    expect(ir.fugloyIr).toBe(1);
    expect(ir.format).toBe('cmd');
    expect(ir.source).toBe('non-contiguous.cmd');
    expect(ir.entry).toBe(0x6000);
    expect(ir.roots).toEqual([0x6000]);
    expect(ir.loaded).toEqual([{ start: 0x6000, end: 0x6005 }, { start: 0x7000, end: 0x7007 }]);
    expect(ir.regions).toEqual([{ kind: 'code', start: 0x6000, end: 0x6005 }, { kind: 'unknown', start: 0x7000, end: 0x7007 }]);
    expect(ir.blocks).toEqual([{ start: 0x6000, end: 0x6005, succ: [] }]);
    expect(JSON.parse(JSON.stringify(ir))).toMatchSnapshot();
  });

  it('carries diagnostics, externals, xrefs, and indirect jumps for a raw image', () => {
    const mod = loadRaw(Uint8Array.from([0xcd, 0x33, 0x00, 0xe9]), 0x5200);
    const ir = buildIr(mod, recursiveDescent(mod.image, [0x5200, 0x5201]));
    expect(ir.format).toBe('raw');
    expect(ir.source).toBeUndefined();
    expect(ir.externals).toEqual([0x0033]);
    expect(ir.xrefs).toEqual([{ from: 0x5200, to: 0x0033, kind: 'call' }]);
    expect(ir.indirectJumps).toEqual([0x5203]);
    expect(ir.diagnostics.map((d) => d.kind)).toEqual(['inside-instruction']);
  });
});
