/**
 * Whether the trsjs tests run. They are opt-in: without FUGLOY_TRSJS=1 they skip, so CI (which
 * never fetches trsjs) is unaffected. With it set they run, and a missing or tampered trsjs or a
 * missing ROM fails them with a sentence naming the fix; it never quietly skips them.
 */
import { configuredRom } from '../rom.js';

export const TRSJS_ON = process.env.FUGLOY_TRSJS === '1';

/** The suite-name suffix and skip flag for a trsjs suite. */
export const trsjsSkip = TRSJS_ON ? null : 'set FUGLOY_TRSJS=1 to run';

/**
 * The Model III ROM, or an error: FUGLOY_TRSJS=1 asked for the tests that boot it.
 * @returns {Uint8Array}
 */
export function requireRom() {
  const rom = configuredRom('model3');
  if (rom === null) throw new Error('FUGLOY_TRSJS=1 runs the trsjs tests that boot the Model III ROM, and fugloy.mcp.json names none: add roms.model3 (docs/fugloy-mcp-spec.md §3)');
  return rom;
}
