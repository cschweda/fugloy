/**
 * The phase 2 deliverable: three real public-domain programs from examples/ load with m.load.cmd
 * on the Model III ROM from fugloy.mcp.json and run to their title screens, and each answers a
 * key. Everything goes through the Machine facade: the boot answers Cass? and Memory Size? with
 * ENTER and waits for READY, then the program loads and runs for at most 10 emulated seconds.
 *
 * The candidates, in order (all run on a Model III with no DOS):
 *   sea-dragon/seadrg01.cmd    chosen: title text after about 4.9 s; about 1,010 cells differ from READY
 *   eliminator/elimin8c.cmd    chosen: title text after about 0.3 s; 470-520 cells differ (the logo animates)
 *   rear-guard/reargrd5.cmd    chosen: title text after about 1.9 s; 968-975 cells differ
 *   armored-patrol/ARMOUR.III  not needed, since the first three qualify. Had it been, it would
 *                              not pass: it reaches its screen ("A R M O R E D  P A T R O L",
 *                              then "1 or 2 Players?") in 0.2 s, but that screen differs from
 *                              READY in only 152 cells, under the 256 required.
 * The fragments asserted are lines that stay on screen: Eliminator's "Press <ENTER> to Start"
 * and Rear Guard's "Hit <ENTER> to begin" blink, so neither is used.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CPU_CLOCK_HZ, Machine } from '../../src/index.js';
import { configuredRom, ROM_TEST_TIMEOUT } from '../rom.js';

const rom = configuredRom('model3');
const example = (path) => new Uint8Array(readFileSync(new URL(`../../../../examples/${path}`, import.meta.url)));
const screen = (m) => m.video.text().join('\n');

/** Runs in quarter-second slices until the screen shows `text`, or throws after `seconds`. */
function waitFor(m, text, seconds) {
  for (let t = 0; t < seconds * 4; t++) {
    if (screen(m).includes(text)) return;
    m.run({ cycles: CPU_CLOCK_HZ / 4 });
  }
  if (!screen(m).includes(text)) throw new Error(`no "${text}" within ${seconds} s:\n${screen(m)}`);
}

/** A Model III at READY, booted through the facade: ENTER at Cass? (1500 baud) and at Memory Size?. */
function bootToReady() {
  const m = new Machine({ roms: { level2: rom } });
  waitFor(m, 'Cass?', 2);
  m.keyboard.type('\n');
  waitFor(m, 'Memory Size?', 2);
  m.keyboard.type('\n');
  waitFor(m, 'READY', 2);
  m.run({ cycles: CPU_CLOCK_HZ / 4 }); // let the cursor settle
  return m;
}

/** How many of the 1,024 video cells differ between two screens. */
function cellsDiffering(a, b) {
  let n = 0;
  for (let i = 0; i < 1024; i++) if (a[i] !== b[i]) n++;
  return n;
}

const PROGRAMS = [
  { file: 'sea-dragon/seadrg01.cmd', title: 'BY: Wayne Westmoreland & Terry Gilman', also: '(C) Copyright 1982', answer: ['1 or 2 Players?'] },
  { file: 'eliminator/elimin8c.cmd', title: 'BY: Wayne Westmoreland & Terry Gilman', also: '(C) Copyright 1981 Adventure International', answer: ['HIGH SCORES', '1 or 2 Players?'] },
  { file: 'rear-guard/reargrd5.cmd', title: 'BY: Wayne Westmoreland & Terry Gilman', also: '(C) Copyright 1982', answer: ['HIGH SCORES', 'Hit "SHIFT CLEAR" to clear high scores', '1 or 2 Players?'] },
];

describe.skipIf(rom === null)('three real programs on the Model III ROM', { timeout: ROM_TEST_TIMEOUT }, () => {
  it.each(PROGRAMS)('$file reaches its title screen and answers ENTER', ({ file, title, also, answer }) => {
    const m = bootToReady();
    const ready = Uint8Array.from(m.video.raw);
    const manifest = m.load.cmd(example(file));
    expect(m.cpu.regs.pc).toBe(manifest.entry);

    waitFor(m, title, 10);
    m.run({ cycles: CPU_CLOCK_HZ / 2 }); // and it stays there
    expect(screen(m)).toContain(title);
    expect(screen(m)).toContain(also);
    expect(cellsDiffering(m.video.raw, ready)).toBeGreaterThan(256);

    // Held half a second, as a player would: Rear Guard reads the keyboard only between the
    // delays that blink its prompt, so the default 50 ms tap (cps 10) is missed about half the time.
    m.keyboard.type('\n', { cps: 1 });
    waitFor(m, answer[answer.length - 1], 3);
    for (const line of answer) expect(screen(m)).toContain(line);
    expect(screen(m)).not.toContain(also); // the title is gone
  });
});
