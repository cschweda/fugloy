/**
 * Whether the reference tests run. They are opt-in: without FUGLOY_TRSJS=1 (trsjs, the Model III)
 * or FUGLOY_XTRS=1 (xtrs, the Model I) they skip, so CI (which never fetches or builds either) is
 * unaffected. With the flag set they run, and a missing or tampered reference or a missing ROM
 * fails them with a sentence naming the fix; it never quietly skips them.
 */
import { configuredRom } from '../rom.js';

export const TRSJS_ON = process.env.FUGLOY_TRSJS === '1';
export const XTRS_ON = process.env.FUGLOY_XTRS === '1';

/** The suite-name suffix and skip flag for a trsjs suite. */
export const trsjsSkip = TRSJS_ON ? null : 'set FUGLOY_TRSJS=1 to run';

/** The suite-name suffix and skip flag for an xtrs suite. */
export const xtrsSkip = XTRS_ON ? null : 'set FUGLOY_XTRS=1 to run';

/** Which flag asks for the tests that boot each model's ROM, and which reference they run. */
const FOR_MODEL = {
  model3: { flag: 'FUGLOY_TRSJS=1', reference: 'trsjs', name: 'Model III' },
  model1: { flag: 'FUGLOY_XTRS=1', reference: 'xtrs', name: 'Model I' },
};

/**
 * The model's ROM (`roms.model3` by default, or `roms.model1`), or an error: the flag asked for
 * the tests that boot it.
 * @param {'model3' | 'model1'} [model]
 * @returns {Uint8Array}
 */
export function requireRom(model = 'model3') {
  const m = FOR_MODEL[model];
  if (m === undefined) throw new Error(`requireRom: no reference tests boot ${model}`);
  const rom = configuredRom(model);
  if (rom === null) throw new Error(`${m.flag} runs the ${m.reference} tests that boot the ${m.name} ROM, and fugloy.mcp.json names none: add roms.${model} (docs/fugloy-mcp-spec.md §3)`);
  return rom;
}
