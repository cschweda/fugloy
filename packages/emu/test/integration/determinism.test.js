/**
 * same-script-twice: one script run on two fresh Machines ends byte for byte the same, in
 * serializeState (compared as JSON text), in every port $FF event, and in the cycle count.
 * The synthetic version needs no ROM, so CI checks it; the real one boots the Model III ROM from
 * fugloy.mcp.json and plays Sea Dragon: boot, load, run 3 s, type ENTER, run 2 s.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CPU_CLOCK_HZ, Machine, serializeState } from '../../src/index.js';
import { configuredRom, ROM_TEST_TIMEOUT } from '../rom.js';
import { bootToReady, screen } from './boot-helpers.js';

const SECOND = CPU_CLOCK_HZ;

/** Everything a run leaves behind that the comparison covers. */
function outcome(m) {
  return { state: JSON.stringify(serializeState(m.system)), sound: m.sound.events(), overflowed: m.sound.overflowed, cycles: m.cycles };
}

/**
 * A synthetic 14K ROM: unmask the RTC, IM 1, EI, then loop forever copying the OR of every
 * keyboard row ($38FF) into video RAM (ORed into what is there), wrapping over $3C00-$3FFF, and writing L to port $FF.
 * The RTC handler at $0038 acknowledges through port $EC, counts ticks at $4000, and writes the
 * count to port $FF too, so interrupt timing shows in both memory and sound.
 */
function syntheticRom() {
  const rom = new Uint8Array(0x3800);
  rom.set([
    0x31, 0x00, 0x80, //       LD SP,8000H
    0x3e, 0x04, 0xd3, 0xe0, // LD A,04H / OUT (0E0H),A    unmask the RTC
    0xed, 0x56, 0xfb, //       IM 1 / EI
    0x21, 0x00, 0x3c, //       LD HL,3C00H
    0x3a, 0xff, 0x38, //  $000D LD A,(38FFH)              every keyboard row
    0xb6, 0x77, 0x23, //       OR (HL) / LD (HL),A / INC HL   keys pressed stay seen
    0x7c, 0xe6, 0x03, 0xf6, 0x3c, 0x67, // LD A,H / AND 03H / OR 3CH / LD H,A   stay in video RAM
    0x7d, 0xd3, 0xff, //       LD A,L / OUT (0FFH),A
    0x18, 0xef, //             JR $000D
  ]);
  rom.set([
    0xf5, 0xdb, 0xec, //       PUSH AF / IN A,(0ECH)      acknowledge the RTC
    0x3a, 0x00, 0x40, 0x3c, 0x32, 0x00, 0x40, // LD A,(4000H) / INC A / LD (4000H),A
    0xd3, 0xff, //             OUT (0FFH),A
    0xf1, 0xfb, 0xed, 0x4d, // POP AF / EI / RETI
  ], 0x38);
  return rom;
}

/** The synthetic script: run 0.3 s, type `keys` (matrix, the default), run 0.5 s. */
function syntheticScript(keys = 'AB\n') {
  const m = new Machine({ roms: { level2: syntheticRom() } });
  m.run({ cycles: Math.round(0.3 * SECOND) });
  m.keyboard.type(keys);
  m.run({ cycles: Math.round(0.5 * SECOND) });
  return { m, ...outcome(m) };
}

describe('same-script-twice, synthetic ROM', () => {
  it('two fresh Machines end identical in state, sound, and cycles', () => {
    const a = syntheticScript();
    const b = syntheticScript();
    // The script did something worth comparing: ticks counted, keys seen on screen, sound made.
    expect(a.m.mem.read(0x4000, 1)[0]).toBeGreaterThan(0);
    expect(a.m.video.raw.some((v) => v !== 0)).toBe(true);
    expect(a.sound.length).toBeGreaterThan(1000);
    expect(b.state).toBe(a.state);
    expect(b.sound).toEqual(a.sound);
    expect(b.overflowed).toBe(a.overflowed);
    expect(b.cycles).toBe(a.cycles);
  });

  it('the comparison notices a change: a different key ends differently', () => {
    const a = syntheticScript('AB\n');
    const b = syntheticScript('AC\n');
    expect(b.state).not.toBe(a.state);
  });
});

describe('slicing independence, synthetic ROM', () => {
  const T1 = 600_000;
  const T2 = 1_700_000;

  /** The script: run to T1, type, run to T2; `advance(m, target)` decides how each leg is sliced. */
  function script(advance) {
    const m = new Machine({ roms: { level2: syntheticRom() } });
    advance(m, T1);
    m.keyboard.type('AB\n');
    advance(m, T2);
    return { m, ...outcome(m), screen: screen(m) };
  }

  const oneRun = (m, target) => m.run({ until: (mm) => mm.cycles >= target });
  /** Mixed step(1) and run({ cycles }) slices, all short of the target, then run on to the first boundary at or past it. */
  const sliced = (m, target) => {
    const stop = m.cycles + 0.7 * (target - m.cycles);
    for (let k = 0; m.cycles < stop; k++) {
      if (k % 3 === 0) m.step(1);
      else if (k % 3 === 1) m.run({ cycles: 1234 + 97 * k });
      else m.step(7);
    }
    oneRun(m, target);
  };

  it('one run and mixed step/run slices end identical in state, sound, and screen', () => {
    const a = script(oneRun);
    const b = script(sliced);
    expect(a.sound.length).toBeGreaterThan(1000); // the script did something worth comparing
    expect(a.m.video.raw.some((v) => v !== 0)).toBe(true);
    expect(b.cycles).toBe(a.cycles);
    expect(b.state).toBe(a.state);
    expect(b.sound).toEqual(a.sound);
    expect(b.screen).toBe(a.screen);
  });
});

const rom = configuredRom('model3');
/** Boot (ENTER at Cass? and Memory Size?, to READY), load Sea Dragon, run 3 s, type ENTER, run 2 s. */
function seaDragonScript() {
  const m = bootToReady(rom);
  m.load.cmd(new Uint8Array(readFileSync(new URL('../../../../examples/sea-dragon/seadrg01.cmd', import.meta.url))));
  m.run({ cycles: 3 * SECOND });
  m.keyboard.type('\n');
  m.run({ cycles: 2 * SECOND });
  return { m, ...outcome(m) };
}

describe.skipIf(rom === null)('same-script-twice, Sea Dragon on the Model III ROM', { timeout: ROM_TEST_TIMEOUT }, () => {
  it('two fresh Machines end identical in state, sound, and cycles', () => {
    const a = seaDragonScript();
    const b = seaDragonScript();
    expect(screen(a.m)).toContain('1 or 2 Players?'); // the game took the ENTER
    expect(a.sound.length).toBeGreaterThan(0);
    expect(b.state).toBe(a.state);
    expect(b.sound).toEqual(a.sound);
    expect(b.overflowed).toBe(a.overflowed);
    expect(b.cycles).toBe(a.cycles);
  });
});
