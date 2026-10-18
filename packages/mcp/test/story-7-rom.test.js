/**
 * Emu phase 4's done-criterion (docs/fugloy-emu-spec.md §11), in scripted form: load a game, find
 * its print routine, and label it, through the MCP tools alone. This is MCP spec §13 story 7
 * ("what does this game do?") on Sea Dragon from examples/, on the Model III ROM named by the
 * repository's fugloy.mcp.json (gitignored; the suite skips without it): play a scripted minute,
 * ask `suggest` for the routines worth naming, confirm which one prints text by watching the
 * screen line its text lands on, label it, export the label and coverage file, and read that
 * file back with Fugløy's disassembler. Properties only: a transcript would carry ROM text.
 *
 * The program is copied to a temporary folder first, so the sidecar the server writes beside it
 * never lands in examples/.
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openProgram, parseLabelFile, renderSession, withHintText, withLabelFile } from '@fugloy/disasm';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { connect } from './helpers.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const config = loadConfig({ cwd: repo, env: process.env, home: homedir() });
const examples = join(repo, 'examples/sea-dragon');

async function ok(call, name, args) {
  const r = await call(name, args);
  if (r.isError) throw new Error(`${name} failed: ${r.text}`);
  return r.text;
}

/** The arrow keys and SPACE (the fire key) on a fixed schedule: four patterns, round and round. */
const PLAY = [
  ['RIGHT', 'RIGHT', 'SPACE'],
  ['UP', 'SPACE', 'UP'],
  ['DOWN', 'DOWN', 'SPACE'],
  ['LEFT', 'SPACE', 'RIGHT'],
];

/**
 * The relocation lines of the committed hints only (`block 0 …`, `relocate`, `entry`), so the
 * listing has the game at $497F, where it runs, but none of the hint file's own names: the name
 * the listing shows must come from the exported file.
 */
function relocationHints() {
  const text = readFileSync(join(examples, 'seadrg01.hints'), 'utf8');
  const kept = text.split('\n').filter((l) => /^(fugloy-hints|program sha256|block 0 length|block 0:\$0000 (relocate|entry))/.test(l));
  expect(kept).toHaveLength(5);
  return `${kept.join('\n')}\n`;
}

describe.skipIf(config.roms.model3 === undefined)('story 7 on the Model III ROM', { timeout: 120_000 }, () => {
  it('story 7 on Sea Dragon, scripted', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fugloy-mcp-story-7-'));
    try {
      const program = join(dir, 'seadrg01.cmd');
      copyFileSync(join(examples, 'seadrg01.cmd'), program);
      const sidecar = join(dir, 'seadrg01.fugloy.json');
      const { call, close } = await connect({ config });
      expect(await ok(call, 'load', { path: program })).toContain(`Sidecar: none yet; label writes ${sidecar}`);

      // The intro animation, then the title (two settled stops; see phase-a-rom.test.js), ENTER,
      // one player, Novice: the game starts.
      await ok(call, 'run', { until: 'settled' });
      await ok(call, 'run', { until: 'settled' });
      await ok(call, 'key', { keys: ['ENTER'], cps: 1 });
      await ok(call, 'run', { seconds: 3 });
      await ok(call, 'key', { text: '1', cps: 2 });
      await ok(call, 'run', { seconds: 2 });
      await ok(call, 'key', { text: '0', cps: 2 });
      await ok(call, 'run', { seconds: 2 });
      expect(await ok(call, 'screen', {})).toMatch(/SHIPS 4/);

      // A scripted minute: 12 rounds of three keys at 2 a second (1.5 s) and 3.5 s of play.
      for (let i = 0; i < 12; i++) {
        await ok(call, 'key', { keys: PLAY[i % PLAY.length], cps: 2 });
        await ok(call, 'run', { seconds: 3.5 });
      }

      // suggest: the routines worth naming. Several write video RAM (the shape drawer, the
      // title frame copy, the text printer); 6140h is among them.
      const suggested = await ok(call, 'suggest', { minCalls: 5 });
      const rows = suggested.split('\n').slice(2).map((l) => {
        const [addr, calls, sites, ...notes] = l.trim().split(/\s{2,}/);
        return { addr, calls: Number(calls.replaceAll(',', '')), sites: Number(sites), notes: notes.join(' ') };
      });
      const drawers = rows.filter((r) => r.notes.includes('writes video RAM'));
      expect(drawers.length).toBeGreaterThanOrEqual(1);
      expect(drawers.map((r) => r.addr)).toContain('6140h');
      for (const r of drawers) expect(r.calls).toBeGreaterThanOrEqual(5);

      // Which one prints text: watch the screen line that holds text now, and see which routine
      // writes it and what it writes. Sea Dragon is back at its title after the minute (the
      // sub is lost), where "Hit <ENTER> to Begin" blinks on its own line.
      const screen = (await ok(call, 'screen', {})).split('\n').slice(3, 19);
      const row = screen.findIndex((l) => /Hit <ENTER>/.test(l));
      expect(row).toBeGreaterThanOrEqual(0);
      const lineAddr = (0x3c00 + row * 64).toString(16).toUpperCase();
      expect(await ok(call, 'watch', { addr: lineAddr, len: 64 })).toMatch(/^watch #1 on /);
      await ok(call, 'run', { seconds: 1 });
      const hits = await ok(call, 'hits', { n: 20 });
      const byPc = hits.split('\n').find((l) => l.startsWith('By pc: '));
      expect(byPc).toMatch(/^By pc: 6141h ×\d+ \(in the routine called at 6140h\)$/);
      // What it wrote is text: the hit rows' values are printable ASCII.
      const values = hits
        .split('\n')
        .filter((l) => /^ *[\d,]+  6141h /.test(l))
        .map((l) => parseInt(l.trim().split(/\s+/)[3], 16));
      expect(values.length).toBeGreaterThan(0);
      for (const v of values) expect(v >= 0x20 && v <= 0x7e, `value ${v.toString(16)}`).toBe(true);
      await ok(call, 'unwatch', { id: 1 });

      // Its callers and its code agree: a counted loop (DJNZ) storing (HL) at (DE).
      expect(await ok(call, 'callers', { addr: '6140' })).toMatch(/^Control reached 6140h from \d+ places/);
      const code = await ok(call, 'disasm', { addr: '6140', n: 11 });
      expect(code.split('\n')[0]).toBe('* 6140  7E           LD A,(HL)');
      expect(code).toMatch(/^\* 614C  10 F2        DJNZ 6140H$/m);

      // Label it, through the tool, with a note; the sidecar is written at once.
      const note = 'prints B characters from HL at DE (the screen)';
      expect(await ok(call, 'label', { addr: '6140', name: 'PRINT', note })).toBe(`Labelled 6140h PRINT (code).\nWrote ${sidecar}.`);
      expect(await ok(call, 'suggest', { minCalls: 5 })).not.toMatch(/^6140h /m);
      expect((await ok(call, 'disasm', { addr: 'PRINT', n: 1 })).split('\n').slice(0, 2)).toEqual(['PRINT:', '* 6140  7E           LD A,(HL)']);

      // coverage export, to the sidecar.
      expect((await ok(call, 'coverage', { mode: 'export' })).split('\n')[0]).toMatch(new RegExp(`^Wrote ${sidecar.replace(/[.$]/g, '\\$&')}: \\d+ labels, 1 session$`));
      await close();

      // Fugløy's disassembler reads the exported file and shows the label, its note, and the calls.
      const { file, errors } = parseLabelFile(readFileSync(sidecar, 'utf8'));
      expect(errors).toEqual([]);
      expect(file.labels.find((l) => l.addr === 0x6140)).toMatchObject({ name: 'PRINT', kind: 'code', source: 'user', note });
      const base = openProgram(new Uint8Array(readFileSync(program)), { name: 'seadrg01.cmd' });
      const listing = renderSession(withLabelFile(withHintText(base, relocationHints(), 'seadrg01.hints'), file, 'seadrg01.fugloy.json'), 'listing');
      expect(listing).toMatch(/^PRINT:/m);
      expect(listing).toContain(`; ${note}`);
      expect(listing).toMatch(/CALL +PRINT/);
      expect(listing).not.toMatch(/PRINT_TEXT/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
