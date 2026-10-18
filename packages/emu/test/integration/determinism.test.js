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
function syntheticScript(keys = 'AB\n', at = 0.3) {
  const m = new Machine({ roms: { level2: syntheticRom() } });
  m.run({ cycles: Math.round(at * SECOND) });
  m.keyboard.type(keys);
  m.run({ cycles: Math.round((0.8 - at) * SECOND) });
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

const rom = configuredRom('model3');
const screen = (m) => m.video.text().join('\n');

/** Runs in quarter-second slices until the screen shows `text`, or throws after `seconds`. */
function waitFor(m, text, seconds) {
  for (let t = 0; t < seconds * 4; t++) {
    if (screen(m).includes(text)) return;
    m.run({ cycles: SECOND / 4 });
  }
  if (!screen(m).includes(text)) throw new Error(`no "${text}" within ${seconds} s:\n${screen(m)}`);
}

/** Boot (ENTER at Cass? and Memory Size?, to READY), load Sea Dragon, run 3 s, type ENTER, run 2 s. */
function seaDragonScript() {
  const m = new Machine({ roms: { level2: rom } });
  waitFor(m, 'Cass?', 2);
  m.keyboard.type('\n');
  waitFor(m, 'Memory Size?', 2);
  m.keyboard.type('\n');
  waitFor(m, 'READY', 2);
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
