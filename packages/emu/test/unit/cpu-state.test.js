import { describe, expect, it } from 'vitest';
import { restoreState, serializeState } from '../../src/debug/state.js';
import { TRS80System } from '../../src/machine/trs80-system.js';

const blank = () => new TRS80System({ romData: new Uint8Array(0x3800) });

describe('CPU state that only the flags show', () => {
  it('a save state keeps MEMPTR', () => {
    const saved = blank();
    saved.cpu.wz = 0x1234;
    const restored = blank();
    restoreState(restored, serializeState(saved));
    expect(restored.cpu.wz).toBe(0x1234);
  });

  it('a save from before emu phase 1, without MEMPTR, restores it as 0', () => {
    const state = serializeState(blank());
    delete state.cpu.wz;
    const restored = blank();
    restored.cpu.wz = 0xbeef;
    restoreState(restored, state);
    expect(restored.cpu.wz).toBe(0);
  });
});
