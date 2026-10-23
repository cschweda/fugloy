/**
 * The Model I sessions against xtrs and MAME (emu phase 7, Model I, Task 5; plan Ruling 7): each
 * program that reaches its title on the Model I in model1-programs.test.js, loaded on the Level II
 * ROM and played through a scripted session for 10 million instructions past the load, compared
 * with each reference after every instruction, with no divergence the known classes (known.js) do
 * not explain. The four in examples/ (Eliminator a and c, Sea Dragon, Rear Guard 5) are the
 * required set; the nine in the config's fixtures folder (fixtures/real/, never committed) run where
 * present, each skipping when its file is missing.
 *
 * One timeline for both references, in our Model I's T-states (1,774,080 a second): power-on, ENTER
 * held 0.1 s from 0.5 s (MEM SIZE?), the program loaded at 4 s with m.load.cmd (READY has been on
 * the screen since about 2.2 s), then the session's keys, their times counted from the load.
 * - Against xtrs (lockstep), our machine runs alone from power-on to the load, xtrs is synced from
 *   it, and the 10 million instructions after the load are compared, the keys going into both
 *   matrices at the same T-state.
 * - Against MAME (a trace, Ruling 4), the trace is recorded from power-on with the same key events
 *   on MAME's matrix (set at frame boundaries, so up to two frames later than ours would see them;
 *   the comparison follows the bytes MAME's reads returned) and the program loaded by MAME's
 *   debugger at the first instruction boundary at or after 4 s. Our machine follows it from
 *   power-on, the boot and the 10 million instructions after the load, with its 40 Hz on MAME's
 *   schedule (mame-clock.js, the controller's ruling on MAME's clock). Each trace (about 95 MB) is
 *   recorded into a temporary folder and deleted after its comparison; the MAME sessions run five
 *   at a time (`concurrent`), since recording is MAME's speed and the comparison is not.
 *
 * Each session lists the screens it must reach, in order, checked every 100,000 instructions on the
 * reference's own video RAM, read as m.video.text() reads ours and upper-cased, and video RAM is
 * compared in full there too (ours against the reference's through the bit-6 gate). Upper-cased:
 * MAME's trs80l2 keeps video RAM as plain RAM (known.js, video-read-gate), so a program that tests
 * for the lowercase modification finds it there and writes mixed case (eight of the thirteen do:
 * Eliminator's "1 or 2 Players?"), which our machine, following, reads through the counted
 * video-read fix and stores through its gate: against MAME a session runs as on a Model I with the
 * modification, against xtrs as on the stock machine. The screens are named in words both paths show, and a blinking prompt by
 * its words that stay ("TO START" for "PRESS <ENTER> TO START"). The per-class counts are exact, per
 * reference: a class that began to excuse more (or less), or a change in what either machine runs,
 * fails here.
 *
 * Also here, typing at 20 characters a second under Level II (Review Focus 4; spec §5): on ours
 * wherever roms.model1 is configured, and against each reference behind its flag.
 *
 * Opt-in: FUGLOY_XTRS=1 runs the xtrs sessions (about 40 minutes on an Apple M4, 2.5 to 5 a
 * session: xtrs in lockstep compares 35,000 to 70,000 instructions a second, the fewer the more
 * steps a known class resyncs), FUGLOY_MAME=1 the MAME ones (about 12 minutes: MAME records about
 * 70,000 a second, five at a time; following a trace runs at about a million a second); both, one
 * after the other, about 55. One session alone: `-t elimin8c`.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { clockHz, Machine, ROM_HASHES } from '../../src/index.js';
import { configuredFixtures, configuredRom, ROM_TEST_TIMEOUT } from '../rom.js';
import { compareRun, formatReport, keyEvents, videoGate } from './compare.js';
import { mameSkip, requireRom, xtrsSkip } from './gate.js';
import { mameTimer } from './mame-clock.js';
import { openTrace, recordMameTrace } from './mame-trace.js';
import { loadXtrs } from './xtrs-adapter.js';

const EXAMPLES = fileURLToPath(new URL('../../../../examples/', import.meta.url));
const HZ = clockHz(1);
const INSTRUCTIONS = 10_000_000;
const CHECK_EVERY = 100_000;
/** The load's T-state from power-on. */
const LOAD_AT = 4 * HZ;
/** ENTER at MEM SIZE?, held 0.1 s from 0.5 s. */
const BOOT = keyEvents([{ at: 0.5 * HZ, key: 'ENTER', hold: 0.1 * HZ }]);
const XTRS = 'xtrs';
const MAME = 'MAME 0.289 trace';

const rom1 = configuredRom('model1');
/** roms.model1 is Level II 1.3 (models.js's ROM_HASHES), the ROM the sessions' counts and the typing tests are about. */
const level2v13 = rom1 !== null && ROM_HASHES[createHash('sha256').update(rom1).digest('hex')] === 'model1-level2-1.3';
/**
 * Why the sessions skip with their flag set: their exact class counts are Level II 1.3's, and
 * another ROM runs other code, so it would only fail on them. With no roms.model1 they do not
 * skip: requireRom fails them with its sentence, as every flagged test does (gate.js).
 */
const sessionSkip = rom1 === null || level2v13 ? null : 'roms.model1 is not Level II 1.3, for which the sessions\' class counts are pinned';

/**
 * A key press `at` seconds after the load, held `hold` seconds (half a second by default, as a
 * player would: Rear Guard reads the keyboard only between the delays that blink its prompt).
 * @param {number} at @param {string} key @param {number} [hold]
 */
const press = (at, key, hold = 0.5) => ({ at, key, hold });

/**
 * @typedef {{ at: number, key: string, hold: number }} Press
 * @typedef {{ name: string, program: Uint8Array | null, keys: Press[], screens: string[], known: Record<string, Record<string, number>> }} Session
 *   program: null when a fixture is missing; screens: upper case, in order; known: the exact class
 *   counts per reference name (xtrs, MAME 0.289 trace).
 */

const example = (/** @type {string} */ path) => new Uint8Array(readFileSync(join(EXAMPLES, path)));
const fixture = (/** @type {RegExp} */ pattern) => {
  const path = configuredFixtures(pattern)[0];
  return path === undefined ? null : new Uint8Array(readFileSync(path));
};

const BIT_XY = 'BIT n,(HL) and BIT n,(IX+d): the reference clears flags 3 and 5';
const BLOCK_XY = 'repeating LDIR/LDDR/CPIR/CPDR: flags 3 and 5 from PC';
const EX_SP = 'EX (SP),rr: the reference writes (SP) before (SP+1)';
const IO = 'IN and block I/O: the reference counts one T-state less';
const SCF_CCF = 'SCF/CCF: the reference takes flags 3 and 5 from A alone';
const VIDEO_READ = 'video read: the reference returns bit 6 as written (no gate)';

/** The Eliminator script: ENTER at the title, one player, then play. */
const ELIMINATOR = [press(2, 'ENTER'), press(5, '1'), press(8, 'SPACE', 1), press(10, 'LEFT', 1), press(12, 'RIGHT', 1)];
const ELIMINATOR_SCREENS = ['BY: WAYNE WESTMORELAND & TERRY GILMAN', 'TO START', 'HIGH SCORES', '1 OR 2 PLAYERS?', 'SHIPS: 4 BOMBS: 3', 'GAME OVER PLAYER 1'];
/** Space Warp: level 1, then a key at the mission screen. */
const SPACE_WARP = [press(2, '1'), press(3, 'ENTER'), press(9, '1'), press(10, 'ENTER')];
const SPACE_WARP_SCREENS = ['WHAT LEVEL DO YOU WISH TO PLAY (1-10)?', 'YOUR MISSION:', 'COMMAND?'];

/** @type {Session[]} */
const SESSIONS = [
  {
    // The Model I-only build (it rebuilds the cassette system area from the ROM at $06D2).
    name: 'eliminator/elimin8a.cmd',
    program: example('eliminator/elimin8a.cmd'),
    keys: ELIMINATOR,
    screens: ELIMINATOR_SCREENS,
    known: { [XTRS]: { [BIT_XY]: 12_315, [BLOCK_XY]: 910_787, [EX_SP]: 6_418 }, [MAME]: { [VIDEO_READ]: 158 } },
  },
  {
    // The $4900 build. On the Model III it never takes the 1 (its keyboard DCB's driver, $4016,
    // points at $03E3, the Model I ROM's keyboard driver: spec §11, phase 7); on the Model I that
    // is the driver, and it plays.
    name: 'eliminator/elimin8c.cmd',
    program: example('eliminator/elimin8c.cmd'),
    keys: ELIMINATOR,
    screens: ELIMINATOR_SCREENS,
    known: { [XTRS]: { [BIT_XY]: 13_265, [BLOCK_XY]: 912_897, [EX_SP]: 6_314 }, [MAME]: { [VIDEO_READ]: 158 } },
  },
  {
    // ENTER, 1 player, Novice, then play with the sub moving and firing.
    name: 'sea-dragon/seadrg01.cmd',
    program: example('sea-dragon/seadrg01.cmd'),
    keys: [press(6, 'ENTER'), press(9, '1'), press(12, '0'), press(15, 'SPACE', 2), press(18, 'UP', 1), press(20, 'DOWN', 1), press(22, 'RIGHT', 2)],
    screens: ['BY: WAYNE WESTMORELAND & TERRY GILMAN', 'TO BEGIN', '1 OR 2 PLAYERS?', 'PLAYER 1: SKILL LEVEL', 'SHIPS 4', 'GAME OVER PLAYER 1'],
    known: { [XTRS]: { [BIT_XY]: 396_000, [BLOCK_XY]: 755_064, [IO]: 460 }, [MAME]: { [VIDEO_READ]: 228 } },
  },
  {
    // ENTER, 1 player, then play: like Eliminator c, it takes the 1 on the Model I.
    name: 'rear-guard/reargrd5.cmd',
    program: example('rear-guard/reargrd5.cmd'),
    keys: [press(4, 'ENTER'), press(7, '1'), press(10, 'SPACE', 1), press(12, 'UP', 1), press(14, 'DOWN', 1)],
    screens: ['TO BEGIN', 'HIGH SCORES', '1 OR 2 PLAYERS?', 'SHIPS:4 SHIELD:35', 'GAME OVER PLAYER 1'],
    known: { [XTRS]: { [BIT_XY]: 90_086, [BLOCK_XY]: 1_677_314, [IO]: 1_889 }, [MAME]: { [VIDEO_READ]: 1_332 } },
  },
  { name: 'Space Warp 1 (spcwarp1.cmd)', program: fixture(/spcwarp1\.cmd$/), keys: SPACE_WARP, screens: SPACE_WARP_SCREENS, known: { [XTRS]: { [BLOCK_XY]: 3_148 }, [MAME]: { [VIDEO_READ]: 1 } } },
  { name: 'Space Warp 3 (spcwarp3.cmd)', program: fixture(/spcwarp3\.cmd$/), keys: SPACE_WARP, screens: SPACE_WARP_SCREENS, known: { [XTRS]: { [BLOCK_XY]: 3_177 }, [MAME]: { [VIDEO_READ]: 1 } } },
  {
    // No to the restore, then a word the parser does not know.
    name: 'Asylum 16K (asylum16.cmd)',
    program: fixture(/asylum16\.cmd$/),
    keys: [press(3, 'N'), press(4, 'ENTER'), press(8, 'N'), press(9, 'ENTER')],
    screens: ['RESTORE AN OLD GAME (Y OR N)?', '09:30', 'WHAT IS:'],
    known: { [XTRS]: { [BIT_XY]: 166, [BLOCK_XY]: 6_122 }, [MAME]: { [VIDEO_READ]: 2 } },
  },
  {
    // Its credits first, then the same.
    name: 'Asylum 32K (asylum32.cmd)',
    program: fixture(/asylum32\.cmd$/),
    keys: [press(12, 'N'), press(13, 'ENTER'), press(17, 'N'), press(18, 'ENTER')],
    screens: ['A FRANK CORR / WILLIAM DENMAN PRODUCTION', 'DO YOU WISH TO RESTORE AN OLD GAME (Y OR N)?', '09:30', "I DON'T KNOW THE FOLLOWING WORD:"],
    known: { [XTRS]: { [BIT_XY]: 166, [BLOCK_XY]: 25_983 }, [MAME]: { [VIDEO_READ]: 53 } },
  },
  {
    // ENTER, one player, skill 0, then the painter round the board.
    name: 'Crazy Painter (crzpnt01.cmd)',
    program: fixture(/crzpnt01\.cmd$/),
    keys: [press(8, 'ENTER'), press(10, '1'), press(12, '0'), press(15, 'RIGHT', 1), press(17, 'DOWN', 1), press(19, 'LEFT', 1), press(21, 'UP', 1)],
    screens: ['(C) 1982 CORNSOFT GROUP', 'HOW.MANY.PLAYERS?', 'SKILL.LEVEL', 'READY.PLAYER.1'],
    known: { [XTRS]: { [BLOCK_XY]: 3_934, [IO]: 1_263 }, [MAME]: { [VIDEO_READ]: 3 } },
  },
  {
    // No to the old game, a key into the maze, then a word it does not take.
    name: 'Deathmaze 5000 (dthmz5k1.cmd)',
    program: fixture(/dthmz5k1\.cmd$/),
    keys: [press(3, 'N'), press(4, 'ENTER'), press(8, 'U'), press(9, 'ENTER')],
    screens: ['DO YOU WISH TO LOAD AN OLD GAME (Y OR N)?', 'PRESS ANY KEY TO ENTER DEATHMAZE 5000', 'INVENTORY'],
    known: { [XTRS]: { [BLOCK_XY]: 16_359 }, [MAME]: { [VIDEO_READ]: 682 } },
  },
  {
    // No to the saved game, then a command.
    name: "Pirate's Adventure (pirate.cmd)",
    program: fixture(/pirate\.cmd$/),
    keys: [press(3, 'N'), press(4, 'ENTER'), press(8, 'L'), press(9, 'ENTER')],
    screens: ['WANT TO RESTORE A PREVIOUSLY SAVED GAME?', 'I AM IN A FLAT IN LONDON', 'TELL ME WHAT TO DO?'],
    known: { [XTRS]: { [BLOCK_XY]: 17_700, [SCF_CCF]: 46 }, [MAME]: { [VIDEO_READ]: 1_912 } },
  },
  {
    // It plays at once; fire and move.
    name: 'Volcano (volcano.cmd)',
    program: fixture(/volcano\.cmd$/),
    keys: [press(2, 'SPACE', 1), press(4, 'LEFT', 1), press(6, 'RIGHT', 1), press(8, 'SPACE', 1)],
    screens: ['MEN :', 'SCORE :'],
    known: { [XTRS]: { [BIT_XY]: 8_265, [BLOCK_XY]: 96_922, [IO]: 1_597 }, [MAME]: { [VIDEO_READ]: 177 } },
  },
  {
    // CLEAR to start, one player (the 1 is taken), then fire and move: its play screen is the
    // score and three ships ('[[[') on the top line, losing them one by one to GAME OVER at about
    // 55 s. It writes its credits in lowercase.
    name: 'Super Nova (supnov3a.cmd)',
    program: fixture(/supnov3a\.cmd$/),
    keys: [press(9, 'CLEAR'), press(11, '1'), press(14, 'SPACE', 1), press(16, 'LEFT', 1), press(18, 'RIGHT', 1), press(20, 'SPACE', 1)],
    screens: ['SOFTWARE CO.', 'NUMBER OF PLAYERS (1 OR 2) ?', '0.[[[', 'GAME OVER PLAYER 1'],
    known: { [XTRS]: { [BIT_XY]: 655, [BLOCK_XY]: 2_210_006, [IO]: 2_025 }, [MAME]: { [VIDEO_READ]: 3 } },
  },
];

/** A session's key events, from its presses' times after the load. @param {Press[]} keys */
const sessionKeys = (keys) => keyEvents(keys.map((k) => ({ at: LOAD_AT + k.at * HZ, key: k.key, hold: k.hold * HZ })));

/**
 * A Model I from power-on to the load's T-state, ENTER at MEM SIZE? through the matrix (as
 * compareRun delivers keys: at the first boundary at or after their T-state).
 * @param {Uint8Array} rom
 */
function toLoad(rom) {
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
function screenOf(bytes, columns32) {
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
function checkpoints(m, ref, screens) {
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
const explain = (r) => (r.divergence === null ? '' : formatReport(r));

/**
 * A session against xtrs: ours from power-on to the load, then 10 million instructions in lockstep.
 * @param {Session} s
 */
function xtrsSession(s) {
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
 * ours from power-on on MAME's 40 Hz schedule, the folder deleted after.
 * @param {Session} s
 */
async function mameSession(s) {
  const rom = requireRom('model1-mame');
  const program = /** @type {Uint8Array} */ (s.program);
  const dir = mkdtempSync(join(tmpdir(), 'fugloy-m1-session-'));
  try {
    const out = join(dir, 'session.fmt');
    await recordMameTrace({ instructions: INSTRUCTIONS, matrix: [...BOOT, ...sessionKeys(s.keys)], load: { program, at: LOAD_AT }, out });
    const ref = openTrace(out, { program });
    try {
      const m = mameTimer(new Machine({ model: 1, roms: { level2: rom } }));
      const check = checkpoints(m, ref, s.screens);
      const result = compareRun({ machine: m, reference: ref, instructions: ref.header.requested, progress: { every: CHECK_EVERY, fn: check.fn } });
      return { result, seen: check.seen, videoEqual: check.videoEqual, header: ref.header };
    } finally {
      ref.close?.();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe.skipIf(xtrsSkip !== null || sessionSkip !== null)(`the Model I sessions against xtrs${xtrsSkip === null && sessionSkip === null ? '' : ` (skipped: ${xtrsSkip ?? sessionSkip})`}`, { timeout: 1_200_000 }, () => {
  for (const s of SESSIONS) {
    it.skipIf(s.program === null)(`${s.name}: 10 million instructions in lockstep with no unexplained divergence`, () => {
      const { result, seen, videoEqual } = xtrsSession(s);
      expect(explain(result)).toBe('');
      expect(result.instructions).toBe(INSTRUCTIONS);
      expect(seen).toEqual(s.screens);
      expect(videoEqual).toBe(true);
      expect(result.known).toEqual(s.known[XTRS]);
    });
  }
});

describe.skipIf(mameSkip !== null || sessionSkip !== null)(`the Model I sessions against MAME${mameSkip === null && sessionSkip === null ? '' : ` (skipped: ${mameSkip ?? sessionSkip})`}`, { timeout: 1_800_000, concurrent: true }, () => {
  for (const s of SESSIONS) {
    it.skipIf(s.program === null)(`${s.name}: the boot and 10 million instructions past the load, following MAME, with no unexplained divergence`, async () => {
      const { result, seen, videoEqual, header } = await mameSession(s);
      expect(explain(result)).toBe('');
      expect(result.ended).toBeUndefined();
      expect(header).toMatchObject({ complete: true, verified: true });
      expect(result.instructions).toBe(header.requested);
      expect(header.requested - /** @type {import('./mame-trace.js').TraceLoad} */ (header.load).at).toBe(INSTRUCTIONS);
      expect(seen).toEqual(s.screens);
      expect(videoEqual).toBe(true);
      expect(result.known).toEqual(s.known[MAME]);
    });
  }
});

// --- Typing at 20 characters a second under Level II (Review Focus 4; spec §5) ---------------

/** Typed at READY: a BASIC line and ENTER. */
const TYPED = 'PRINT 1\n';
/** What BASIC makes of TYPED when every key arrives. */
const WHOLE = ['>PRINT 1', ' 1', 'READY', '>_'];

/**
 * The key events m.keyboard.type makes for `text` at `cps` from T-state `at`: each key pressed for
 * half a 1/cps-second window (or `hold` T-states) and released for the rest.
 * @param {string} text @param {number} cps @param {number} at @param {number} [hold]
 */
function typing(text, cps, at, hold) {
  const period = Math.round(HZ / cps);
  return keyEvents(Array.from(text, (ch, k) => ({ at: at + k * period, key: ch === '\n' ? 'ENTER' : ch, hold: hold ?? Math.round(period / 2) })));
}

/** The screen's lines after READY (the first three are MEM SIZE?, R/S L2 BASIC and READY). @param {Uint8Array} video */
const afterReady = (video) => screenOf(video, false).split('\n').slice(3).map((l) => l.trimEnd()).filter((l) => l !== '');

/**
 * Log the Level II 1.3 keyboard driver's decisions on our machine (MDL1LEV2.Z80): KBDDRV finding a
 * newly pressed key (KEYDWN, $03FA); KEYBOU's re-read of its row after the 18.8 ms debounce delay
 * (`ret z` at $0126: Z set, the key is gone and the driver returns no key); KEYRTN taking the key
 * ($044C, A the character), which then waits 51.3 ms (a PAUSE of 3,500) before it returns.
 * @param {Machine} m
 */
function driverLog(m) {
  const cpu = m.system.cpu;
  const exec = cpu.executeInstruction;
  /** @type {{ at: number, what: string }[]} */
  const log = [];
  cpu.executeInstruction = () => {
    const pc = cpu.registers.PC;
    if (pc === 0x03fa) log.push({ at: cpu.cycles, what: 'seen' });
    else if (pc === 0x0126) log.push({ at: cpu.cycles, what: (cpu.registers.F & 0x40) !== 0 ? 'gone' : 'held' });
    else if (pc === 0x044c) log.push({ at: cpu.cycles, what: String.fromCharCode(cpu.registers.A) });
    return exec.call(cpu);
  };
  return log;
}

/** Why the typing tests skip: they are about Level II 1.3's keyboard driver (KEYBOU is 1.3's). */
const typingSkip = rom1 === null ? 'no roms.model1'
  : level2v13 ? null
    : 'roms.model1 is not Level II 1.3, whose keyboard driver these tests are about';

describe.skipIf(typingSkip !== null)(`typing at 20 characters a second under Level II 1.3, on ours${typingSkip === null ? '' : ` (skipped: ${typingSkip})`}`, { timeout: ROM_TEST_TIMEOUT }, () => {
  it('drops every other key: a key pressed during the last one\'s 51.3 ms wait is released before the 18.8 ms debounce re-reads it', () => {
    const m = toLoad(/** @type {Uint8Array} */ (rom1));
    const log = driverLog(m);
    m.keyboard.type(TYPED, { cps: 20 });
    m.run({ cycles: 2 * HZ });
    expect(afterReady(m.mem.read(0x3c00, 0x400))).toEqual(['>PIT1_']);
    // Each of the eight keys is seen; the re-read keeps P, I, T and 1 and finds R, N, the space and
    // ENTER released: each was pressed 50 ms after the key before, while the driver waited.
    expect(log.map((e) => e.what).join(' ')).toBe('seen held P seen gone seen held I seen gone seen held T seen gone seen held 1 seen gone');
    for (let k = 0; k < log.length; k++) {
      const e = log[k];
      // The debounce: PAUSE with BC = $0500, 1,280 rounds of 26 T-states (18.8 ms), after KEYDWN.
      if (e.what === 'held' || e.what === 'gone') expect(e.at - log[k - 1].at).toBeGreaterThanOrEqual(1280 * 26);
      // KEYRTN's wait: PAUSE with BC = 3,500 (51.3 ms) before the driver looks again.
      if (e.what.length === 1 && k + 1 < log.length) expect(log[k + 1].at - e.at).toBeGreaterThanOrEqual(3500 * 26);
    }
  });

  it('at 10 a second (each key held 50 ms, 50 ms apart) every key arrives', () => {
    const m = toLoad(/** @type {Uint8Array} */ (rom1));
    const log = driverLog(m);
    m.keyboard.type(TYPED, { cps: 10 });
    m.run({ cycles: 2 * HZ });
    expect(afterReady(m.mem.read(0x3c00, 0x400))).toEqual(WHOLE);
    expect(log.filter((e) => e.what === 'gone')).toEqual([]);
  });
});

describe.skipIf(xtrsSkip !== null || typingSkip !== null)(`typing at 20 characters a second under Level II 1.3, against xtrs${xtrsSkip === null && typingSkip === null ? '' : ` (skipped: ${xtrsSkip ?? typingSkip})`}`, { timeout: 300_000 }, () => {
  it.each([
    { cps: 20, lines: ['>PIT1_'], known: {} },
    // PRINT runs: BASIC's EX (SP),HL, which xtrs writes low byte first (known.js).
    { cps: 10, lines: WHOLE, known: { [EX_SP]: 8 } },
  ])('at $cps a second xtrs, in lockstep, takes exactly the keys ours takes', ({ cps, lines, known }) => {
    const rom = requireRom('model1');
    const m = toLoad(rom);
    const ref = loadXtrs({ rom });
    try {
      const r = compareRun({ machine: m, reference: ref, instructions: 1_000_000, keys: typing(TYPED, cps, LOAD_AT) });
      expect(explain(r)).toBe('');
      expect(r.known).toEqual(known);
      expect(afterReady(ref.peek(0x3c00, 0x400))).toEqual(lines);
      expect(afterReady(m.mem.read(0x3c00, 0x400))).toEqual(lines);
    } finally {
      ref.close?.();
    }
  });
});

describe.skipIf(mameSkip !== null || typingSkip !== null)(`typing at 20 characters a second under Level II 1.3, against MAME${mameSkip === null && typingSkip === null ? '' : ` (skipped: ${mameSkip ?? typingSkip})`}`, { timeout: 600_000, concurrent: true }, () => {
  // MAME sets a key on its matrix at a frame (1/60 s), so a press lasts whole frames: held 25 ms
  // (m.keyboard.type's 20 a second) it shows for one frame, 16.7 ms, under the 18.8 ms debounce, and
  // no key arrives; held 35 ms it shows for two, 33.3 ms, and MAME drops every other key as ours
  // and xtrs do; at 10 a second (50 ms, three frames) every key arrives.
  it.each([
    { cps: 20, holdMs: 25, lines: ['>_'] },
    { cps: 20, holdMs: 35, lines: ['>PIT1_'] },
    { cps: 10, holdMs: 50, lines: WHOLE },
  ])('at $cps a second, each key held $holdMs ms: MAME shows $lines', async ({ cps, holdMs, lines }) => {
    const rom = requireRom('model1-mame');
    const dir = mkdtempSync(join(tmpdir(), 'fugloy-m1-typing-'));
    try {
      const out = join(dir, 'typing.fmt');
      const rec = await recordMameTrace({ instructions: 1_700_000, matrix: [...BOOT, ...typing(TYPED, cps, LOAD_AT, Math.round(holdMs * HZ / 1000))], out });
      const ref = openTrace(out);
      try {
        const m = mameTimer(new Machine({ model: 1, roms: { level2: rom } }));
        const r = compareRun({ machine: m, reference: ref, instructions: rec.instructions });
        expect(explain(r)).toBe('');
        expect(r.ended).toBeUndefined();
        expect(afterReady(ref.peek(0x3c00, 0x400))).toEqual(lines);
        expect(afterReady(m.mem.read(0x3c00, 0x400))).toEqual(lines);
      } finally {
        ref.close?.();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
