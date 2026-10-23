/**
 * The Model I's session runners (emu phase 7, Model I; plan Ruling 7), moved out of
 * model1-fixtures.test.js by the Model I sweep's Task 2 so that one set of runners serves the
 * thirteen sessions there, the sweep (one generic script, `GENERIC`, over every other program) and
 * `pnpm diff <program> --model 1 --reference mame` (scripts/diff.mjs): a program loaded on the
 * Level II ROM and played through a scripted session for 10 million instructions past the load (or
 * as many as asked), compared with a reference after every instruction.
 *
 * One timeline for both references, in our Model I's T-states (1,774,080 a second): power-on, ENTER
 * held 0.1 s from 0.5 s (MEM SIZE?), the program loaded at 4 s with m.load.cmd (READY has been on
 * the screen since about 2.2 s), then the session's keys, their times counted from the load.
 * - Against xtrs (lockstep), our machine runs alone from power-on to the load, xtrs is synced from
 *   it, and the instructions after the load are compared, the keys going into both matrices at the
 *   same T-state.
 * - Against MAME (a trace, Ruling 4), the trace is recorded from power-on with the same key events
 *   on MAME's matrix (set at frame boundaries, so up to two frames later than ours would see them;
 *   the comparison follows the bytes MAME's reads returned) and the program loaded by MAME's
 *   debugger at the first instruction boundary at or after 4 s. Our machine follows it from
 *   power-on, the boot and the instructions after the load, with its 40 Hz on MAME's schedule
 *   (mame-clock.js, the controller's ruling on MAME's clock). Each trace (about 95 MB for 10 million
 *   instructions) is recorded into a temporary folder and deleted after its comparison, in a
 *   `finally`, whatever the result.
 *
 * Importing this module reads roms.model1 (the sessions' gate below), which throws for a config
 * that names a file that is not there; scripts/diff.mjs therefore loads it only for the MAME
 * recording it serves, never for a run that does not need it.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clockHz, Machine, ROM_HASHES } from '../../src/index.js';
import { configuredRom } from '../rom.js';
import { compareRun, formatReport, keyEvents, videoGate } from './compare.js';
import { requireRom } from './gate.js';
import { mameTimer } from './mame-clock.js';
import { openTrace, recordMameTrace } from './mame-trace.js';
import { loadXtrs } from './xtrs-adapter.js';

/** The Model I's clock, T-states a second. */
export const HZ = clockHz(1);
/** The instructions a session compares past the load. */
export const INSTRUCTIONS = 10_000_000;
/** How often (in instructions) a session checks its screens and video RAM. */
export const CHECK_EVERY = 100_000;
/** The load's T-state from power-on. */
export const LOAD_AT = 4 * HZ;
/** ENTER at MEM SIZE?, held 0.1 s from 0.5 s. */
export const BOOT = keyEvents([{ at: 0.5 * HZ, key: 'ENTER', hold: 0.1 * HZ }]);

/** roms.model1, or null when fugloy.mcp.json names none. */
export const rom1 = configuredRom('model1');
/** roms.model1 is Level II 1.3 (models.js's ROM_HASHES), the ROM the sessions' counts and the typing tests are about. */
export const level2v13 = rom1 !== null && ROM_HASHES[createHash('sha256').update(rom1).digest('hex')] === 'model1-level2-1.3';
/**
 * Why the sessions skip with their flag set: their exact class counts are Level II 1.3's, and
 * another ROM runs other code, so it would only fail on them. With no roms.model1 they do not
 * skip: requireRom fails them with its sentence, as every flagged test does (gate.js).
 */
export const sessionSkip = rom1 === null || level2v13 ? null : 'roms.model1 is not Level II 1.3, for which the sessions\' class counts are pinned';

/**
 * A key press `at` seconds after the load, held `hold` seconds (half a second by default, as a
 * player would: Rear Guard reads the keyboard only between the delays that blink its prompt).
 * @param {number} at @param {string} key @param {number} [hold]
 */
export const press = (at, key, hold = 0.5) => ({ at, key, hold });

/**
 * @typedef {{ at: number, key: string, hold: number }} Press
 * @typedef {{ name: string, program: Uint8Array | null, keys: Press[], screens: string[], known: Record<string, Record<string, number>> }} Session
 *   program: null when a fixture is missing; screens: upper case, in order; known: the exact class
 *   counts per reference name (xtrs, MAME 0.289 trace); the sweep passes `{}` and checks none.
 */

/**
 * The generic script of the sweep, the Model III sweep's (test/diff/fixtures.test.js): ENTER, a 1,
 * ENTER again, then a few play keys.
 * @type {Press[]}
 */
export const GENERIC = [press(6, 'ENTER'), press(9, '1'), press(12, 'ENTER'), press(14, 'SPACE', 1), press(16, 'LEFT', 1), press(18, 'RIGHT', 1), press(20, 'UP'), press(22, 'SPACE', 1)];

/** A session's key events, from its presses' times after the load. @param {Press[]} keys */
export const sessionKeys = (keys) => keyEvents(keys.map((k) => ({ at: LOAD_AT + k.at * HZ, key: k.key, hold: k.hold * HZ })));

/**
 * A Model I from power-on to the load's T-state, ENTER at MEM SIZE? through the matrix (as
 * compareRun delivers keys: at the first boundary at or after their T-state).
 * @param {Uint8Array} rom
 */
export function toLoad(rom) {
  const m = new Machine({ model: 1, roms: { level2: rom } });
  let next = 0;
  while (m.cycles < LOAD_AT) {
    while (next < BOOT.length && BOOT[next].at <= m.cycles) {
      const e = BOOT[next++];
      if (e.down) m.system.keyboard.pressKey(e.row, e.bit); else m.system.keyboard.releaseKey(e.row, e.bit);
    }
    m.step(1);
  }
  return m;
}

/**
 * The screen in a reference's video RAM, read as m.video.text() reads ours (codes below $20 as
 * $40-$5F, graphics as '.', 32-character mode on our machine's MODESEL), upper-cased.
 * @param {Uint8Array} bytes @param {boolean} columns32
 */
export function screenOf(bytes, columns32) {
  const step = columns32 ? 2 : 1;
  const rows = [];
  for (let row = 0; row < 16; row++) {
    let line = '';
    for (let col = 0; col < 64 / step; col++) {
      let b = bytes[row * 64 + col * step];
      if (b < 0x20) b += 0x40;
      line += b < 0x80 ? String.fromCharCode(b) : '.';
    }
    rows.push(line.toUpperCase());
  }
  return rows.join('\n');
}

/**
 * The checkpoint: the screens reached so far (in order, on the reference's video RAM) and whether
 * video RAM was equal at every checkpoint, ours against the reference's through the gate.
 * @param {Machine} m @param {import('./reference.js').Reference} ref @param {string[]} screens
 */
export function checkpoints(m, ref, screens) {
  /** @type {string[]} */
  const seen = [];
  let videoEqual = true;
  return {
    seen,
    get videoEqual() {
      return videoEqual;
    },
    fn: () => {
      const theirs = ref.peek(0x3c00, 0x400);
      const ours = m.mem.read(0x3c00, 0x400);
      for (let k = 0; k < 0x400; k++) if (ours[k] !== videoGate(theirs[k])) videoEqual = false;
      const text = screenOf(theirs, m.system.columns32);
      while (seen.length < screens.length && text.includes(screens[seen.length])) seen.push(screens[seen.length]);
    },
  };
}

/** The report, when a run diverged (for the failure's output). @param {import('./compare.js').CompareResult} r */
export const explain = (r) => (r.divergence === null ? '' : formatReport(r));

/**
 * A session against xtrs: ours from power-on to the load, then 10 million instructions in lockstep.
 * @param {Session} s
 */
export function xtrsSession(s) {
  const rom = requireRom('model1');
  const m = toLoad(rom);
  m.load.cmd(/** @type {Uint8Array} */ (s.program));
  const ref = loadXtrs({ rom });
  try {
    const check = checkpoints(m, ref, s.screens);
    const result = compareRun({ machine: m, reference: ref, instructions: INSTRUCTIONS, keys: sessionKeys(s.keys), progress: { every: CHECK_EVERY, fn: check.fn } });
    return { result, seen: check.seen, videoEqual: check.videoEqual };
  } finally {
    ref.close?.();
  }
}

/**
 * A session against MAME: the trace recorded from power-on into a temporary folder, followed by
 * ours from power-on on MAME's 40 Hz schedule, the folder deleted after (in a `finally`, so a
 * recording or a comparison that throws leaves nothing behind). `instructions` counts past the
 * load (default INSTRUCTIONS, 10 million; pnpm diff asks for fewer). `rom` (default roms.model1)
 * is the Level II ROM MAME's set was assembled from, and `strict` is compareRun's; both are for
 * pnpm diff's `--rom` and `--strict`. Besides the comparison, the result holds the screen
 * MAME's video RAM showed at the end (`screenOf`).
 * @param {Session} s
 * @param {{ instructions?: number, rom?: Uint8Array, strict?: boolean | 'all' }} [opts]
 */
export async function mameSession(s, { instructions = INSTRUCTIONS, rom = requireRom('model1-mame'), strict = false } = {}) {
  const program = /** @type {Uint8Array} */ (s.program);
  const dir = mkdtempSync(join(tmpdir(), 'fugloy-m1-session-'));
  try {
    const out = join(dir, 'session.fmt');
    await recordMameTrace({ instructions, matrix: [...BOOT, ...sessionKeys(s.keys)], load: { program, at: LOAD_AT }, out, rom });
    const ref = openTrace(out, { program });
    try {
      const m = mameTimer(new Machine({ model: 1, roms: { level2: rom } }));
      const check = checkpoints(m, ref, s.screens);
      const result = compareRun({ machine: m, reference: ref, instructions: ref.header.requested, progress: { every: CHECK_EVERY, fn: check.fn }, strict });
      return { result, seen: check.seen, videoEqual: check.videoEqual, header: ref.header, screen: screenOf(ref.peek(0x3c00, 0x400), m.system.columns32) };
    } finally {
      ref.close?.();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
