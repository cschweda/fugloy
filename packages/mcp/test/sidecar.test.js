/**
 * The sidecar label file (Ruling 6, MCP spec §8 and §10's round trip): `<program>.fugloy.json`
 * beside the program, read on load, rewritten at once by label and unlabel. A broken sidecar, or
 * one written for another program, is reported and never overwritten.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseLabelFile } from '@fugloy/emu';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readSidecar, sidecarPath } from '../src/sidecar.js';
import { RAIDERS, connect, syntheticRom, testConfig } from './helpers.js';

let dir;
const at = (name) => join(dir, name);
const SIDECAR = () => at('raiders.fugloy.json');

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'fugloy-mcp-sidecar-'));
  writeFileSync(at('synthetic.rom'), syntheticRom());
  writeFileSync(at('raiders.cmd'), RAIDERS);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

beforeEach(() => rmSync(SIDECAR(), { force: true }));

const server = () => connect({ config: testConfig({ roms: { model3: at('synthetic.rom') } }) });

async function ok(call, name, args) {
  const r = await call(name, args);
  if (r.isError) throw new Error(`${name} failed: ${r.text}`);
  return r.text;
}

describe('the sidecar file', () => {
  it('sits beside the program, named after it without its extension', () => {
    expect(sidecarPath('/games/RAIDERS.CMD')).toBe('/games/RAIDERS.fugloy.json');
    expect(sidecarPath('/games/raiders')).toBe('/games/raiders.fugloy.json');
  });

  it('label writes the sidecar at once and survives a server restart', async () => {
    const first = await server();
    const loaded = await ok(first.call, 'load', { path: at('raiders.cmd') });
    expect(loaded).toContain(`Sidecar: none yet; label writes ${SIDECAR()}`);
    const note = 'copies the zero-ended string at DE to video RAM at HL';
    expect(await ok(first.call, 'label', { addr: '7030', name: 'PRINT', note })).toBe(`Labelled 7030h PRINT (code).\nWrote ${SIDECAR()}.`);
    // Written at once, a valid §8 file carrying the label and its note.
    const { file, errors } = parseLabelFile(readFileSync(SIDECAR(), 'utf8'));
    expect(errors).toEqual([]);
    expect(file.labels).toEqual([{ addr: 0x7030, name: 'PRINT', kind: 'code', source: 'user', note }]);
    expect(file.program.name).toBe('RAIDERS');
    expect(file.sessions).toEqual([]);
    await first.close();

    const second = await server();
    expect(await ok(second.call, 'load', { path: at('raiders.cmd') })).toContain(`Sidecar: ${SIDECAR()}: 1 label, no recorded sessions`);
    expect(await ok(second.call, 'labels', {})).toBe(['Labels (1):', 'addr   kind  size   source    name', `7030h  code         user      PRINT  ; ${note}`].join('\n'));
    // disasm and every address argument know the name at once.
    expect((await ok(second.call, 'disasm', { addr: 'PRINT', n: 1 })).split('\n').slice(0, 2)).toEqual(['PRINT:', '? 7030  1A           LD A,(DE)']);
    expect(await ok(second.call, 'status', {})).toContain('Labels: 1');
    // unlabel rewrites the file too.
    expect(await ok(second.call, 'unlabel', { name: 'print' })).toBe(`Removed PRINT at 7030h.\nWrote ${SIDECAR()}.`);
    expect(parseLabelFile(readFileSync(SIDECAR(), 'utf8')).file.labels).toEqual([]);
    await second.close();
  });

  it('a broken sidecar is reported, not fatal', async () => {
    writeFileSync(SIDECAR(), '{ "fugloy": 1, oops');
    const { call, session, close } = await server();
    const loaded = await ok(call, 'load', { path: at('raiders.cmd') });
    expect(loaded).toMatch(new RegExp(`^Sidecar: ${SIDECAR().replace(/[.$]/g, '\\$&')} ignored: it is not JSON \\(.+\\); label and coverage export leave it as it is$`, 'm'));
    expect(session.labels.size).toBe(0);
    // The label is kept for this session, but the file is not overwritten.
    const r = await call('label', { addr: '7030', name: 'PRINT' });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(
      /^Labelled 7030h PRINT \(code\) for this session only: the sidecar \S+raiders\.fugloy\.json was ignored at load \(it is not JSON \(.+\)\), so it was not overwritten; fix or remove it and load again, or save with coverage mode "export" and a path\.$/,
    );
    expect(readFileSync(SIDECAR(), 'utf8')).toBe('{ "fugloy": 1, oops');
    expect(await ok(call, 'labels', {})).toContain('PRINT');
    expect((await call('coverage', { mode: 'export' })).text).toMatch(/^The sidecar .* was ignored at load \(it is not JSON \(.+\)\), so it is not overwritten; give path to export elsewhere, or fix or remove it and load again\.$/);
    await close();

    // A valid file that breaks a rule of §8 names the rule.
    writeFileSync(SIDECAR(), JSON.stringify({ fugloy: 1, program: { name: 'RAIDERS', model: 3 }, load: [], entry: null, labels: [{ addr: 1, name: 'X', kind: 'code', source: 'observed' }], coverage: {}, callers: {}, sessions: [] }));
    expect(readSidecar(at('raiders.cmd'), 'f'.repeat(64))).toEqual({ path: SIDECAR(), ignored: 'it is not a valid label file (labels[0].evidence: an observed label must carry its evidence)' });
  });

  it('a sidecar written for another program is ignored and kept', async () => {
    const other = { fugloy: 1, program: { name: 'OTHER', sha256: 'a'.repeat(64), model: 3 }, load: [], entry: null, labels: [{ addr: 0x7030, name: 'NOPE', kind: 'code', source: 'user' }], coverage: {}, callers: {}, sessions: [] };
    writeFileSync(SIDECAR(), JSON.stringify(other));
    const { call, close } = await server();
    const loaded = await ok(call, 'load', { path: at('raiders.cmd') });
    expect(loaded).toMatch(/^Sidecar: .* ignored: it was written for another program \(its sha256 is aaaaaaaaaaaa…, this program's is [0-9a-f]{12}…\); label and coverage export leave it as it is$/m);
    expect(await ok(call, 'labels', {})).toBe('No labels yet; label names an address.');
    await close();
    expect(JSON.parse(readFileSync(SIDECAR(), 'utf8'))).toEqual(other);
  });

  it('a sidecar from another session keeps its labels of every source', async () => {
    const { call, close } = await server();
    await ok(call, 'load', { path: at('raiders.cmd') });
    await ok(call, 'run', { until: 'settled' });
    await ok(call, 'key', { keys: ['ENTER'] });
    await ok(call, 'coverage', { mode: 'export' });
    await close();
    expect(existsSync(SIDECAR())).toBe(true);
    const again = await server();
    expect(await ok(again.call, 'load', { path: at('raiders.cmd') })).toContain(`Sidecar: ${SIDECAR()}: 2 labels, 1 recorded session`);
    expect(await ok(again.call, 'labels', { source: 'observed' })).toBe(
      ['Labels (1 of 2, source observed):', 'addr   kind  size   source    name', '7030h  code         observed  SUB_7030  ; called 3× from 3 sites'].join('\n'),
    );
    await again.close();
  });
});
