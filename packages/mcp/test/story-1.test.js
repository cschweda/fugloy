/**
 * MCP spec §13, story 1 ("find the print routine") on the synthetic RAIDERS program and the
 * synthetic ROM, replayed through the protocol and byte-compared with the committed transcript
 * test/golden/story-01.txt (the script is in test/stories.js). Only a synthetic session may be
 * committed (no ROM text in it).
 *
 * To rewrite the transcript after a deliberate change to a tool's output, run
 * `FUGLOY_UPDATE_GOLDEN=1 pnpm vitest run packages/mcp/test/story-1.test.js` and review the diff.
 */
import { describe, expect, it } from 'vitest';
import { golden, replay, story } from './stories.js';

describe('story 1', () => {
  it('story 1 on a synthetic print routine', async () => {
    const s = story('01');
    const { transcript, out } = await replay(s);
    const [, , , , hits, callers, disasm] = out;

    // The routine is found: every logged write came from inside it, and three sites call it.
    expect(hits).toMatch(/^By pc: 7033h ×17 \(in the routine called at 7030h\)$/m);
    expect(callers.split('\n').filter((l) => / call /.test(l))).toEqual(['7009h  call  1', '7019h  call  1', '7022h  call  1']);
    expect(disasm.split('\n')[0]).toBe('* 7030  1A           LD A,(DE)');

    expect(transcript).toBe(golden(s, transcript));
  });
});
