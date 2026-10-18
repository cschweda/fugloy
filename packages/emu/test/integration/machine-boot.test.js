import { describe, expect, it } from 'vitest';
import { Machine } from '../../src/index.js';
import { configuredRom, ROM_TEST_TIMEOUT } from '../rom.js';

const rom = configuredRom('model3');

describe.skipIf(rom === null)('Machine on the Model III ROM from fugloy.mcp.json', { timeout: ROM_TEST_TIMEOUT }, () => {
  it('recognizes the ROM and runs it to the Cass? prompt', () => {
    const m = new Machine({ roms: { level2: rom } });
    expect(m.rom.recognized).not.toBeNull();
    // The screen is read every 20,000 T-states, not at every instruction, to keep the test quick.
    let next = 0;
    const cass = (mm) => {
      if (mm.cycles < next) return false;
      next = mm.cycles + 20_000;
      return mm.system.screenText().join('\n').includes('Cass?');
    };
    const r = m.run({ cycles: 4_000_000, until: cass });
    expect(r.reason).toBe('predicate');
  });
});
