/**
 * The Model III fixtures against trsjs (emu phase 7, Task 3): each program loaded on the Model III
 * ROM and run through a scripted session for 10 million instructions, compared with trsjs after
 * every one, with no divergence the known classes (known.js) do not explain.
 *
 * The sessions are the emu phase 2 title-screen scripts carried on into play, with keys typed into
 * both keyboard matrices at the same T-state (plan Ruling 3). Each lists the screens it must reach,
 * in order; the screen is checked every 100,000 instructions, and video RAM is compared with the
 * reference's there too. The per-class counts are exact: a class that began to excuse more (or
 * less), or a change in what either machine runs, fails here.
 *
 * Opt-in: FUGLOY_TRSJS=1 runs the sessions (about a minute). FUGLOY_TRSJS_SWEEP=1 as well runs every
 * other .CMD in examples/ and in the config's fixtures folder (fixtures/real/, never committed; a
 * missing folder runs none) under one generic script, checking only that nothing diverges; about
 * seven seconds a program.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CPU_CLOCK_HZ } from '../../src/index.js';
import { bootToReady, screen } from '../integration/boot-helpers.js';
import { configuredFixtures } from '../rom.js';
import { compareRun, keyEvents } from './compare.js';
import { requireRom, trsjsSkip } from './gate.js';
import { loadTrsjs } from './trsjs-adapter.js';

const EXAMPLES = fileURLToPath(new URL('../../../../examples/', import.meta.url));
const INSTRUCTIONS = 10_000_000;
const CHECK_EVERY = 100_000;
const S = CPU_CLOCK_HZ;
/** A press held half a second, as a player would (Rear Guard and Eliminator read the keyboard between delays). */
const press = (at, key, hold = 0.5) => ({ at: at * S, key, hold: hold * S });

/**
 * @typedef {{ at: number, key: string, hold: number }} Press
 * @typedef {{ file: string, keys: Press[], screens: string[], known: Record<string, number> }} Session
 */

/** @type {Session[]} */
const SESSIONS = [
  {
    // Title after 4.9 s; ENTER, 1 player, Novice, then play with the sub moving and firing.
    file: 'sea-dragon/seadrg01.cmd',
    keys: [press(6, 'ENTER'), press(9, '1'), press(12, '0'), press(15, 'SPACE', 2), press(18, 'UP', 1), press(20, 'DOWN', 1), press(22, 'RIGHT', 2)],
    screens: ['BY: Wayne Westmoreland & Terry Gilman', '1 or 2 Players?', 'Player 1: Skill level', 'SHIPS 4'],
    known: { 'BIT: S and P/V': 364_967, 'DDCB/FDCB: R counted three times': 6_245, 'flags 3 and 5 (X/Y)': 1_390_426 },
  },
  {
    // The phase 2 build: title at once, ENTER to the high scores. It never takes the 1: it waits in
    // the ROM's $0049 with interrupts off (on trsjs too).
    file: 'eliminator/elimin8c.cmd',
    keys: [press(2, 'ENTER'), press(5, '1')],
    screens: ['Press <ENTER> to Start', '1 or 2 Players?'],
    known: { 'flags 3 and 5 (X/Y)': 64_175 },
  },
  {
    // The same game in place: ENTER, 1 player, then play.
    file: 'eliminator/elimin8e.cmd',
    keys: [press(6, 'ENTER'), press(9, '1'), press(12, 'SPACE', 1), press(14, 'LEFT', 1), press(16, 'RIGHT', 1)],
    screens: ['Press <ENTER> to Start', '1 or 2 Players?', 'SHIPS: 4 BOMBS: 3'],
    known: { 'BIT: S and P/V': 34_993, 'DDCB/FDCB: R counted three times': 523, 'flags 3 and 5 (X/Y)': 634_716, 'interrupt held while DI: trsjs drops it': 1, 'interrupt response: R not counted': 295 },
  },
  {
    // The phase 2 build, to "1 or 2 Players?" (the plan's Review Focus 4: the ENTER reaches both
    // machines at the same T-state and leaves both on that screen). Like Eliminator c, it then
    // waits in $0049 with interrupts off.
    file: 'rear-guard/reargrd5.cmd',
    keys: [press(4, 'ENTER'), press(7, '1')],
    screens: ['Hit <ENTER> to begin', 'HIGH SCORES', '1 or 2 Players?'],
    known: { 'BIT: S and P/V': 25, 'flags 3 and 5 (X/Y)': 48_716 },
  },
  {
    // The build closest to the original disk: ENTER, 1 player, then play.
    file: 'rear-guard/reargrd4.cmd',
    keys: [press(6, 'ENTER'), press(9, '1'), press(12, 'SPACE', 1), press(14, 'UP', 1), press(16, 'DOWN', 1)],
    screens: ['Hit <ENTER> to begin', '1 or 2 Players?', 'Ships:4 Shield:'],
    known: { 'BIT: S and P/V': 101_061, 'DDCB/FDCB: R counted three times': 12_363, 'flags 3 and 5 (X/Y)': 1_213_502 },
  },
  {
    // "1 or 2 Players?" at once; 1 player, then play ("A" right, "Z" left, space fires).
    file: 'armored-patrol/ARMOUR.III',
    keys: [press(1, '1'), press(4, 'SPACE', 1), press(6, 'A', 1), press(8, 'Z', 1), press(10, 'SPACE', 1)],
    screens: ['1 or 2 Players?', 'ENERGY:'],
    known: { 'BIT: S and P/V': 90_087, 'flags 3 and 5 (X/Y)': 1_662_093 },
  },
];

/** The generic script of the sweep: ENTER, a 1, ENTER again, then a few play keys. */
const GENERIC = [press(6, 'ENTER'), press(9, '1'), press(12, 'ENTER'), press(14, 'SPACE', 1), press(16, 'LEFT', 1), press(18, 'RIGHT', 1), press(20, 'UP'), press(22, 'SPACE', 1)];

/**
 * Boot, load, and compare `INSTRUCTIONS` instructions with the keys, checking the screens in order.
 * @param {Uint8Array} program
 * @param {Press[]} script
 * @param {string[]} screens
 */
function session(program, script, screens) {
  const m = bootToReady(requireRom());
  m.load.cmd(program);
  const ref = loadTrsjs();
  const start = m.cycles;
  const keys = keyEvents(script.map((e) => ({ ...e, at: e.at + start })));
  /** @type {string[]} */
  const seen = [];
  let videoEqual = true;
  const check = () => {
    while (seen.length < screens.length && screen(m).includes(screens[seen.length])) seen.push(screens[seen.length]);
    const ours = m.mem.read(0x3c00, 0x400);
    const theirs = ref.peek(0x3c00, 0x400);
    for (let k = 0; k < 0x400; k++) if (ours[k] !== theirs[k]) videoEqual = false;
  };
  const result = compareRun({ machine: m, reference: ref, instructions: INSTRUCTIONS, keys, progress: { every: CHECK_EVERY, fn: check } });
  return { result, seen, videoEqual, seconds: (m.cycles - start) / S };
}

const example = (/** @type {string} */ path) => new Uint8Array(readFileSync(join(EXAMPLES, path)));

describe.skipIf(trsjsSkip !== null)(`the Model III fixtures against trsjs${trsjsSkip === null ? '' : ` (skipped: ${trsjsSkip})`}`, { timeout: 120_000 }, () => {
  it.each(SESSIONS)('$file: a scripted session of 10 million instructions with no unexplained divergence', ({ file, keys, screens, known }) => {
    const { result, seen, videoEqual } = session(example(file), keys, screens);
    expect(result.divergence).toBeNull();
    expect(result.instructions).toBe(INSTRUCTIONS);
    expect(seen).toEqual(screens);
    expect(videoEqual).toBe(true);
    expect(result.known).toEqual(known);
  });
});

const SWEEP = trsjsSkip === null && process.env.FUGLOY_TRSJS_SWEEP === '1';
const named = new Set(SESSIONS.map((s) => s.file));
// Listed whether or not the sweep runs, so a skipped sweep still shows its tests.
const sweepFiles = [
  ...readdirSync(EXAMPLES, { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.(cmd|iii)$/i.test(f) && !named.has(f.split('\\').join('/')))
    .sort()
    .map((f) => join(EXAMPLES, f)),
  ...configuredFixtures(/\.cmd$/i),
];

describe.skipIf(!SWEEP)(`every other .CMD against trsjs${SWEEP ? '' : ' (skipped: set FUGLOY_TRSJS=1 and FUGLOY_TRSJS_SWEEP=1 to run)'}`, { timeout: 120_000 }, () => {
  it.each(sweepFiles.map((path) => ({ path, name: basename(path) })))('$name: 10 million instructions under the generic script, no unexplained divergence', ({ path }) => {
    const { result } = session(new Uint8Array(readFileSync(path)), GENERIC, []);
    expect(result.divergence).toBeNull();
    expect(result.instructions).toBe(INSTRUCTIONS);
  });
});
