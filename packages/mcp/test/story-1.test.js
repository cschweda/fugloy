/**
 * MCP spec §13, story 1 ("find the print routine") on the synthetic RAIDERS program and the
 * synthetic ROM, replayed through the protocol and byte-compared with the committed transcript
 * test/golden/story-01.txt. Only a synthetic session may be committed (no ROM text in it).
 *
 * To rewrite the transcript after a deliberate change to a tool's output, run
 * `FUGLOY_UPDATE_GOLDEN=1 pnpm vitest run packages/mcp/test/story-1.test.js` and review the diff.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RAIDERS, connect, syntheticRom, testConfig } from './helpers.js';

const GOLDEN = fileURLToPath(new URL('./golden/story-01.txt', import.meta.url));

let dir;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'fugloy-mcp-story-1-'));
  writeFileSync(join(dir, 'synthetic.rom'), syntheticRom());
  writeFileSync(join(dir, 'raiders.cmd'), RAIDERS);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('story 1', () => {
  it('story 1 on a synthetic print routine', async () => {
    const { call, close } = await connect({ config: testConfig({ roms: { model3: join(dir, 'synthetic.rom') } }) });
    const script = [
      ['load', { path: join(dir, 'raiders.cmd') }],
      ['run', { until: 'screen' }],
      ['watch', { addr: '3C00', len: 1024 }],
      ['key', { keys: ['ENTER'] }],
      ['hits', { n: 10 }],
      ['callers', { addr: '7030' }],
      ['disasm', { addr: '7030', n: 8 }],
    ];
    const parts = [];
    /** @type {Record<string, string>} */
    const out = {};
    for (const [name, args] of script) {
      const r = await call(name, args);
      if (r.isError) throw new Error(`${name} failed: ${r.text}`);
      out[name] = r.text;
      parts.push(`> ${name} ${JSON.stringify(args)}\n${r.text}\n`);
    }
    await close();
    const transcript = parts.join('\n').replaceAll(dir, '<dir>');

    // The routine is found: every logged write came from inside it, and three sites call it.
    expect(out.hits).toMatch(/^By pc: 7033h ×17 \(in the routine called at 7030h\)$/m);
    expect(out.callers.split('\n').filter((l) => / call /.test(l))).toEqual(['7009h  call  1', '7019h  call  1', '7022h  call  1']);
    expect(out.disasm.split('\n')[0]).toBe('* 7030  1A           LD A,(DE)');

    if (process.env.FUGLOY_UPDATE_GOLDEN === '1') {
      mkdirSync(join(GOLDEN, '..'), { recursive: true });
      writeFileSync(GOLDEN, transcript);
    }
    if (!existsSync(GOLDEN)) throw new Error(`${GOLDEN} is missing; run with FUGLOY_UPDATE_GOLDEN=1 to write it, then review it.`);
    expect(transcript).toBe(readFileSync(GOLDEN, 'utf8'));
  });
});
