import { describe, expect, it } from 'vitest';
import { TRS80System } from '../../src/index.js';
import { configuredRom, ROM_TEST_TIMEOUT } from '../rom.js';

const rom = configuredRom('model3');
const screen = (sys) => sys.screenText().join('\n');

/** Runs until `ready()` holds, in steps of `step` T-states; returns the T-state count when it does. */
function runUntil(sys, ready, budget, step = 20_000) {
  const start = sys.cpu.cycles;
  while (!ready()) {
    if (sys.cpu.cycles - start > budget) throw new Error(`not reached within ${budget} T-states:\n${screen(sys)}`);
    sys.runTStates(step);
  }
  return sys.cpu.cycles;
}

/** The cassette BASIC boot, driven by what the screen shows: Cass? ENTER, Memory Size? ENTER, READY. */
function boot(sys) {
  runUntil(sys, () => screen(sys).includes('Cass?'), 4_000_000);
  sys.typeText('\n');
  runUntil(sys, () => screen(sys).includes('Memory Size'), 4_000_000);
  sys.typeText('\n');
  return runUntil(sys, () => sys.screenText().some((line) => line.startsWith('READY')), 8_000_000);
}

describe.skipIf(rom === null)('the Model III ROM from fugloy.mcp.json', { timeout: ROM_TEST_TIMEOUT }, () => {
  it('boots to READY in Node with no DOM stubs', () => {
    expect(globalThis.window).toBeUndefined();
    expect(globalThis.document).toBeUndefined();
    const sys = new TRS80System({ romData: rom });
    boot(sys);
    expect(sys.screenText().some((line) => line.startsWith('READY'))).toBe(true);
  });

  it('boots the same way twice: READY within the same 20,000-T-state step, the same screen', () => {
    const a = new TRS80System({ romData: rom });
    const b = new TRS80System({ romData: rom });
    expect(boot(a)).toBe(boot(b));
    expect(a.screenText()).toEqual(b.screenText());
  });
});
