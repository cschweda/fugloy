/**
 * Spec §4's target, ≥ 20× real time, with debugging off and with coverage and a 10,000-deep trace
 * on: scripts/benchmark.mjs runs Sea Dragon on the Model III ROM from fugloy.mcp.json, each mode in
 * its own process. Debugging off measured about 42× on the laptop that built phase 3 (the phase 2
 * figure was about 43×, and phase 3 promised to keep it ≥ 40×); that figure is reported in the
 * README, not asserted, since a timing assertion near the measured value fails on a busy machine.
 *
 * The full suite runs its files in parallel, and with the other ROM tests running beside it a
 * measurement can fall well under the figure the same run gives alone (13× once, against 30×
 * alone; 12-15× against 40× in emu phase 6). So the test is opt-in: it runs only with
 * FUGLOY_BENCH=1, best by itself (`FUGLOY_BENCH=1 pnpm exec vitest run
 * packages/emu/test/integration/benchmark.test.js`, which `./publish.sh check` runs after the
 * suite), or use `node packages/emu/scripts/benchmark.mjs`. Each mode is measured up to five
 * times, two seconds apart, and the best counts: a Machine that can run at 20× shows it once the
 * machine is quiet; one that cannot never does.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { configuredRom } from '../rom.js';

const script = fileURLToPath(new URL('../../scripts/benchmark.mjs', import.meta.url));
const TARGET = 20;
const measure = (mode) => JSON.parse(execFileSync(process.execPath, [script, mode], { encoding: 'utf8' })).ratio;

/** The best of up to `tries` measurements, stopping at the first that reaches the target. */
async function best(mode, tries = 5) {
  const seen = [];
  for (let k = 0; k < tries; k++) {
    if (k > 0) await new Promise((done) => setTimeout(done, 2000));
    seen.push(measure(mode));
    if (seen.at(-1) >= TARGET) break;
  }
  return { ratio: Math.max(...seen), seen };
}

const optedIn = process.env.FUGLOY_BENCH === '1';

describe.skipIf(!optedIn || configuredRom('model3') === null)('Sea Dragon speed on the Model III ROM', { timeout: 60_000 }, () => {
  it.each(['off', 'debug'])('debugging %s runs at least 20× real time', async (mode) => {
    const { ratio, seen } = await best(mode);
    expect(ratio, `measured ${seen.join('×, ')}×`).toBeGreaterThanOrEqual(TARGET);
  });
});
