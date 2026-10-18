/**
 * The golden transcripts (MCP spec §10): story 3, coverage separating code from data on the
 * synthetic TABLER program, byte-compared with test/golden/story-03.txt; and determinism, every
 * golden story replayed twice on fresh servers, the two transcripts identical to each other and
 * to the committed one, cycle counts included. Stories 1 and 2 have their own property checks in
 * story-1.test.js and phase-d-snapshots.test.js; the scripts are in test/stories.js.
 *
 * To rewrite the transcripts after a deliberate change to a tool's output, run
 * `FUGLOY_UPDATE_GOLDEN=1 pnpm vitest run packages/mcp/test/golden.test.js` and review the diff.
 */
import { describe, expect, it } from 'vitest';
import { STORIES, golden, replay, story } from './stories.js';

describe('story 3', () => {
  it('story 3: coverage separates code from data on a synthetic program', async () => {
    const s = story('03');
    const { transcript, out } = await replay(s);
    const [, , summary, ranges, disasmCode, disasmNever, , , , exported, after] = out;

    // 82 loaded bytes: 28 executed (the skipped CALL's three bytes are not), 10 data (TABLE, FLAG, and the byte stored at 7051h), the rest never seen.
    expect(summary.split('\n').slice(0, 5)).toEqual([
      'Coverage since load (this session):',
      'Loaded: 82 bytes in 1 block (7000h–7051h)',
      'Executed: 28 bytes (34.1%) in 2 code ranges',
      'Data: 10 bytes read or written and never executed, in 2 data ranges',
      'Never seen: 44 bytes',
    ]);
    expect(ranges.split('\n')).toEqual([
      'Ranges in the loaded blocks (7):',
      'start  end    bytes  kind',
      '7000h  7016h     23  code',
      '7017h  7019h      3  never seen',
      '701Ah  701Eh      5  code',
      '701Fh  703Fh     33  never seen',
      '7040h  7047h      8  data',
      '7048h  704Fh      8  never seen',
      '7050h  7051h      2  data',
    ]);
    // disasm marks the skipped CALL and the routine it would reach as never seen.
    expect(disasmCode.split('\n').find((l) => l.includes('CALL'))).toMatch(/^\? 7017  CD 30 70 /);
    expect(disasmNever.split('\n')[0]).toMatch(/^\? 7030 /);
    expect(exported).toMatch(/^Wrote <dir>\/tabler\.fugloy\.json: 3 labels, 1 session$/m);
    expect(after).toContain('Sidecar: <dir>/tabler.fugloy.json, 1 recorded session');

    expect(transcript).toBe(golden(s, transcript));
  });
});

describe('determinism', () => {
  for (const s of STORIES) {
    it(`story ${s.id} replays byte for byte`, async () => {
      const first = await replay(s);
      const second = await replay(s);
      expect(second.transcript).toBe(first.transcript);
      expect(first.transcript).toBe(golden(s, first.transcript));
    });
  }
});
