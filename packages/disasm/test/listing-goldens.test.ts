/**
 * The text listings match the goldens captured before the row refactor.
 * `FUGLOY_WRITE_GOLDENS=1 pnpm vitest run packages/disasm/test/listing-goldens.test.ts`
 * rewrites them; only do that for a change that means to alter the listing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderBasListing, renderPass1Listing } from '../src/listing.js';
import { renderSession } from '../src/session.js';
import { GOLDEN_DIR, goldenCases, goldenPath } from './goldens.js';
import type { GoldenCase } from './goldens.js';

const write = process.env['FUGLOY_WRITE_GOLDENS'] === '1';
const render = (c: GoldenCase): string => (c.kind === 'pass1' ? renderPass1Listing(c.analysis, c.opts) : renderBasListing(c.prog, c.opts));

describe('listing goldens', () => {
  if (write) mkdirSync(GOLDEN_DIR, { recursive: true });
  for (const c of goldenCases()) {
    it(c.name, () => {
      const text = render(c);
      if (write) writeFileSync(goldenPath(c), text);
      expect(existsSync(goldenPath(c)), `missing golden ${c.name}; run with FUGLOY_WRITE_GOLDENS=1`).toBe(true);
      expect(text).toBe(readFileSync(goldenPath(c), 'utf8'));
      // The case the CLI prints is the one renderSession gives.
      if (c.session !== undefined) expect(renderSession(c.session, 'listing')).toBe(text);
    });
  }
});
