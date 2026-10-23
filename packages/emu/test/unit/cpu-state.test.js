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

  it('a save state keeps a lone prefix pending', () => {
    const saved = blank();
    saved.cpu.afterPrefix = true;
    const restored = blank();
    restoreState(restored, serializeState(saved));
    expect(restored.cpu.afterPrefix).toBe(true);
  });

  it('a save from before emu phase 1 restores with no prefix pending', () => {
    const state = serializeState(blank());
    delete state.cpu.afterPrefix;
    const restored = blank();
    restored.cpu.afterPrefix = true;
    restoreState(restored, state);
    expect(restored.cpu.afterPrefix).toBe(false);
  });

  it('a save state keeps whether the last instruction wrote the flags (SCF and CCF read it)', () => {
    const saved = blank();
    saved.cpu.flagsWritten = false;
    const restored = blank();
    restored.cpu.flagsWritten = true;
    restoreState(restored, serializeState(saved));
    expect(restored.cpu.flagsWritten).toBe(false);
  });

  it('a save from before emu phase 7 restores the flags as written, so SCF and CCF take A\'s bits alone, as they did', () => {
    const state = serializeState(blank());
    delete state.cpu.flagsWritten;
    const restored = blank();
    restored.cpu.flagsWritten = false;
    restoreState(restored, state);
    expect(restored.cpu.flagsWritten).toBe(true);
  });
});
