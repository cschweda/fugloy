import { describe, expect, it } from 'vitest';
import { recursiveDescent } from '../src/analysis/descent.js';
import { loadCmd } from '../src/cmd.js';
import { buildIr } from '../src/ir.js';
import { loadRaw } from '../src/raw.js';
import { applyHints } from '../src/hints/apply.js';
import { analyze } from '../src/pipeline.js';
import { loadBas } from '../src/bas.js';
import { CMD_FIXTURES, HINT_FIXTURES } from './fixtures.js';
import { writeBasic } from './writers/basic-tokenizer.js';

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

  it('carries symbols and the hint summary', () => {
    const mod = loadCmd(CMD_FIXTURES['hint-paths']!());
    const applied = applyHints(HINT_FIXTURES['hint-paths']!(), mod.image);
    const a = analyze(mod, { annotations: applied.annotations, hints: { source: 'hint-paths.hints', matched: 1, unmatched: 0, applied: 11, warnings: [] } });
    const ir = buildIr(mod, a.pass1, 'hint-paths.cmd', a);
    expect(ir.symbols.map((s) => `${s.name}:${s.kind}:${s.source}`)).toContain('PRINT:sub:user');
    expect(ir.symbols.map((s) => s.name)).toContain('DATA_6040');
    expect(ir.hints).toEqual({ source: 'hint-paths.hints', matched: 1, unmatched: 0, applied: 11, warnings: [] });
    expect(buildIr(mod, a.pass1).symbols).toEqual([]);
    expect(buildIr(mod, a.pass1).hints).toBeUndefined();
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

describe('buildIr for a .BAS program', () => {
  it('carries the mined entries with their evidence, and none for a load module', () => {
    const prog = loadBas(writeBasic([{ number: 10, text: 'END' }, { number: 20, text: 'DEFUSR=28672' }], 0x7000));
    const a = analyze(prog);
    expect(buildIr(prog, a.pass1, 'p.bas', a).entries).toEqual([{ addr: 0x7000, evidence: 'line 20: DEFUSR0 = $7000', line: 20 }]);
    const mod = loadCmd(CMD_FIXTURES['non-contiguous']!());
    expect(buildIr(mod, analyze(mod).pass1, 'x.cmd', analyze(mod)).entries).toEqual([]);
  });
});
