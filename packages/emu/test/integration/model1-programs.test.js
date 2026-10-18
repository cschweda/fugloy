/**
 * Emu phase 6, Task 4: real programs on the Model I Level II ROM (roms.model1 in fugloy.mcp.json;
 * the suite skips without it). Each boots the Model I (48K, the Expansion Interface, no disk),
 * answers MEMORY SIZE? with ENTER, loads with m.load.cmd at READY, and runs to its title screen;
 * the text asserted is what stays on screen. The stock Model I has no lowercase, so titles that
 * the Model III shows in mixed case read in capitals here (the bit-6 gate, memory.js); Super Nova
 * writes its credits in lowercase, which the stock machine shows as punctuation and the
 * lowercase modification (`lowercase: true`) shows as written.
 *
 * From examples/ (public domain; these run wherever the ROM is configured):
 *   eliminator/elimin8a.cmd   the Model I-only build (it rebuilds the cassette Level II system
 *                             area from the ROM at $06D2): title after about 0.3 s; answers ENTER
 *   eliminator/elimin8c.cmd   the $4900 build that runs on both models
 *   sea-dragon/seadrg01.cmd   title after about 5 s; answers ENTER
 *   rear-guard/reargrd5.cmd   title after about 2 s; answers ENTER
 *   armored-patrol/ARMOUR.III its "1 OR 2 PLAYERS?" screen in 0.2 s
 * From fixtures/real (gitignored; each skips when missing): Space Warp 1 and 3, Asylum 16K and
 * 32K, Super Nova, Crazy Painter, Deathmaze 5000, Pirate's Adventure, and Volcano. Space Warp 2
 * (a tape loader stub), Penetrator (a Model III conversion that writes port $FE) and Armored
 * Patrol's GO.CMD do not reach a title on the Model I, and do not on the Model III either.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Machine } from '../../src/index.js';
import { configuredFixtures, configuredRom, ROM_TEST_TIMEOUT } from '../rom.js';

const rom = configuredRom('model1');
const HZ = 1774080;

const example = (path) => new Uint8Array(readFileSync(new URL(`../../../../examples/${path}`, import.meta.url)));
const fixture = (/** @type {RegExp} */ pattern) => configuredFixtures(pattern)[0] ?? null;
const screen = (m) => m.video.text().join('\n');

/** Runs in tenth-second slices until the screen shows `text`, or throws after `seconds`. */
function waitFor(m, text, seconds) {
  for (let t = 0; t < seconds * 10; t++) {
    if (screen(m).includes(text)) return;
    m.run({ cycles: HZ / 10 });
  }
  if (!screen(m).includes(text)) throw new Error(`no "${text}" within ${seconds} s:\n${screen(m)}`);
}

/** A Model I at READY, MEMORY SIZE? answered with ENTER. */
function bootToReady(opts = {}) {
  const m = new Machine({ model: 1, roms: { level2: /** @type {Uint8Array} */ (rom) }, ...opts });
  waitFor(m, 'SIZE?', 1);
  m.keyboard.type('\n');
  waitFor(m, 'READY', 5);
  m.run({ cycles: HZ / 10 });
  return m;
}

/** How many of the 1,024 video cells differ between two screens. */
function cellsDiffering(a, b) {
  let n = 0;
  for (let i = 0; i < 1024; i++) if (a[i] !== b[i]) n++;
  return n;
}

/** Boot, load `bytes`, and wait for `title`; the machine, and how many cells differ from READY. */
function toTitle(bytes, title, opts = {}) {
  const m = bootToReady(opts);
  const ready = Uint8Array.from(m.video.raw);
  const manifest = m.load.cmd(bytes);
  expect(m.cpu.regs.pc).toBe(manifest.entry);
  waitFor(m, title, 10);
  m.run({ cycles: HZ / 2 }); // and it stays there
  return { m, cells: cellsDiffering(m.video.raw, ready) };
}

const CREDIT = 'BY: WAYNE WESTMORELAND & TERRY GILMAN';

const EXAMPLES = [
  { file: 'eliminator/elimin8a.cmd', also: '(C) COPYRIGHT 1981 ADVENTURE INTERNATIONAL', answer: ['HIGH SCORES', '1 OR 2 PLAYERS?'] },
  { file: 'eliminator/elimin8c.cmd', also: '(C) COPYRIGHT 1981 ADVENTURE INTERNATIONAL', answer: ['HIGH SCORES', '1 OR 2 PLAYERS?'] },
  { file: 'sea-dragon/seadrg01.cmd', also: '(C) COPYRIGHT 1982', answer: ['1 OR 2 PLAYERS?'] },
  { file: 'rear-guard/reargrd5.cmd', also: '(C) COPYRIGHT 1982', answer: ['HIGH SCORES', '1 OR 2 PLAYERS?'] },
];

const FIXTURES = [
  { name: 'Space Warp 1', path: fixture(/spcwarp1\.cmd$/), title: '))SPACE WARP((', also: 'COPYRIGHT 1978 JOSHUA LAVINSKY' },
  { name: 'Space Warp 3', path: fixture(/spcwarp3\.cmd$/), title: ')))SPACE WARP(((', also: 'WHAT LEVEL DO YOU WISH TO PLAY (1-10)?' },
  { name: 'Asylum 16K', path: fixture(/asylum16\.cmd$/), title: 'RESTORE AN OLD GAME (Y OR N)?', also: 'RESTORE' },
  { name: 'Asylum 32K', path: fixture(/asylum32\.cmd$/), title: 'DO YOU WISH TO RESTORE AN OLD GAME (Y OR N)?', also: 'RESTORE' },
  { name: 'Crazy Painter', path: fixture(/crzpnt01\.cmd$/), title: '(C) 1982 CORNSOFT GROUP', also: 'BY.ROBERT.PAPPAS' },
  { name: 'Deathmaze 5000', path: fixture(/dthmz5k1\.cmd$/), title: 'DO YOU WISH TO LOAD AN OLD GAME (Y OR N)?', also: 'LOAD' },
  { name: "Pirate's Adventure", path: fixture(/pirate\.cmd$/), title: 'WANT TO RESTORE A PREVIOUSLY SAVED GAME?', also: 'RESTORE' },
  { name: 'Volcano', path: fixture(/volcano\.cmd$/), title: 'MEN :', also: 'SCORE :' },
];

const superNova = fixture(/supnov3a\.cmd$/);

describe.skipIf(rom === null)('real programs on the Model I Level II ROM', { timeout: ROM_TEST_TIMEOUT }, () => {
  it.each(EXAMPLES)('$file reaches its title screen and answers ENTER', ({ file, also, answer }) => {
    const { m, cells } = toTitle(example(file), CREDIT);
    expect(screen(m)).toContain(also);
    expect(cells).toBeGreaterThan(256);
    // Held half a second, as on the Model III (programs.test.js): Rear Guard reads the keyboard
    // only between the delays that blink its prompt.
    m.keyboard.type('\n', { cps: 1 });
    waitFor(m, answer[answer.length - 1], 3);
    for (const line of answer) expect(screen(m)).toContain(line);
    expect(screen(m)).not.toContain(also);
  });

  it('armored-patrol/ARMOUR.III reaches its players screen', () => {
    const { m } = toTitle(example('armored-patrol/ARMOUR.III'), '1 OR 2 PLAYERS?');
    expect(screen(m)).toContain('A R M O R E D  P A T R O L');
    expect(screen(m)).toContain(CREDIT);
  });

  it.each(FIXTURES.filter((f) => f.path !== null))('$name reaches its title screen', ({ path, title, also }) => {
    const { m, cells } = toTitle(new Uint8Array(readFileSync(/** @type {string} */ (path))), title);
    expect(screen(m)).toContain(also);
    expect(cells).toBeGreaterThan(50);
  });

  it.skipIf(superNova === null)('Super Nova writes lowercase: punctuation on the stock Model I, letters with the lowercase modification', () => {
    const bytes = new Uint8Array(readFileSync(/** @type {string} */ (superNova)));
    // 'i' ($69) is stored without bit 6 and reads back as ')' ($29); 'g' ($67) as "'" ($27).
    const stock = toTitle(bytes, "B)' FIVE SOFTWARE CO.").m;
    expect(screen(stock)).toContain('V%23)/.');
    const modified = toTitle(bytes, 'Big Five Software Co.', { lowercase: true }).m;
    expect(screen(modified)).toContain('Version');
  });

  it('a Model I session repeats byte for byte: Eliminator (elimin8a) to its title, ENTER, 1 player, twice', () => {
    const session = () => {
      const m = bootToReady();
      m.load.cmd(example('eliminator/elimin8a.cmd'));
      m.run({ cycles: 2 * HZ });
      m.keyboard.type('\n', { cps: 1 });
      m.run({ cycles: 2 * HZ });
      m.keyboard.type('1');
      m.run({ cycles: 4 * HZ });
      return JSON.stringify(m.debug.snapshot());
    };
    expect(session()).toBe(session());
  });
});
