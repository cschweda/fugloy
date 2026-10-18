/**
 * Emu phase 6b, Task 2, on the real Model 4 ROM (roms.model4 in fugloy.mcp.json; skipped without
 * it): the ROM boots to Model III BASIC's READY in map 0 at 2 MHz, and (Review Focus 1, with
 * roms.model3 too) a Model 4 left in Model III mode runs Sea Dragon as the Model III does: the same
 * screens at every quarter second and the same T-states from READY on. The two ROMs differ in 727
 * bytes, and the boot to READY takes a few T-states more or less on each; nothing after it differs.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CPU_CLOCK_HZ, Machine } from '../../src/index.js';
import { configuredRom, ROM_TEST_TIMEOUT } from '../rom.js';
import { screen, waitFor } from './boot-helpers.js';
import { GAME_START, PROMPT, SEA_DRAGON_CMD, TITLE } from './sea-dragon-session.js';

const rom4 = configuredRom('model4');
const rom3 = configuredRom('model3');

/** A machine at READY: ENTER at Cass? (the Model 4 ROM shows "Cass ?") and at Memory Size?. */
function bootToReady(model, rom) {
  const m = new Machine({ model, roms: { level2: rom } });
  waitFor(m, 'Cass', 2);
  m.keyboard.type('\n');
  waitFor(m, 'Memory Size?', 2);
  m.keyboard.type('\n');
  waitFor(m, 'READY', 2);
  m.run({ cycles: CPU_CLOCK_HZ / 4 });
  return m;
}

describe.skipIf(rom4 === null)('the Model 4 ROM in Model III mode', { timeout: ROM_TEST_TIMEOUT }, () => {
  it('boots to Model III BASIC READY in map 0, at 2 MHz, 64 columns by 16', () => {
    const m = bootToReady(4, /** @type {Uint8Array} */ (rom4));
    expect(m.rom.recognized).toBe('model4-trs32');
    const text = screen(m);
    expect(text).toContain('Radio Shack Model III Basic');
    expect(text).toMatch(/READY *\n>/);
    expect(m.system.memory.map).toBe(0);
    expect(m.clockHz).toBe(2027520);
    expect(m.video.columns).toBe(64);
    expect(m.video.rows).toBe(16);
  });
});

describe.skipIf(rom4 === null || rom3 === null)('Sea Dragon on the Model 4 in Model III mode (Review Focus 1)', { timeout: ROM_TEST_TIMEOUT }, () => {
  it('shows the Model III\'s screens and takes its T-states, from READY to "1 or 2 Players?"', () => {
    const cmd = new Uint8Array(readFileSync(SEA_DRAGON_CMD));
    const machines = [bootToReady(3, /** @type {Uint8Array} */ (rom3)), bootToReady(4, /** @type {Uint8Array} */ (rom4))];
    const ready = machines.map((m) => m.cycles);
    // The ROMs' own difference: a few T-states in the boot.
    expect(Math.abs(ready[0] - ready[1])).toBeLessThan(1000);
    const since = () => machines.map((m, k) => m.cycles - ready[k]);
    for (const m of machines) {
      m.load.cmd(cmd);
      const id = m.debug.break(GAME_START, { once: true });
      expect(m.run({ cycles: CPU_CLOCK_HZ })).toMatchObject({ reason: 'break', id });
    }
    expect(since()[1]).toBe(since()[0]);
    let sawTitle = false;
    for (let k = 0; k < 40; k++) {
      for (const m of machines) m.run({ cycles: CPU_CLOCK_HZ / 4 });
      if (k === 20) for (const m of machines) m.keyboard.type('\n', { cps: 1 });
      expect(screen(machines[1])).toBe(screen(machines[0]));
      expect(since()[1]).toBe(since()[0]);
      if (screen(machines[0]).includes(TITLE)) sawTitle = true;
    }
    expect(sawTitle).toBe(true);
    expect(screen(machines[1])).toContain(PROMPT);
    expect(machines[1].system.memory.map).toBe(0);
    expect(machines[1].clockHz).toBe(2027520);
  });
});
