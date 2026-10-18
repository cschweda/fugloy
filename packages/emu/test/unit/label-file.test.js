/**
 * The label and coverage file (spec §8): the rle-hex encoding (phase 3 Ruling 7), what
 * m.debug.labelFile writes from a synthetic session, user labels, parseLabelFile, the merge rule,
 * and the committed fixture fixtures/synthetic/label-file/sample.labels.json.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COVERAGE, COVERAGE_FIELDS, decodeRle, encodeRle, Machine, mergeLabelFiles, parseLabelFile } from '../../src/index.js';
import { sha256Hex } from '../../src/machine/sha256.js';
import { buildSystemCas } from './cas-builders.js';
import { buildCmd, sampleCmd, sampleLabelText, sampleMachine, sampleRom } from './label-sample.js';

const FIXTURE = fileURLToPath(new URL('../../../../fixtures/synthetic/label-file/sample.labels.json', import.meta.url));
const FIELDS = /** @type {const} */ ([
  ['exec', COVERAGE.EXEC],
  ['operand', COVERAGE.OPERAND],
  ['read', COVERAGE.READ],
  ['write', COVERAGE.WRITE],
  ['jump', COVERAGE.JUMP_TARGET],
  ['call', COVERAGE.CALL_TARGET],
]);

/** A deterministic pseudo-random byte stream (xorshift32): no Math.random in tests that pin output. */
function prng(seed) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x & 0xff;
  };
}

describe('rle-hex', () => {
  it('the six fields carry the debugger\'s coverage bits', () => {
    expect(COVERAGE_FIELDS).toEqual(FIELDS);
  });

  it('rle round-trips random fields and the empty field "10000"', () => {
    expect(encodeRle(new Uint8Array(0x10000), 1)).toBe('10000');
    expect(encodeRle(new Uint8Array(0x10000).fill(0xff), 4)).toBe('0,10000');
    const one = new Uint8Array(0x10000);
    one[0x3c00] = 2;
    one[0xffff] = 2;
    expect(encodeRle(one, 2)).toBe('3C00,1,C3FE,1');
    expect([...decodeRle('10000')].every((b) => b === 0)).toBe(true);
    for (const [seed, density] of [
      [1, 0x80],
      [7, 0x08],
      [99, 0xf8],
    ]) {
      const next = prng(seed);
      const bits = new Uint8Array(0x10000);
      // Runs of random length, so the field has long and short runs both.
      for (let a = 0; a < 0x10000; ) {
        const v = next() < density ? 0x3f : 0x00;
        const len = 1 + (next() & 0x3f);
        bits.fill(v ^ (next() & 0x15), a, Math.min(a + len, 0x10000));
        a += len;
      }
      for (const [, mask] of FIELDS) {
        const text = encodeRle(bits, mask);
        expect(text).toMatch(/^[0-9A-F]+(,[0-9A-F]+)*$/);
        const back = decodeRle(text);
        expect(back.length).toBe(0x10000);
        for (let a = 0; a < 0x10000; a++) if (back[a] !== (bits[a] & mask ? 1 : 0)) throw new Error(`mask ${mask}: $${a.toString(16)} decoded ${back[a]}`);
      }
    }
  });

  it('rejects runs that do not sum to 65536', () => {
    expect(() => decodeRle('FFFF')).toThrow(/65536/);
    expect(() => decodeRle('10000,1')).toThrow(/65536/);
    expect(() => decodeRle('8000,8001')).toThrow(/65536/);
    expect(() => decodeRle('8000,8G00')).toThrow(/hex/);
    expect(() => decodeRle('')).toThrow(/hex/);
    expect(() => decodeRle('8000,,8000')).toThrow(/hex/);
    expect(() => decodeRle(' 10000')).toThrow(/hex/);
  });
});

describe('m.debug.labelFile', () => {
  it('labelFile shape on a synthetic session', () => {
    const m = sampleMachine();
    const bytes = sampleCmd();
    expect(m.debug.loaded).toEqual({
      manifest: { format: 'cmd', name: 'SAMPLE', entry: 0x7000, blocks: [
        { addr: 0x7000, len: 0x40, why: 'record 01' },
        { addr: 0x7040, len: 2, why: 'record 01' },
      ] },
      sha256: sha256Hex(bytes),
    });
    const file = m.debug.labelFile({ started: '2026-10-18T09:00:00Z', input: 'none' });
    expect(Object.keys(file)).toEqual(['fugloy', 'program', 'load', 'entry', 'labels', 'coverage', 'callers', 'sessions']);
    expect(file.fugloy).toBe(1);
    expect(file.program).toEqual({ name: 'SAMPLE', sha256: sha256Hex(bytes), model: 3 });
    expect(file.load).toEqual([
      { addr: 0x7000, len: 0x40, source: 'cmd-block-0' },
      { addr: 0x7040, len: 2, source: 'cmd-block-1' },
    ]);
    expect(file.entry).toBe(0x7000);
    expect(file.labels).toEqual([
      { addr: 0x7000, name: 'ENTRY', kind: 'code', source: 'loader' },
      { addr: 0x7020, name: 'SUB_7020', kind: 'code', source: 'observed', evidence: 'called 3× from 1 site' },
      { addr: 0x7030, name: 'SUB_7030', kind: 'code', source: 'observed', evidence: 'called 2× from 2 sites' },
      { addr: 0x7034, name: 'BUMP', kind: 'code', source: 'user' },
      { addr: 0x7040, name: 'SCORE', kind: 'data', size: 2, source: 'user' },
    ]);
    // Coverage: one key, the six fields, each decoding to exactly the live bits.
    expect(Object.keys(file.coverage)).toEqual(['0:0']);
    const cov = file.coverage['0:0'];
    expect(Object.keys(cov)).toEqual(['encoding', 'exec', 'operand', 'read', 'write', 'jump', 'call']);
    expect(cov.encoding).toBe('rle-hex');
    const live = m.debug.coverage.bits;
    for (const [field, mask] of FIELDS) {
      const back = decodeRle(cov[field]);
      for (let a = 0; a < 0x10000; a++) if (back[a] !== (live[a] & mask ? 1 : 0)) throw new Error(`${field}: $${a.toString(16)}`);
    }
    const at = (field, addr) => decodeRle(cov[field])[addr];
    expect([at('exec', 0x7030), at('operand', 0x7031), at('operand', 0x7032), at('exec', 0x7033), at('operand', 0x7033)]).toEqual([1, 1, 1, 0, 0]);
    expect([at('read', 0x7040), at('write', 0x7041), at('read', 0x7041)]).toEqual([1, 1, 0]);
    expect([at('jump', 0x7006), at('jump', 0x7034), at('call', 0x7020), at('call', 0x7030), at('call', 0x0008), at('jump', 0x7009)]).toEqual([1, 1, 1, 1, 1, 0]);
    expect(file.callers).toEqual({
      8: [{ from: 0x700b, kind: 'rst', count: 1 }],
      [0x7006]: [{ from: 0x7009, kind: 'jr', count: 2 }],
      [0x7009]: [{ from: 0x7024, kind: 'ret-to', count: 3 }],
      [0x700c]: [{ from: 0x0008, kind: 'ret-to', count: 1 }],
      [0x7015]: [{ from: 0x7034, kind: 'ret-to', count: 1 }],
      [0x7018]: [{ from: 0x7034, kind: 'ret-to', count: 1 }],
      [0x7020]: [{ from: 0x7006, kind: 'call', count: 3 }],
      [0x7030]: [
        { from: 0x7012, kind: 'call', count: 1 },
        { from: 0x7015, kind: 'call', count: 1 },
      ],
      [0x7034]: [{ from: 0x7030, kind: 'jp', count: 2 }],
    });
    expect(Object.keys(file.callers)).toEqual(Object.keys(file.callers).sort((a, b) => Number(a) - Number(b)));
    expect(file.sessions).toEqual([{ cycles: m.cycles, started: '2026-10-18T09:00:00Z', input: 'none' }]);
    // Without started and input the session holds only the cycles; a name overrides the manifest's.
    const plain = m.debug.labelFile({ name: 'SAMPLE/CMD' });
    expect(plain.sessions).toEqual([{ cycles: m.cycles }]);
    expect(plain.program.name).toBe('SAMPLE/CMD');
    // The file is plain JSON data.
    expect(JSON.parse(JSON.stringify(file))).toEqual(file);
  });

  it('needs a name when nothing was loaded', () => {
    const m = new Machine({ roms: { level2: sampleRom() } });
    expect(m.debug.loaded).toBe(null);
    expect(() => m.debug.labelFile()).toThrow('labelFile needs a name: nothing was loaded through m.load');
    const file = m.debug.labelFile({ name: 'BARE' });
    expect(file.program).toEqual({ name: 'BARE', model: 3 });
    expect(file.load).toEqual([]);
    expect(file.entry).toBe(null);
    expect(file.labels).toEqual([]);
    expect(file.coverage['0:0'].exec).toBe('10000');
    expect(file.callers).toEqual({});
  });

  it('leaves predicted blocks out, and the last load wins', () => {
    const m = new Machine({ roms: { level2: sampleRom() } });
    m.load.cmd(sampleCmd());
    const other = buildCmd([{ name: 'OTHER' }, { addr: 0x8000, data: [0x76] }], 0x8000);
    m.load.cmd(other);
    expect(m.debug.loaded.sha256).toBe(sha256Hex(other));
    expect(m.debug.labelFile().load).toEqual([{ addr: 0x8000, len: 1, source: 'cmd-block-0' }]);
    // A system tape via the ROM's loader: nothing has landed, so `load` is empty, but the entry is known.
    const cas = buildSystemCas([{ addr: 0x8000, data: [0x76] }], 0x8000, { name: 'SYSTEM' });
    const manifest = m.load.cas(cas);
    expect(manifest.blocks.every((b) => b.predicted)).toBe(true);
    const file = m.debug.labelFile();
    expect(file.program.name).toBe('SYSTEM');
    expect(file.load).toEqual([]);
    expect(file.entry).toBe(0x8000);
  });
});

describe('m.debug.label', () => {
  it('user labels win over observed at one address', () => {
    const m = sampleMachine();
    m.debug.label(0x7020, 'SHOW');
    m.debug.label(0x7000, 'START', { kind: 'code' });
    const labels = m.debug.labelFile().labels;
    expect(labels.filter((l) => l.addr === 0x7020)).toEqual([{ addr: 0x7020, name: 'SHOW', kind: 'code', source: 'user' }]);
    expect(labels.filter((l) => l.addr === 0x7000)).toEqual([{ addr: 0x7000, name: 'START', kind: 'code', source: 'user' }]);
    // The same address replaces; labels are listed by address.
    m.debug.label(0x7020, 'PRINT');
    expect(m.debug.labels).toEqual([
      { addr: 0x7000, name: 'START', kind: 'code', source: 'user' },
      { addr: 0x7020, name: 'PRINT', kind: 'code', source: 'user' },
      { addr: 0x7034, name: 'BUMP', kind: 'code', source: 'user' },
      { addr: 0x7040, name: 'SCORE', kind: 'data', size: 2, source: 'user' },
    ]);
    // A copy: changing it changes nothing.
    m.debug.labels[0].name = 'X';
    expect(m.debug.labels[0].name).toBe('START');
  });

  it('refuses a bad address, name, kind, or size', () => {
    const m = new Machine({ roms: { level2: sampleRom() } });
    expect(() => m.debug.label(0x10000, 'X')).toThrow(/address/);
    expect(() => m.debug.label(0, '')).toThrow(/name/);
    expect(() => m.debug.label(0, '1ST')).toThrow(/name/);
    expect(() => m.debug.label(0, 'A', { kind: 'text' })).toThrow(/kind/);
    expect(() => m.debug.label(0, 'A', { kind: 'data', size: 0 })).toThrow(/size/);
  });
});

describe('parseLabelFile', () => {
  it('parse accepts what labelFile writes and reports each broken rule', () => {
    const m = sampleMachine();
    const good = m.debug.labelFile({ started: '2026-10-18T09:00:00Z', input: 'none' });
    expect(parseLabelFile(good)).toEqual({ file: good, errors: [] });
    expect(parseLabelFile(JSON.stringify(good))).toEqual({ file: good, errors: [] });
    // Unknown top-level keys are kept.
    const extra = { ...good, notes: 'kept' };
    expect(parseLabelFile(extra).file?.notes).toBe('kept');

    /** @param {(f: any) => void} change @returns {string[]} */
    const broken = (change) => {
      const f = JSON.parse(JSON.stringify(good));
      change(f);
      const r = parseLabelFile(f);
      expect(r.file).toBe(null);
      return r.errors;
    };
    expect(parseLabelFile('{ nope').errors[0]).toMatch(/not JSON/);
    expect(parseLabelFile([]).errors).toEqual(['the label file must be a JSON object']);
    expect(broken((f) => (f.fugloy = 2))).toEqual(['fugloy: version 2 is not supported (this reader knows 1)']);
    expect(broken((f) => delete f.sessions)).toEqual(['sessions: missing']);
    expect(broken((f) => (f.program.name = ''))).toEqual(['program.name: must be a non-empty string']);
    expect(broken((f) => (f.program.sha256 = 'ABC'))).toEqual(['program.sha256: must be 64 lowercase hex digits']);
    expect(broken((f) => (f.program.model = 2))).toEqual(['program.model: must be 1, 3, or 4']);
    expect(broken((f) => (f.load[1].len = 0))).toEqual(['load[1].len: must be an integer 1..65536']);
    expect(broken((f) => (f.load[0].source = 7))).toEqual(['load[0].source: must be a string']);
    expect(broken((f) => (f.entry = 70000))).toEqual(['entry: must be an address 0..65535 or null']);
    expect(broken((f) => (f.labels[0].source = 'guess'))).toEqual(['labels[0].source: must be loader, observed, user, or disasm']);
    expect(broken((f) => (f.labels[0].kind = 'text'))).toEqual(['labels[0].kind: must be code or data']);
    expect(broken((f) => delete f.labels[1].evidence)).toEqual(['labels[1].evidence: an observed label must carry its evidence']);
    expect(broken((f) => (f.labels[4].size = -1))).toEqual(['labels[4].size: must be an integer 1..65536']);
    expect(broken((f) => (f.labels[1].addr = 0x7000))).toEqual(['labels[1]: a second label at $7000']);
    expect(broken((f) => (f.coverage['0:0'].encoding = 'rle'))).toEqual(['coverage["0:0"].encoding: must be "rle-hex"']);
    expect(broken((f) => delete f.coverage['0:0'].jump)).toEqual(['coverage["0:0"].jump: missing']);
    expect(broken((f) => (f.coverage['0:0'].read = 'FFFF'))).toEqual(['coverage["0:0"].read: the runs sum to 65535, not 65536']);
    expect(broken((f) => (f.coverage.zero = f.coverage['0:0']))).toEqual(['coverage["zero"]: the key must be "<map>:<page>", as "0:0"']);
    expect(broken((f) => (f.callers['07020'] = f.callers['28704']))).toEqual(['callers["07020"]: the key must be a decimal address 0..65535']);
    expect(broken((f) => (f.callers['28704'][0].kind = 'jmp'))).toEqual(['callers["28704"][0].kind: must be call, jp, jr, rst, or ret-to']);
    expect(broken((f) => (f.callers['28704'][0].count = 0))).toEqual(['callers["28704"][0].count: must be a positive integer']);
    expect(broken((f) => (f.sessions[0].cycles = -1))).toEqual(['sessions[0].cycles: must be a non-negative integer']);
    expect(broken((f) => (f.sessions[0].started = 5))).toEqual(['sessions[0].started: must be a string']);
    // Several broken rules are all reported.
    expect(broken((f) => {
      f.entry = 'x';
      f.labels = {};
    })).toEqual(['entry: must be an address 0..65535 or null', 'labels: must be an array']);
  });
});

describe('mergeLabelFiles', () => {
  const base = () => ({
    fugloy: 1,
    program: { name: 'P', model: 3 },
    load: [{ addr: 0x7000, len: 16, source: 'cmd-block-0' }],
    entry: null,
    labels: [],
    coverage: {},
    callers: {},
    sessions: [],
  });

  it('merge follows the precedence and sums counts', () => {
    const sha = 'a'.repeat(64);
    const a = {
      ...base(),
      program: { name: 'P', sha256: sha, model: 3 },
      entry: null,
      labels: [
        { addr: 0x7000, name: 'ENTRY', kind: 'code', source: 'loader' },
        { addr: 0x7010, name: 'SUB_7010', kind: 'code', source: 'observed', evidence: 'called 1× from 1 site' },
        { addr: 0x7020, name: 'MINE', kind: 'code', source: 'user' },
        { addr: 0x7030, name: 'D1', kind: 'code', source: 'disasm' },
      ],
      coverage: { '0:0': { encoding: 'rle-hex', exec: '7000,1,8FFF', operand: '10000', read: '10000', write: '10000', jump: '10000', call: '10000' } },
      callers: { 28688: [{ from: 0x7000, kind: 'call', count: 2 }] },
      sessions: [{ cycles: 10 }],
      notes: 'from a',
    };
    const b = {
      ...base(),
      load: [
        { addr: 0x7000, len: 16, source: 'cmd-block-0' },
        { addr: 0x8000, len: 4, source: 'cmd-block-1' },
      ],
      entry: 0x7000,
      labels: [
        { addr: 0x7000, name: 'START', kind: 'code', source: 'disasm' },
        { addr: 0x7010, name: 'LOOP', kind: 'code', source: 'disasm' },
        { addr: 0x7020, name: 'THEIRS', kind: 'code', source: 'user' },
        { addr: 0x7030, name: 'SUB_7030', kind: 'code', source: 'observed', evidence: 'called 4× from 2 sites' },
        { addr: 0x7040, name: 'TABLE', kind: 'data', size: 8, source: 'user' },
      ],
      coverage: {
        '0:0': { encoding: 'rle-hex', exec: '7001,1,8FFE', operand: '10000', read: '0,10000', write: '10000', jump: '10000', call: '10000' },
        '2:1': { encoding: 'rle-hex', exec: '0,10000', operand: '10000', read: '10000', write: '10000', jump: '10000', call: '10000' },
      },
      callers: {
        28688: [
          { from: 0x7000, kind: 'call', count: 3 },
          { from: 0x7000, kind: 'jp', count: 1 },
        ],
        8: [{ from: 0x7002, kind: 'rst', count: 1 }],
      },
      sessions: [{ cycles: 20, input: 'b' }],
      notes: 'from b',
      more: 1,
    };
    const merged = mergeLabelFiles(a, b);
    expect(merged.program).toEqual({ name: 'P', sha256: sha, model: 3 });
    expect(merged.load).toEqual([
      { addr: 0x7000, len: 16, source: 'cmd-block-0' },
      { addr: 0x8000, len: 4, source: 'cmd-block-1' },
    ]);
    expect(merged.entry).toBe(0x7000);
    expect(merged.labels).toEqual([
      { addr: 0x7000, name: 'START', kind: 'code', source: 'disasm' }, // disasm beats loader
      { addr: 0x7010, name: 'SUB_7010', kind: 'code', source: 'observed', evidence: 'called 1× from 1 site' }, // observed beats disasm
      { addr: 0x7020, name: 'THEIRS', kind: 'code', source: 'user' }, // a tie: b wins
      { addr: 0x7030, name: 'SUB_7030', kind: 'code', source: 'observed', evidence: 'called 4× from 2 sites' },
      { addr: 0x7040, name: 'TABLE', kind: 'data', size: 8, source: 'user' },
    ]);
    expect(Object.keys(merged.coverage)).toEqual(['0:0', '2:1']);
    expect(merged.coverage['0:0']).toEqual({ encoding: 'rle-hex', exec: '7000,2,8FFE', operand: '10000', read: '0,10000', write: '10000', jump: '10000', call: '10000' });
    expect(merged.coverage['2:1']).toEqual(b.coverage['2:1']);
    expect(merged.callers).toEqual({
      8: [{ from: 0x7002, kind: 'rst', count: 1 }],
      28688: [
        { from: 0x7000, kind: 'call', count: 5 },
        { from: 0x7000, kind: 'jp', count: 1 },
      ],
    });
    expect(merged.sessions).toEqual([{ cycles: 10 }, { cycles: 20, input: 'b' }]);
    expect(merged.notes).toBe('from a');
    expect(merged.more).toBe(1);
    expect(parseLabelFile(merged).errors).toEqual([]);
    // a's entry stands when it has one.
    expect(mergeLabelFiles({ ...b, entry: 0x8000 }, a).entry).toBe(0x8000);
  });

  it('merge refuses two programs', () => {
    const a = { ...base(), program: { name: 'P', sha256: 'a'.repeat(64), model: 3 } };
    const b = { ...base(), program: { name: 'P', sha256: 'b'.repeat(64), model: 3 } };
    expect(() => mergeLabelFiles(a, b)).toThrow(/different programs/);
    // A broken file is refused with its errors.
    expect(() => mergeLabelFiles(a, { ...base(), fugloy: 9 })).toThrow(/fugloy: version 9/);
    // The same program merges; a file without a hash takes the other's.
    expect(mergeLabelFiles(base(), a).program.sha256).toBe('a'.repeat(64));
  });
});

describe('the committed fixture', () => {
  it('the committed fixture matches the writer', () => {
    expect(existsSync(FIXTURE), `${FIXTURE} is missing: run pnpm fixtures`).toBe(true);
    const committed = readFileSync(FIXTURE, 'utf8');
    if (committed !== sampleLabelText()) throw new Error(`${FIXTURE} differs from what the writer produces: run pnpm fixtures (or node packages/emu/scripts/write-label-fixture.mjs) and commit the result`);
    expect(parseLabelFile(committed).errors).toEqual([]);
  });

  it('the sample session is deterministic', () => {
    expect(sampleLabelText()).toBe(sampleLabelText());
  });
});
