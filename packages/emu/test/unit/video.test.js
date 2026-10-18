/** The Machine's video device: the text readout of $3C00-$3FFF in 64- and 32-column modes. */
import { describe, expect, it } from 'vitest';
import { Machine, MODE_32COL_BIT } from '../../src/index.js';

const machine = () => new Machine({ roms: { level2: new Uint8Array(0x3800) } });
const put = (m, addr, text) => m.mem.write(addr, [...text].map((c) => c.charCodeAt(0)));

describe('m.video', () => {
  it('reads 16 lines of 64 columns, spaces where video RAM is blank', () => {
    const m = machine();
    m.mem.write(0x3c00, new Uint8Array(0x400).fill(0x20));
    put(m, 0x3c00, 'HELLO');
    put(m, 0x3c00 + 15 * 64 + 59, 'WORLD');
    const t = m.video.text();
    expect(m.video.columns).toBe(64);
    expect(t).toHaveLength(16);
    expect(t.every((l) => l.length === 64)).toBe(true);
    expect(t[0].startsWith('HELLO ')).toBe(true);
    expect(t[15].endsWith('WORLD')).toBe(true);
  });

  it('shows bytes below $20 as +$40 and graphics bytes as a dot', () => {
    const m = machine();
    m.mem.write(0x3c00, [0x01, 0x1f, 0x80, 0xbf, 0xc0, 0xff, 0x41]);
    expect(m.video.text()[0].slice(0, 7)).toBe('A_....A');
  });

  it('matches TRS80System.screenText in 64-column mode', () => {
    const m = machine();
    for (let i = 0; i < 0x400; i++) m.system.memory.videoRam[i] = (i * 7) & 0xff;
    expect(m.video.text()).toEqual(m.system.screenText());
  });

  it('in 32-column mode returns 32-character lines from the even bytes', () => {
    const m = machine();
    m.mem.write(0x3c00, new Uint8Array(0x400).fill(0x20));
    m.mem.write(0x3c00, [0x52, 0x2a, 0x45, 0x2a, 0x41, 0x2a, 0x44, 0x2a, 0x59]); // R*E*A*D*Y
    m.io.out(0xec, MODE_32COL_BIT);
    const t = m.video.text();
    expect(m.video.columns).toBe(32);
    expect(t).toHaveLength(16);
    expect(t.every((l) => l.length === 32)).toBe(true);
    expect(t[0].startsWith('READY')).toBe(true);
    expect(t[0]).not.toContain('*');
  });

  it('raw is a live view of $3C00-$3FFF', () => {
    const m = machine();
    expect(m.video.raw).toHaveLength(0x400);
    m.mem.write(0x3c00, [0x55]);
    expect(m.video.raw[0]).toBe(0x55);
    m.mem.write(0x3fff, [0x66]);
    expect(m.video.raw[0x3ff]).toBe(0x66);
  });
});
