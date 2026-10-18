/**
 * The sidecar label file (Ruling 6, MCP spec §8 and §10's round trip): `<program>.fugloy.json`
 * beside the program, read on load, rewritten at once by label and unlabel. A broken sidecar, or
 * one written for another program, is reported and never overwritten.
 */
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

  it('hand edits made after load are never overwritten', async () => {
    const { call, close } = await server();
    await ok(call, 'load', { path: at('raiders.cmd') });
    await ok(call, 'label', { addr: '7030', name: 'PRINT' });
    const edited = JSON.parse(readFileSync(SIDECAR(), 'utf8'));
    edited.labels.push({ addr: 0x7040, name: 'BANNER', kind: 'data', source: 'user' });
    writeFileSync(SIDECAR(), JSON.stringify(edited));
    const r = await call('label', { addr: '7050', name: 'PLAYER' });
    expect(r).toEqual({
      text: `Labelled 7050h PLAYER (code) in this session, but the sidecar ${SIDECAR()} changed on disk since the server last read or wrote it, so it was not overwritten; load the program again to pick up the edits`,
      isError: true,
    });
    expect(JSON.parse(readFileSync(SIDECAR(), 'utf8'))).toEqual(edited);
    // An edit that breaks the file is named; coverage export to the sidecar is refused the same way.
    writeFileSync(SIDECAR(), '{');
    expect((await call('unlabel', { name: 'PRINT' })).text).toMatch(/^Removed PRINT at 7030h in this session, but the sidecar \S+ changed, and it is not JSON \(.+\) on disk since the server last read or wrote it/);
    expect((await call('coverage', { mode: 'export' })).text).toMatch(/^The sidecar \S+ changed, and it is not JSON/);
    expect(readFileSync(SIDECAR(), 'utf8')).toBe('{');
    await close();

    // A sidecar that appears after a load that found none is not overwritten either.
    rmSync(SIDECAR());
    const again = await server();
    await ok(again.call, 'load', { path: at('raiders.cmd') });
    writeFileSync(SIDECAR(), 'by hand');
    expect((await again.call('label', { addr: '7030', name: 'PRINT' })).text).toMatch(/but the sidecar \S+ appeared on disk since the server last read or wrote it/);
    expect(readFileSync(SIDECAR(), 'utf8')).toBe('by hand');
    await again.close();
  });

  it('a symbolic link at the sidecar path is reported and never written through', async () => {
    symlinkSync(at('nowhere.json'), SIDECAR());
    const { call, close } = await server();
    expect(await ok(call, 'load', { path: at('raiders.cmd') })).toContain(
      `Sidecar: ${SIDECAR()} ignored: it is a symbolic link (the server neither reads nor writes through links; replace it with a file); label and coverage export leave it as it is`,
    );
    expect((await call('label', { addr: '7030', name: 'PRINT' })).isError).toBe(true);
    expect((await call('coverage', { mode: 'export' })).isError).toBe(true);
    expect(lstatSync(SIDECAR()).isSymbolicLink()).toBe(true);
    expect(existsSync(at('nowhere.json'))).toBe(false);
    await close();
  });

  it('a sidecar found only in the fixtures folder is read, and writes go beside the program', async () => {
    const fixtures = at('fixtures');
    mkdirSync(fixtures, { recursive: true });
    const first = await server();
    await ok(first.call, 'load', { path: at('raiders.cmd') });
    await ok(first.call, 'label', { addr: '7030', name: 'PRINT' });
    await first.close();
    const kept = readFileSync(SIDECAR(), 'utf8');
    writeFileSync(join(fixtures, 'raiders.fugloy.json'), kept);
    rmSync(SIDECAR());

    const { call, close } = await connect({ config: testConfig({ roms: { model3: at('synthetic.rom') }, fixtures }) });
    expect(await ok(call, 'load', { path: at('raiders.cmd') })).toContain(
      `Sidecar: ${join(fixtures, 'raiders.fugloy.json')}: 1 label, no recorded sessions; writes go to ${SIDECAR()}, beside the program`,
    );
    expect(await ok(call, 'label', { addr: '7040', name: 'BANNER', kind: 'data' })).toBe(`Labelled 7040h BANNER (data).\nWrote ${SIDECAR()}.`);
    expect(parseLabelFile(readFileSync(SIDECAR(), 'utf8')).file.labels.map((l) => l.name)).toEqual(['PRINT', 'BANNER']);
    expect(readFileSync(join(fixtures, 'raiders.fugloy.json'), 'utf8')).toBe(kept);
    await close();
  });
});
