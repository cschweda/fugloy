/** Helpers shared by the integration tests that boot the real Model III ROM through the Machine facade. */
import { CPU_CLOCK_HZ, Machine } from '../../src/index.js';

/** The screen as one string. */
export const screen = (m) => m.video.text().join('\n');

/** Runs in quarter-second slices until the screen shows `text`, or throws after `seconds`. */
export function waitFor(m, text, seconds) {
  for (let t = 0; t < seconds * 4; t++) {
    if (screen(m).includes(text)) return;
    m.run({ cycles: CPU_CLOCK_HZ / 4 });
  }
  if (!screen(m).includes(text)) throw new Error(`no "${text}" within ${seconds} s:\n${screen(m)}`);
}

/** A Model III at READY, booted through the facade: ENTER at Cass? (1500 baud) and at Memory Size?. */
export function bootToReady(rom) {
  const m = new Machine({ roms: { level2: rom } });
  waitFor(m, 'Cass?', 2);
  m.keyboard.type('\n');
  waitFor(m, 'Memory Size?', 2);
  m.keyboard.type('\n');
  waitFor(m, 'READY', 2);
  m.run({ cycles: CPU_CLOCK_HZ / 4 }); // let the cursor settle
  return m;
}
