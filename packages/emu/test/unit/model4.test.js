/**
 * Emu phase 6b, Task 1: the Model 4's description, its four memory maps behind port $84, and its
 * 64K/128K RAM banking (src/machine/memory.js, Model4Memory, which cites MAME's trs80m3 driver and
 * xtrs). Synthetic ROMs throughout; the real Model 4 ROM, when fugloy.mcp.json names it, adds the
 * recognition and mismatch checks. Review Focus 2 (a map switch moves video and the keyboard, and
 * back), 3 (no 32K bank aliases another), and 5 (a save state in map 3 with a page restores).
 */
import { describe, expect, it } from 'vitest';
import { Machine, ROM_HASHES, clockHz, restoreState, serializeState } from '../../src/index.js';
import { MODEL_4, modelOf, romModelProblem } from '../../src/machine/models.js';
import { configuredRom } from '../rom.js';

/** A 14K ROM with `bytes` at $0000; every other byte $C9 so ROM reads are recognisable. */
function rom14(bytes = [0x76]) {
  const rom = new Uint8Array(0x3800).fill(0xc9);
  rom.set(bytes, 0);
  return rom;
}

const model4 = (opts = {}) => new Machine({ model: 4, roms: { level2: rom14(opts.bytes) }, ...opts });

/** A byte distinct per 32K bank and offset (no two banks agree at any offset). */
const pattern = (bank, off) => ((off * 7 + (off >> 8) * 13 + bank * 0x40) & 0xff);

/** Fill every bank of `m.mem.ram` with `pattern`. */
function fillBanks(m) {
  const ram = m.mem.ram;
  for (let i = 0; i < ram.length; i++) ram[i] = pattern(i >> 15, i & 0x7fff);
}

const peek = (m, a) => m.mem.read(a, 1)[0];
const poke = (m, a, v) => m.mem.write(a, [v]);

describe('the Model 4 description', () => {
  it('is model 4, at the Model III clock in Model III mode, with 128K by default', () => {
    expect(modelOf(4)).toBe(MODEL_4);
    expect(clockHz(4)).toBe(2027520);
    const m = model4();
    expect(m.model).toBe(4);
    expect(m.clockHz).toBe(2027520);
    expect(m.system.io.fdc.cpuHz).toBe(2027520);
    expect(m.mem.ram.length).toBe(128 * 1024);
    expect(model4({ ram: 64 }).mem.ram.length).toBe(64 * 1024);
    expect(m.system.memory.videoRam.length).toBe(0x800);
  });

  it('refuses other RAM sizes and the Model I options in sentences', () => {
    for (const ram of [48, 16, 256, '64']) {
      expect(() => model4({ ram })).toThrow(/^The Model 4 takes ram: 64 or 128 \(K\), not /);
    }
    expect(() => model4({ expansion: true })).toThrow(/^expansion is a Model I option; the Model 4 has no Expansion Interface/);
    expect(() => model4({ lowercase: true })).toThrow(/^lowercase is a Model I option/);
    expect(() => new Machine({ model: 2, roms: { level2: rom14() } })).toThrow(/^model must be 1 \(the Model I\), 3 \(the Model III\), or 4 \(the Model 4\), not 2\.$/);
  });

  it('refuses ROM sizes other than 14K and 16K', () => {
    expect(() => new Machine({ model: 4, roms: { level2: new Uint8Array(0x3000) } })).toThrow(/^Invalid ROM size: 12288 bytes\. Expected 14KB/);
    expect(new Machine({ model: 4, roms: { level2: new Uint8Array(0x4000) } }).model).toBe(4);
  });
});

describe('port $84', () => {
  it('is write-only at $84-$87, and map 0 is the map at power-on and after a reset', () => {
    const m = model4();
    expect(m.system.memory.mapRegister).toBe(0);
    for (const port of [0x84, 0x85, 0x86, 0x87]) {
      m.io.out(port, 0x03);
      expect(m.system.memory.map).toBe(3);
      expect(m.io.in(port)).toBe(0xff);
      m.io.out(port, 0x00);
      expect(m.system.memory.map).toBe(0);
    }
    m.io.out(0x84, 0xb2);
    m.reset();
    expect(m.system.memory.mapRegister).toBe(0);
    expect(peek(m, 0x0001)).toBe(0xc9); // the ROM again
  });

  it('a program in ROM switches to map 3 and writes RAM at $0000-$37FF', () => {
    // LD A,03H / OUT (84H),A / LD A,55H / LD (0100H),A / HALT
    const m = model4({ bytes: [0x3e, 0x03, 0xd3, 0x84, 0x3e, 0x55, 0x32, 0x00, 0x01, 0x76] });
    // Map 3 puts RAM under the program; plant its continuation there (bank 0 at the same offsets).
    m.mem.ram.set([0x3e, 0x03, 0xd3, 0x84, 0x3e, 0x55, 0x32, 0x00, 0x01, 0x76], 0);
    m.run({ until: 'halt' });
    expect(m.system.memory.map).toBe(3);
    expect(m.mem.ram[0x0100]).toBe(0x55);
  });

  it('leaves the Model III without the port', () => {
    const m = new Machine({ model: 3, roms: { level2: rom14() } });
    m.io.out(0x84, 0x03);
    expect(peek(m, 0x0001)).toBe(0xc9);
    expect(m.system.memory.map).toBeUndefined();
  });
});

describe('the memory maps', () => {
  it('map 0: ROM $0000-$37FF (writes lost), keyboard $3800, video $3C00, RAM from $4000 at ram[A]', () => {
    const m = model4();
    expect(peek(m, 0x0000)).toBe(0x76);
    expect(peek(m, 0x37ff)).toBe(0xc9);
    poke(m, 0x1000, 0x12);
    expect(peek(m, 0x1000)).toBe(0xc9);
    expect(m.mem.ram[0x1000]).toBe(0x00);
    expect(peek(m, 0x38ff)).toBe(0x00);
    m.system.keyboard.keyDown('A', 'k');
    expect(peek(m, 0x38ff)).not.toBe(0x00);
    m.system.keyboard.keyUp('k');
    poke(m, 0x3c00, 0x41);
    expect(m.system.memory.videoRam[0]).toBe(0x41);
    poke(m, 0x4000, 0x99);
    poke(m, 0xffff, 0x98);
    expect(m.mem.ram[0x4000]).toBe(0x99);
    expect(m.mem.ram[0xffff]).toBe(0x98);
  });

  it('map 1: RAM in place of the ROM, keyboard and video as map 0', () => {
    const m = model4();
    m.io.out(0x84, 0x01);
    poke(m, 0x0000, 0x11);
    poke(m, 0x37ff, 0x22);
    expect(m.mem.ram[0x0000]).toBe(0x11);
    expect(m.mem.ram[0x37ff]).toBe(0x22);
    expect(peek(m, 0x0000)).toBe(0x11);
    poke(m, 0x3c05, 0x42);
    expect(m.system.memory.videoRam[5]).toBe(0x42);
    m.system.keyboard.keyDown('A', 'k');
    expect(peek(m, 0x38ff)).not.toBe(0x00);
  });

  it('map 2: RAM to $F3FF, keyboard $F400-$F7FF, all 2K of video at $F800-$FFFF', () => {
    const m = model4();
    m.io.out(0x84, 0x02);
    poke(m, 0x3800, 0x31);
    poke(m, 0x3c00, 0x32);
    poke(m, 0xf3ff, 0x33);
    expect(m.mem.ram[0x3800]).toBe(0x31);
    expect(m.mem.ram[0x3c00]).toBe(0x32);
    expect(m.mem.ram[0xf3ff]).toBe(0x33);
    poke(m, 0xf800, 0x43);
    poke(m, 0xffff, 0x44);
    expect(m.system.memory.videoRam[0]).toBe(0x43);
    expect(m.system.memory.videoRam[0x7ff]).toBe(0x44);
    expect(m.mem.ram[0xf800]).toBe(0x00);
    poke(m, 0xf400, 0x55);
    expect(m.mem.ram[0xf400]).toBe(0x00);
    expect(peek(m, 0xf4ff)).toBe(0x00);
    m.system.keyboard.keyDown('A', 'k');
    expect(peek(m, 0xf4ff)).not.toBe(0x00);
  });

  it('map 3: all 64K RAM', () => {
    const m = model4();
    m.io.out(0x84, 0x03);
    for (const a of [0x0000, 0x3800, 0x3c00, 0x4000, 0xf400, 0xf800, 0xffff]) {
      poke(m, a, a >> 8);
      expect(m.mem.ram[a]).toBe(a >> 8);
      expect(peek(m, a)).toBe(a >> 8);
    }
    expect(m.system.memory.videoRam.every((b) => b === 0x20)).toBe(true);
  });

  it('port $84 bit 7 picks which 1K of the 2K video RAM $3C00 shows in maps 0 and 1', () => {
    const m = model4();
    m.io.out(0x84, 0x80);
    poke(m, 0x3c00, 0x50);
    expect(m.system.memory.videoRam[0x400]).toBe(0x50);
    expect(m.system.memory.videoRam[0]).toBe(0x20);
    m.io.out(0x84, 0x81);
    expect(peek(m, 0x3c00)).toBe(0x50);
    m.io.out(0x84, 0x00);
    expect(peek(m, 0x3c00)).toBe(0x20);
    m.io.out(0x84, 0x82); // map 2 shows both halves whatever bit 7 says
    expect(peek(m, 0xfc00)).toBe(0x50);
  });

  it('m.mem.read shows the current map, and the debug view matches it', () => {
    const m = model4();
    fillBanks(m);
    for (const v of [0x00, 0x01, 0x02, 0x03, 0x23, 0x72]) {
      m.io.out(0x84, v);
      const view = m.system.memory.getMemoryView();
      const read = m.mem.read(0, 0x10000);
      // The keyboard reads idle (0) in both, nothing held.
      expect(Buffer.from(view).equals(Buffer.from(read))).toBe(true);
    }
  });
});

describe('Review Focus 2: a switch to map 2 or 3 moves video and the keyboard, and back restores them', () => {
  it('no stale bytes: $3C00 is RAM in maps 2-3, video again in map 0; the keyboard leaves $3800', () => {
    for (const map of [2, 3]) {
      const m = model4();
      fillBanks(m);
      poke(m, 0x3c00, 0x41); // video, map 0
      m.system.keyboard.keyDown('A', 'k');
      const held = peek(m, 0x38ff);
      expect(held).not.toBe(0);
      m.io.out(0x84, map);
      expect(peek(m, 0x3c00)).toBe(pattern(0, 0x3c00));
      expect(peek(m, 0x38ff)).toBe(pattern(0, 0x38ff));
      poke(m, 0x3c00, 0x77); // RAM, not video
      expect(m.system.memory.videoRam[0]).toBe(0x41);
      if (map === 2) {
        expect(peek(m, 0xf800)).toBe(0x41);
        poke(m, 0xf801, 0x42);
        expect(peek(m, 0xf4ff)).toBe(held);
      } else {
        expect(peek(m, 0xf800)).toBe(pattern(1, 0x7800));
        expect(peek(m, 0xf4ff)).toBe(pattern(1, 0x74ff));
      }
      m.io.out(0x84, 0x00);
      expect(peek(m, 0x3c00)).toBe(0x41);
      expect(peek(m, 0x3c01)).toBe(map === 2 ? 0x42 : 0x20);
      expect(peek(m, 0x38ff)).toBe(held);
      expect(m.mem.ram[0x3c00]).toBe(0x77);
    }
  });
});

describe('Review Focus 3: the 128K page select aliases no bank', () => {
  // MAME trs80m3_m.cpp, machine_start, 128K: (port $84 >> 4) & 7 picks the banks seen at
  // $0000-$7FFF (entries 6, 7: banks 2, 3; else 0) and $8000-$FFFF (entries 2, 3: banks 2, 3; else 1).
  const LOW = [0, 0, 0, 0, 0, 0, 2, 3];
  const HIGH = [1, 1, 2, 3, 1, 1, 1, 1];
  /** Whether CPU address `a` is RAM in `map`. */
  const isRam = (map, a) => (map === 3 ? true : map === 2 ? a < 0xf400 : map === 1 ? a < 0x3800 || a >= 0x4000 : a >= 0x4000);

  it('reads every bank back through every map and page, at every RAM address', () => {
    const m = model4();
    fillBanks(m);
    for (let map = 0; map < 4; map++) {
      for (let page = 0; page < 8; page++) {
        m.io.out(0x84, (page << 4) | map);
        const read = m.mem.read(0, 0x10000);
        let bad = 0;
        for (let a = 0; a < 0x10000; a++) {
          if (!isRam(map, a)) continue;
          const bank = a < 0x8000 ? LOW[page] : HIGH[page];
          if (read[a] !== pattern(bank, a & 0x7fff)) bad++;
        }
        expect(bad, `map ${map}, page ${page}`).toBe(0);
      }
    }
  });

  it('a write through a page lands in that bank only', () => {
    for (let page = 0; page < 8; page++) {
      for (const a of [0x0123, 0x4567, 0x89ab, 0xf3ff]) {
        const m = model4();
        fillBanks(m);
        const before = m.mem.ram.slice();
        m.io.out(0x84, (page << 4) | 0x03);
        poke(m, a, 0xee);
        const bank = a < 0x8000 ? LOW[page] : HIGH[page];
        const at = bank * 0x8000 + (a & 0x7fff);
        expect(m.mem.ram[at]).toBe(0xee);
        before[at] = 0xee;
        expect(Buffer.from(m.mem.ram).equals(Buffer.from(before))).toBe(true);
      }
    }
  });

  it('with 64K the page bits do nothing', () => {
    const m = model4({ ram: 64 });
    fillBanks(m);
    for (let page = 0; page < 8; page++) {
      m.io.out(0x84, (page << 4) | 0x03);
      expect(m.system.memory.page).toBe(0);
      const read = m.mem.read(0, 0x10000);
      expect(Buffer.from(read).equals(Buffer.from(m.mem.ram))).toBe(true);
    }
  });
});

describe('Review Focus 5: save states', () => {
  it('a state taken in map 3 with a page selected restores exactly', () => {
    const m = model4();
    fillBanks(m);
    m.io.out(0x84, 0x80);
    poke(m, 0x3c10, 0x61);
    m.io.out(0x84, 0xb3); // video page 1, page select bank 3 at $8000, map 3
    poke(m, 0x9000, 0xab);
    const state = JSON.parse(JSON.stringify(serializeState(m.system)));
    expect(state.machine).toBe('trs80-model4');
    expect(state.memory.map).toBe(0xb3);

    const n = model4();
    restoreState(n.system, state);
    expect(n.system.memory.mapRegister).toBe(0xb3);
    expect(n.system.memory.map).toBe(3);
    expect(Buffer.from(n.mem.ram).equals(Buffer.from(m.mem.ram))).toBe(true);
    expect(Buffer.from(n.system.memory.videoRam).equals(Buffer.from(m.system.memory.videoRam))).toBe(true);
    expect(Buffer.from(n.mem.read(0, 0x10000)).equals(Buffer.from(m.mem.read(0, 0x10000)))).toBe(true);
    expect(peek(n, 0x9000)).toBe(0xab);
    expect(n.mem.ram[3 * 0x8000 + 0x1000]).toBe(0xab);
    n.io.out(0x84, 0x80);
    expect(peek(n, 0x3c10)).toBe(0x61);
  });

  it('refuses a state from another RAM size or another model', () => {
    const state = serializeState(model4().system);
    expect(() => restoreState(model4({ ram: 64 }).system, state)).toThrow(/has 128K of RAM; the machine has 64K/);
    const m3 = new Machine({ model: 3, roms: { level2: rom14() } });
    expect(() => restoreState(m3.system, state)).toThrow(/^Not a TRS-80 Model III save state$/);
    expect(() => restoreState(model4().system, serializeState(m3.system))).toThrow(/^This is a Model III save state; the machine is a Model 4/);
  });

  it('leaves the Model III state without a map register', () => {
    const m3 = new Machine({ model: 3, roms: { level2: rom14() } });
    expect(Object.hasOwn(serializeState(m3.system).memory, 'map')).toBe(false);
  });
});

describe('the Model 4 ROM', () => {
  it('is in ROM_HASHES and belongs to the Model 4 alone', () => {
    expect(ROM_HASHES['89ab093f1b4234b8265122ecd4f45d7cda5c1a0b26ec929bce32c1756e826133']).toBe('model4-trs32');
    expect(romModelProblem('model4-trs32', 4)).toBeNull();
    expect(romModelProblem('model4-trs32', 3)).toBe('This ROM is the Model 4 ROM (model4-trs32); it runs on the Model 4, not the Model III: construct the Machine with model: 4.');
    expect(romModelProblem('model4-trs32', 1)).toMatch(/^This ROM is the Model 4 ROM \(model4-trs32\); it runs on the Model 4, not the Model I:/);
    expect(romModelProblem('model3-rev-c-2ef8', 4)).toMatch(/^This ROM is the Model III ROM \(model3-rev-c-2ef8\); it runs on the Model III, not the Model 4: construct the Machine with model: 3\.$/);
  });

  const level2 = configuredRom('model4-trs32');
  it.skipIf(level2 === null)('the real Model 4 ROM is recognised on the Model 4 and refused as a Model III', () => {
    const m = new Machine({ model: 4, roms: { level2 } });
    expect(m.rom.recognized).toBe('model4-trs32');
    expect(m.rom.bytes).toBe(0x3800);
    expect(() => new Machine({ model: 3, roms: { level2 } })).toThrow(/^This ROM is the Model 4 ROM \(model4-trs32\); it runs on the Model 4, not the Model III: construct the Machine with model: 4\.$/);
  });
});
