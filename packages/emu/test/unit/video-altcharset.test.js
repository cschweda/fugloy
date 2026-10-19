/**
 * Phase 5D, Task 1: `m.video.altCharset`, the Model III's alternate character set (port $EC bit 3,
 * ENALTSET), on synthetic ROMs. Always false on the Model I.
 */
import { describe, expect, it } from 'vitest';
import { Machine } from '../../src/index.js';

/** LD A,<value> / OUT (ECH),A / HALT */
const outEc = (value) => [0x3e, value, 0xd3, 0xec, 0x76];

const model3 = (bytes) => {
  const rom = new Uint8Array(0x3800);
  rom.set(bytes, 0);
  return new Machine({ roms: { level2: rom } });
};
const model1 = (bytes) => {
  const rom = new Uint8Array(0x3000);
  rom.set(bytes, 0);
  return new Machine({ model: 1, roms: { level2: rom } });
};

describe('m.video.altCharset', () => {
  it('is false at reset, true once port $EC bit 3 is set, false when cleared (Model III)', () => {
    const m = model3(outEc(0x08));
    expect(m.video.altCharset).toBe(false);
    m.run({ until: 'halt' });
    expect(m.video.altCharset).toBe(true);
    const off = model3(outEc(0x00));
    off.run({ until: 'halt' });
    expect(off.video.altCharset).toBe(false);
  });

  it('ignores the other mode bits', () => {
    const m = model3(outEc(0x04));
    m.run({ until: 'halt' });
    expect(m.video.altCharset).toBe(false);
  });

  it('is always false on the Model I', () => {
    const m = model1(outEc(0x08));
    m.run({ until: 'halt' });
    expect(m.video.altCharset).toBe(false);
  });
});
