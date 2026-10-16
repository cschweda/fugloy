import { describe, expect, it } from 'vitest';
import { runZexGroup, ZEX_TIMEOUT, zexBinary, zexGroups } from '../zex.js';

// ZEXDOC checks the documented flags. The full run takes about 7 minutes, so it waits for FUGLOY_ZEX=1.
const program = process.env.FUGLOY_ZEX === '1' ? zexBinary('zexdoc.com') : null;
const groups = program === null ? [] : zexGroups(program);

describe.skipIf(program === null)('ZEXDOC, group by group (FUGLOY_ZEX=1)', { timeout: ZEX_TIMEOUT }, () => {
  it('has 67 groups', () => {
    expect(groups).toHaveLength(67);
  });

  for (const [i, { name }] of groups.entries()) {
    it(`${String(i + 1).padStart(2, '0')} ${name}`, () => {
      expect(runZexGroup(program, i)).toMatch(/ {2}OK$/);
    });
  }
});
