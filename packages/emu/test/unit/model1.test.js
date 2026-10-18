/**
 * Emu phase 6, Task 1: the machine described by model (src/machine/models.js), the Model I's
 * memory map and RAM sizes, the ROM size and model checks, and the Model III left byte-identical
 * (against fixtures/synthetic/emu/model3-state.json, captured before the refactor). Synthetic
 * ROMs throughout; the real Model I and Model III ROMs, when fugloy.mcp.json names them, add the
 * recognition and mismatch checks. Last, the Task 1 review's fixes: the save-state model sentence,
 * and the committed pre-phase-6 Model III state restoring into a fresh Model III.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CPU_CLOCK_HZ, Machine, ROM_HASHES, clockHz, restoreState, serializeState } from '../../src/index.js';
import { MODELS, romModelProblem } from '../../src/machine/models.js';
import { configuredRom } from '../rom.js';
import { sha256Hex } from '../../src/machine/sha256.js';
import { model3SampleRom, model3SampleText } from './model3-state-sample.js';

/** A 12K Model I ROM with `bytes` at $0000 (and `at` maps more addresses to bytes). */
function rom12(bytes = [0x76], at = {}) {
  const rom = new Uint8Array(0x3000);
  rom.set(bytes, 0);
  for (const [addr, more] of Object.entries(at)) rom.set(more, Number(addr));
  return rom;
}

const model1 = (opts = {}) => new Machine({ model: 1, roms: { level2: rom12(opts.bytes, opts.at) }, ...opts });

describe('model descriptions', () => {
  it('clockHz gives each model its CPU clock, and CPU_CLOCK_HZ stays the Model III\'s', () => {
    expect(clockHz(3)).toBe(2027520);
    expect(clockHz(1)).toBe(1774080);
    expect(CPU_CLOCK_HZ).toBe(clockHz(3));
    expect(() => clockHz(4)).toThrow(/^There is no Model 4 yet/);
  });

  it('m.model names the model built, and the system runs at that model\'s clock', () => {
    const m1 = model1();
    expect(m1.model).toBe(1);
    expect(m1.system.clockHz).toBe(1774080);
    expect(m1.clockHz).toBe(1774080);
    expect(m1.system.io.fdc.cpuHz).toBe(1774080);
    const m3 = new Machine({ roms: { level2: new Uint8Array(0x3800) } });
    expect(m3.model).toBe(3);
    expect(m3.system.clockHz).toBe(2027520);
    expect(m3.clockHz).toBe(2027520);
  });

  it('the Model 4 is refused, naming its own plan', () => {
    expect(() => new Machine({ model: 4, roms: { level2: new Uint8Array(0x3800) } })).toThrow(/^There is no Model 4 yet: /);
    expect(() => new Machine({ model: 2, roms: { level2: new Uint8Array(0x3800) } })).toThrow(/^model must be 1 \(the Model I\) or 3 \(the Model III\), not 2/);
  });
});

describe('RAM sizes', () => {
  it('the Model I takes 4, 16, 32, or 48K, 48 by default, and m.mem.ram is that size', () => {
    expect(model1().mem.ram.length).toBe(48 * 1024);
    for (const ram of [4, 16, 32, 48]) expect(model1({ ram }).mem.ram.length).toBe(ram * 1024);
  });

  it('the Model I refuses other sizes with a sentence', () => {
    for (const ram of [0, 8, 64, 12, '16']) {
      expect(() => model1({ ram })).toThrow(/^The Model I takes ram: 4, 16, 32, or 48 \(K\), not /);
    }
  });

  it('the Model III keeps 48K only, naming a later phase for 16 and 32', () => {
    const level2 = new Uint8Array(0x3800);
    expect(() => new Machine({ model: 3, ram: 16, roms: { level2 } })).toThrow(/^The Model III takes ram: 48 \(K\), not 16; 16K and 32K come in a later phase\.$/);
    expect(() => new Machine({ model: 3, ram: 32, roms: { level2 } })).toThrow(/later phase/);
    expect(() => new Machine({ model: 3, ram: 4, roms: { level2 } })).toThrow(/^The Model III takes ram: 48 \(K\), not 4;/);
    expect(new Machine({ model: 3, ram: 48, roms: { level2 } }).mem.ram.length).toBe(0xc000);
  });

  it('expansion and lowercase are Model I options, checked, and stored on the system', () => {
    const m = model1();
    expect(m.system.expansion).toBe(true);
    expect(m.system.lowercase).toBe(false);
    const n = model1({ expansion: false, lowercase: true });
    expect(n.system.expansion).toBe(false);
    expect(n.system.lowercase).toBe(true);
    expect(() => model1({ expansion: 'yes' })).toThrow(/^expansion must be true or false/);
    expect(() => model1({ lowercase: 1 })).toThrow(/^lowercase must be true or false/);
    const level2 = new Uint8Array(0x3800);
    expect(() => new Machine({ model: 3, expansion: true, roms: { level2 } })).toThrow(/^expansion is a Model I option/);
    expect(() => new Machine({ model: 3, lowercase: true, roms: { level2 } })).toThrow(/^lowercase is a Model I option/);
  });
});

describe('ROM size', () => {
  it('the Model I takes a 12K ROM and refuses 14K and 16K images', () => {
    expect(() => model1()).not.toThrow();
    expect(() => new Machine({ model: 1, roms: { level2: new Uint8Array(0x3800) } })).toThrow(/^Invalid ROM size: 14336 bytes\. The Model I's Level II ROM is 12KB \(0x3000\)/);
    expect(() => new Machine({ model: 1, roms: { level2: new Uint8Array(0x4000) } })).toThrow(/^Invalid ROM size: 16384 bytes/);
  });

  it('the Model III refuses a 12K image, as before', () => {
    expect(() => new Machine({ roms: { level2: new Uint8Array(0x3000) } })).toThrow(/^Invalid ROM size: 12288 bytes\. Expected 14KB \(0x3800\) or a 16KB \(0x4000\) padded image/);
  });
});

describe('the Model I memory map', () => {
  it('$0000-$2FFF is the 12K ROM, and writes there are ignored', () => {
    const m = model1({ bytes: [0x76, 0x12], at: { 0x2fff: [0xab] } });
    expect([...m.mem.read(0, 2)]).toEqual([0x76, 0x12]);
    expect(m.mem.read(0x2fff, 1)[0]).toBe(0xab);
    m.mem.write(0x0001, [0x99]);
    m.mem.write(0x2fff, [0x99]);
    expect(m.mem.read(0x0001, 1)[0]).toBe(0x12);
    expect(m.mem.read(0x2fff, 1)[0]).toBe(0xab);
  });

  it('$3000-$37DF holds nothing: reads float to $FF and writes are ignored', () => {
    const m = model1();
    for (const addr of [0x3000, 0x3123, 0x3400, 0x37df]) {
      m.mem.write(addr, [0x00]);
      expect(m.mem.read(addr, 1)[0]).toBe(0xff);
    }
  });

  it('$3800-$3BFF is the keyboard matrix, read-only', () => {
    const m = model1();
    expect(m.mem.read(0x3801, 1)[0]).toBe(0x00);
    m.keyboard.press('A');
    expect(m.mem.read(0x3801, 1)[0]).toBe(0x02); // row 0 ($3801): @ A B ...; A is bit 1
    m.mem.write(0x3801, [0xff]);
    m.keyboard.release('A');
    expect(m.mem.read(0x3801, 1)[0]).toBe(0x00);
  });

  it('$3C00-$3FFF is video RAM, read through m.video.raw', () => {
    const m = model1();
    m.mem.write(0x3c00, [0x20, 0x41]);
    m.mem.write(0x3fff, [0x5a]);
    expect([...m.mem.read(0x3c00, 2)]).toEqual([0x20, 0x41]);
    expect(m.video.raw[0x3ff]).toBe(0x5a);
    expect(m.video.text()[0].slice(0, 2)).toBe(' A');
  });

  for (const ram of [4, 16, 32, 48]) {
    it(`with ${ram}K, RAM is $4000-$${(0x3fff + ram * 1024).toString(16).toUpperCase()} and above it reads $FF and ignores writes`, () => {
      const m = model1({ ram });
      const top = 0x4000 + ram * 1024; // one past the last RAM byte
      m.mem.write(0x4000, [0x11]);
      m.mem.write(top - 1, [0x22]);
      expect(m.mem.read(0x4000, 1)[0]).toBe(0x11);
      expect(m.mem.read(top - 1, 1)[0]).toBe(0x22);
      expect(m.mem.ram[0]).toBe(0x11);
      expect(m.mem.ram[ram * 1024 - 1]).toBe(0x22);
      if (top < 0x10000) {
        m.mem.write(top, [0x33]);
        m.mem.write(0xffff, [0x33]);
        expect(m.mem.read(top, 1)[0]).toBe(0xff);
        expect(m.mem.read(0xffff, 1)[0]).toBe(0xff);
      }
    });
  }

  // The Level II ROM's MEMORY SIZE? probe ($00C4-$00D4 in kiwisincebirth MDL1LEV2.Z80): from
  // $434C, complement each byte, compare, restore, until a byte does not hold its complement or
  // HL wraps to 0. Run on a synthetic ROM, it stops at the first address past RAM.
  const PROBE = [
    0x21, 0x4c, 0x43, //  LD HL,434CH
    0x23, //              LOOP: INC HL
    0x7c, 0xb5, //        LD A,H / OR L
    0x28, 0x08, //        JR Z,DONE
    0x7e, 0x47, 0x2f, //  LD A,(HL) / LD B,A / CPL
    0x77, 0xbe, 0x70, //  LD (HL),A / CP (HL) / LD (HL),B
    0x28, 0xf3, //        JR Z,LOOP
    0x76, //              DONE: HALT
  ];
  for (const ram of [4, 16, 32, 48]) {
    it(`the ROM's memory-size probe finds the top of ${ram}K`, () => {
      const m = model1({ ram, bytes: PROBE });
      expect(m.run({ until: 'halt', cycles: 20_000_000 }).reason).toBe('halt');
      expect((m.cpu.regs.h << 8) | m.cpu.regs.l).toBe((0x4000 + ram * 1024) & 0xffff);
    });
  }

  it('the Model III ports are absent: $E0, $EC, $E4, $F0, $F4, and $F8 float to $FF', () => {
    const m = model1();
    m.io.out(0xe0, 0x04);
    m.io.out(0xec, 0x04);
    for (const port of [0xe0, 0xec, 0xe4, 0xf0, 0xf4, 0xf8]) expect(m.io.in(port)).toBe(0xff);
    expect(m.system.io.intMask).toBe(0);
    expect(m.video.columns).toBe(64);
  });

  it('a Model I state says so, restores into a Model I, and is refused by a Model III', () => {
    const m = model1({ ram: 16 });
    m.mem.write(0x4000, [0x5a]);
    const state = serializeState(m.system);
    expect(state.machine).toBe('trs80-model1');
    const n = model1({ ram: 16 });
    restoreState(n.system, state);
    expect(n.mem.read(0x4000, 1)[0]).toBe(0x5a);
    const m3 = new Machine({ roms: { level2: new Uint8Array(0x3800) } });
    expect(() => restoreState(m3.system, state)).toThrow(/^Not a TRS-80 Model III save state/);
    expect(() => restoreState(model1({ ram: 48 }).system, state)).toThrow(/^This Model I save state has 16K of RAM; the machine has 48K/);
  });
});

describe('ROM recognition and the model check', () => {
  it('ROM_HASHES names the Model I Level II ROMs 1.2 and 1.3 and the Model III ROMs', () => {
    expect(ROM_HASHES['3cd3824d2ac2743750d2179951ed812794302b885ccb4f98aa2579b352c4b00e']).toBe('model1-level2-1.2');
    expect(ROM_HASHES['5515d95d7c19058400a2e91c6930bb557035db5ce093bd96fd017f795c346776']).toBe('model1-level2-1.3');
    expect(ROM_HASHES.beeb3741175a8b8706cc384d5b2534ebf32e383662864054e5a0ce4d861a43bb).toBe('model3-rev-c-2ef8');
    for (const name of Object.values(ROM_HASHES)) expect(MODELS[1].roms.includes(name) || MODELS[3].roms.includes(name)).toBe(true);
  });

  it('romModelProblem refuses a recognised ROM given for the other model, with a sentence naming its model', () => {
    expect(romModelProblem('model1-level2-1.3', 3)).toBe('This ROM is the Model I Level II ROM (model1-level2-1.3); it runs on the Model I, not the Model III: construct the Machine with model: 1.');
    expect(romModelProblem('model3-rev-c-2ef8', 1)).toBe('This ROM is the Model III ROM (model3-rev-c-2ef8); it runs on the Model III, not the Model I: construct the Machine with model: 3.');
    expect(romModelProblem('model1-level2-1.2', 1)).toBeNull();
    expect(romModelProblem('model3-rev-c-frehd', 3)).toBeNull();
    expect(romModelProblem(null, 1)).toBeNull();
  });

  const level2Model1 = configuredRom('model1');
  const level2Model3 = configuredRom('model3');

  it.skipIf(level2Model1 === null)('the real Model I ROM is recognised on the Model I and refused as a Model III', () => {
    const m = new Machine({ model: 1, roms: { level2: /** @type {Uint8Array} */ (level2Model1) } });
    expect(m.rom.recognized).toMatch(/^model1-level2-1\.[23]$/);
    expect(m.rom.bytes).toBe(0x3000);
    expect(() => new Machine({ model: 3, roms: { level2: /** @type {Uint8Array} */ (level2Model1) } })).toThrow(/^This ROM is the Model I Level II ROM \(model1-level2-1\.[23]\); it runs on the Model I, not the Model III/);
  });

  it.skipIf(level2Model3 === null)('the real Model III ROM is refused as a Model I', () => {
    expect(() => new Machine({ model: 1, roms: { level2: /** @type {Uint8Array} */ (level2Model3) } })).toThrow(/^This ROM is the Model III ROM \(model3-rev-c-2ef8\); it runs on the Model III, not the Model I/);
  });
});

describe('the Model III is unchanged', () => {
  const FIXTURE = fileURLToPath(new URL('../../../../fixtures/synthetic/emu/model3-state.json', import.meta.url));

  it('the Model III is unchanged', () => {
    const committed = readFileSync(FIXTURE, 'utf8');
    if (committed !== model3SampleText()) {
      throw new Error(`the synthetic Model III session no longer ends in the state committed in ${FIXTURE}; the Model III must stay byte-identical (rewrite the fixture with node packages/emu/scripts/write-model3-state-fixture.mjs only for an intended change to the Model III)`);
    }
  });
});

describe('save states across models (Task 1 review)', () => {
  it('a Model III state restored into a Model I is refused, naming both models', () => {
    const state = serializeState(new Machine({ roms: { level2: new Uint8Array(0x3800) } }).system);
    expect(() => restoreState(model1().system, state)).toThrow(/^This is a Model III save state; the machine is a Model I, and a state restores only into the model that saved it\.$/);
  });

  it('a Model I state restored into a Model III keeps the Model III sentence', () => {
    const state = serializeState(model1().system);
    expect(() => restoreState(new Machine({ roms: { level2: new Uint8Array(0x3800) } }).system, state)).toThrow(/^Not a TRS-80 Model III save state$/);
    expect(() => restoreState(model1().system, { machine: 'toString' })).toThrow(/^Not a TRS-80 Model I save state$/);
  });

  it('the committed pre-phase-6 Model III state restores into a fresh Model III', () => {
    const FIXTURE = fileURLToPath(new URL('../../../../fixtures/synthetic/emu/model3-state.json', import.meta.url));
    const { state, memory64k, screen } = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    const m = new Machine({ roms: { level2: model3SampleRom() } });
    restoreState(m.system, state);
    expect(serializeState(m.system)).toEqual(state);
    expect(sha256Hex(m.mem.read(0, 0x10000))).toBe(memory64k);
    expect(m.video.text()).toEqual(screen);
    // and it runs on: the session's RTC handler keeps counting ticks at $4101
    const ticks = m.mem.read(0x4101, 1)[0];
    m.run({ cycles: 2027520 / 10 });
    expect((m.mem.read(0x4101, 1)[0] - ticks) & 0xff).toBe(3);
  });
});

describe('the label file on a Model I (Task 4)', () => {
  it('records program.model 1, and the Model III keeps 3', () => {
    // LD SP,7F00H / JR $ at 7000H, loaded as a .CMD named SPIN.
    const cmd = new Uint8Array([0x05, 0x04, 0x53, 0x50, 0x49, 0x4e, 0x01, 0x07, 0x00, 0x70, 0x31, 0x00, 0x7f, 0x18, 0xfe, 0x02, 0x02, 0x00, 0x70]);
    const m1 = model1();
    m1.load.cmd(cmd);
    expect(m1.debug.labelFile().program).toMatchObject({ name: 'SPIN', model: 1 });
    const rom3 = new Uint8Array(0x3800);
    rom3[0] = 0x76;
    const m3 = new Machine({ roms: { level2: rom3 } });
    m3.load.cmd(cmd);
    expect(m3.debug.labelFile().program).toMatchObject({ name: 'SPIN', model: 3 });
  });
});
