/**
 * The MCP server's emulated time follows the Model 4's clock switch (emu phase 6b, Task 2): the
 * tools count seconds on `m.clockHz` (execute.js, `clockOf`), which is 4,055,040 Hz while port $EC
 * bit 6 is set and 2,027,520 Hz otherwise. `load { model: 4 }` comes in Task 3; this checks the
 * timing helpers on a Model 4 Machine built directly, on a synthetic ROM.
 */
import { describe, expect, it } from 'vitest';
import { Machine } from '@fugloy/emu';
import { capCycles, clockOf, seconds, settleCycles } from '../src/execute.js';
import { testConfig } from './helpers.js';

describe('MCP timing on the Model 4', () => {
  it('counts emulated seconds on the clock now in force', () => {
    const m = new Machine({ model: 4, roms: { level2: new Uint8Array(0x3800).fill(0x76) } });
    const config = /** @type {any} */ (testConfig());
    expect(clockOf(m)).toBe(2027520);
    expect(seconds(2027520, m)).toBe('1.000 s');
    expect(settleCycles(m)).toBe(1013760);
    expect(capCycles(config, m)).toBe(config.limits.runSecondsEmulated * 2027520);
    m.io.out(0xec, 0x40);
    expect(clockOf(m)).toBe(4055040);
    expect(seconds(2027520, m)).toBe('0.500 s');
    expect(settleCycles(m)).toBe(2027520);
    expect(capCycles(config, m)).toBe(config.limits.runSecondsEmulated * 4055040);
    m.io.out(0xec, 0x00);
    expect(clockOf(m)).toBe(2027520);
  });
});
