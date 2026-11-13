/**
 * Sea Dragon's three scripted games (M2 Task 3), each played on @fugloy/emu from the game's own entry
 * ($497F, after the loader's mover has run) to GAME OVER and back to the title: `novice`, `expert` and
 * `two-players`. They are what the census watches (tools/census.ts) and, recorded as steps
 * (`recordSession`), what the referee replays on the port.
 *
 * A session waits for the title, holds ENTER, answers `1 or 2 Players?` and each player's skill prompt,
 * then plays a repeating pattern of key chords, each held 0.2 s (the patterns measured before the plan:
 * docs/superpowers/plans/2026-11-13-part2-m2-sea-dragon-port.md, "The sessions"), until the screen reads
 * `Game Over Player 1` (`Player 2` for two players; the game writes it on row 4, not the bottom row the
 * plan's brief names, where the ships and scores stay); then it lets go of every key and runs until
 * the title returns.
 *
 * Every key is pressed and released, and every row read for a check, at the start of one of the port's
 * blocks (an IR block of the hinted image, the loader's left out), the first at or after the time the
 * script wants it. The referee applies a step at the first block start at or after its T-state, so a
 * recorded session replays on the port at exactly the instructions it was played at on emu.
 */
import { readFileSync } from 'node:fs';
import { Machine } from '@fugloy/emu';
import { prepare } from '../../src/port.js';
import { gameStubRom } from '../game-rom.js';
import type { Step } from '../referee.js';

export const SEA_DRAGON = new Uint8Array(readFileSync(new URL('../../../../examples/sea-dragon/seadrg01.cmd', import.meta.url)));
export const SEA_DRAGON_HINTS = readFileSync(new URL('../../../../examples/sea-dragon/seadrg01.hints', import.meta.url), 'utf8');

/** The ROM a session runs on: 'game', Fugløy's game stub ROM (game-rom.ts), or a Model III ROM's bytes (the user's, locally). */
export type SessionRom = 'game' | Uint8Array;

/** A scripted game: `play` takes a fresh machine at the game's entry (`machineAtEntry`) and plays it to the title's return. */
export interface Session {
  name: string;
  play(m: Machine): void;
}

// ---- the game's entry and the port's block starts, from the hinted IR

let analysed: { entry: number; blockStart: Uint8Array } | undefined;
/** Sea Dragon's entry (the hint file's, $497F) and, by address, 1 where one of the port's blocks starts. */
function analysis(): { entry: number; blockStart: Uint8Array } {
  if (analysed === undefined) {
    const p = prepare(SEA_DRAGON, { model: 3, hints: SEA_DRAGON_HINTS, runtimeImport: '@fugloy/runtime/ops' });
    if (!p.ok) throw new Error(`Sea Dragon did not analyse: ${p.errors.join(' ')}`);
    const blockStart = new Uint8Array(0x10000);
    for (const b of p.prepared.ir.blocks) if (!p.prepared.loaderBlocks.has(b.start)) blockStart[b.start] = 1;
    analysed = { entry: p.prepared.entry, blockStart };
  }
  return analysed;
}

/** Sea Dragon's entry, the port's `entryAddr`: where its own code starts, after the loader's mover. */
export const seaDragonEntry = (): number => analysis().entry;

// ---- a machine at the entry, and what a session's helpers keep for it

interface Context {
  /** The T-state at the entry: the steps' clock starts here. */
  entryT: number;
  /** The keys held now, by name. */
  held: Set<string>;
  /** While a session is recorded: each step and the T-state (from the entry) it applies at. */
  events: { t: number; step: Exclude<Step, { run: number }> }[] | null;
}
const contexts = new WeakMap<Machine, Context>();
const contextOf = (m: Machine): Context => {
  const c = contexts.get(m);
  if (c === undefined) throw new Error('a session plays a machine machineAtEntry made');
  return c;
};

const second = (m: Machine, s: number): number => Math.round(s * m.clockHz);
const screen = (m: Machine): string => m.video.text().join('\n');

/** Runs in 1/60 s slices until the screen shows `text`, or throws a sentence after `seconds`. */
function waitForScreen(m: Machine, text: string, seconds: number, what: string): void {
  for (let k = 0; !screen(m).includes(text); k++) {
    if (k >= seconds * 60) throw new Error(`${what}: no "${text}" on the screen within ${seconds} s:\n${screen(m)}`);
    m.run({ cycles: second(m, 1 / 60) });
  }
}

/** ENTER held 50 ms of emulated time at a ROM prompt, as `m.keyboard.type` holds a key at its 10 cps. */
function enter(m: Machine): void {
  m.keyboard.press('ENTER');
  m.run({ cycles: second(m, 0.05) });
  m.keyboard.release('ENTER');
  m.run({ cycles: second(m, 0.05) });
}

/**
 * A fresh Model III at a program's entry (by default Sea Dragon's). On 'game' the game stub ROM starts
 * and halts, as the referee boots it; on a ROM's bytes the ROM is booted to READY (ENTER at Cass? and
 * at Memory Size?; controller Ruling 5: interrupts are off when the .CMD loads, and Sea Dragon's first
 * instruction is DI). Then the .CMD is loaded and run, through its loader, to `entry`.
 */
export function machineAtEntry(rom: SessionRom, cmd: Uint8Array = SEA_DRAGON, entry: number = seaDragonEntry()): Machine {
  const m = new Machine({ model: 3, roms: { level2: rom === 'game' ? gameStubRom(3) : rom } });
  if (rom === 'game') {
    if (m.run({ until: 'halt', cycles: m.clockHz }).reason !== 'halt') throw new Error('the game stub ROM did not start and halt');
  } else {
    waitForScreen(m, 'Cass?', 2, 'booting the ROM');
    enter(m);
    waitForScreen(m, 'Memory Size?', 2, 'booting the ROM');
    enter(m);
    waitForScreen(m, 'READY', 2, 'booting the ROM');
    m.run({ cycles: second(m, 1 / 4) });
  }
  m.load.cmd(cmd);
  const cpu = m.system.cpu;
  for (let n = 0; cpu.registers.PC !== entry; n++) {
    if (n >= 10_000_000) throw new Error(`the program's loader did not reach its entry, $${entry.toString(16).toUpperCase()}, in 10,000,000 instructions`);
    m.step();
  }
  contexts.set(m, { entryT: m.cycles, held: new Set(), events: null });
  return m;
}

// ---- what a session does

/** The T-state now, from the entry. */
const now = (m: Machine): number => m.cycles - contextOf(m).entryT;
const record = (m: Machine, step: Exclude<Step, { run: number }>): void => {
  contextOf(m).events?.push({ t: now(m), step });
};

/**
 * Waits for a row holding `text`, runs to a block start, and records a check of that row as it reads
 * there: the referee checks it at the same instruction, so a row the game is still drawing reads the same.
 */
function waitForRow(m: Machine, text: string, seconds: number, what: string): void {
  waitForScreen(m, text, seconds, what);
  toBlockStart(m);
  const rows = m.video.text();
  const row = rows.findIndex((r) => r.includes(text));
  record(m, { row, text: rows[row]!.trimEnd() });
}

/**
 * The longest `toBlockStart` runs looking for a block start: two seconds of the clock. The longest stretch
 * the game spends outside its blocks is a $DELAY of BC = 0, 1,966,095 T-states, under one second.
 */
const BLOCK_START_LIMIT_S = 2;

/** Runs to the first start of one of the port's blocks, unless the PC is at one now; a sentence if none comes. */
function toBlockStart(m: Machine): void {
  const { blockStart } = analysis();
  const cpu = m.system.cpu;
  if (blockStart[cpu.registers.PC!] === 1) return;
  const r = m.run({ cycles: second(m, BLOCK_START_LIMIT_S), until: () => blockStart[cpu.registers.PC!] === 1 });
  if (r.reason !== 'predicate') {
    throw new Error(`no block of the port started in ${BLOCK_START_LIMIT_S} s of the clock (the run stopped for ${r.reason}); emu's PC is $${cpu.registers.PC!.toString(16).toUpperCase().padStart(4, '0')}`);
  }
}

/** Runs to `t` (from the entry), or on at once when it has passed. */
const runTo = (m: Machine, t: number): void => {
  if (now(m) < t) m.run({ cycles: t - now(m) });
};

/** From the keys held to `keys`, at a block start: the keys not in `keys` released, then the new ones pressed. */
function hold(m: Machine, keys: readonly string[]): void {
  const c = contextOf(m);
  toBlockStart(m);
  for (const k of [...c.held]) {
    if (keys.includes(k)) continue;
    m.keyboard.release(k);
    c.held.delete(k);
    record(m, { release: k });
  }
  for (const k of keys) {
    if (c.held.has(k)) continue;
    m.keyboard.press(k);
    c.held.add(k);
    record(m, { press: k });
  }
}

/**
 * Holds `key` for half a second, lets go, and waits half a second more: an answer to one of the game's
 * prompts. The game takes a key only after it has seen none held, so the next answer must not follow at
 * once.
 */
function answer(m: Machine, key: string): void {
  hold(m, [key]);
  runTo(m, now(m) + second(m, 0.5));
  hold(m, []);
  runTo(m, now(m) + second(m, 0.5));
}

/** The screen shows `text`. */
const shows = (m: Machine, text: string): boolean => screen(m).includes(text);

/** The longest a game may take from its first chord to GAME OVER before the session gives up, by default. */
const GAME_LIMIT_S = 180;
/** How long a chord is held. */
const CHORD_S = 0.2;

/**
 * A session: the title, ENTER, the number of players and each player's skill, then `pattern` (a list of
 * chords, each a list of keys) over and over, each chord held 0.2 s, until the screen reads
 * `Game Over Player <last>`; then every key let go, and on until the title returns. A game that has not
 * ended `gameLimit` seconds after its first chord (180 by default) throws a sentence saying so.
 */
export function seaDragonSession(
  name: string,
  skills: readonly ('0' | '1')[],
  pattern: readonly (readonly string[])[],
  { gameLimit = GAME_LIMIT_S }: { gameLimit?: number } = {},
): Session {
  return {
    name,
    play(m: Machine): void {
      const what = `Sea Dragon's ${name} session`;
      waitForRow(m, 'BY: Wayne', 10, what);
      runTo(m, now(m) + second(m, 0.5));
      answer(m, 'ENTER');
      waitForRow(m, '1 or 2 Players?', 3, what);
      answer(m, String(skills.length));
      skills.forEach((skill, k) => {
        waitForRow(m, `Player ${k + 1}: Skill level`, 3, what);
        answer(m, skill);
      });
      const gameOver = `Game Over Player ${skills.length}`;
      const start = now(m);
      const chord = second(m, CHORD_S);
      const tick = second(m, 1 / 60);
      for (let k = 0; ; k++) {
        if (k * CHORD_S >= gameLimit) throw new Error(`${what}: no "${gameOver}" on the screen within ${gameLimit} s of play:\n${screen(m)}`);
        runTo(m, start + k * chord);
        hold(m, pattern[k % pattern.length]!);
        const until = start + (k + 1) * chord;
        while (now(m) < until && !shows(m, gameOver)) runTo(m, Math.min(until, now(m) + tick));
        if (shows(m, gameOver)) break;
      }
      waitForRow(m, gameOver, 0, what);
      hold(m, []);
      waitForScreen(m, 'BY: Wayne', 20, what);
    },
  };
}

/** The three games, with the key patterns measured before the plan; two players at Novice and Expert, as measured. */
export const SESSIONS: readonly Session[] = [
  seaDragonSession('novice', ['0'], [['UP', 'SPACE'], ['UP']]),
  seaDragonSession('expert', ['1'], [['RIGHT'], ['UP'], ['SPACE'], ['DOWN', 'SPACE'], ['ENTER'], ['UP', 'SPACE'], [], ['LEFT']]),
  seaDragonSession('two-players', ['0', '1'], [['SPACE'], [], ['UP', 'ENTER'], ['DOWN'], ['SHIFT', 'UP'], ['RIGHT', 'SPACE']]),
];

/**
 * Plays `session` on a fresh machine at the entry and returns it as the referee's steps: each key
 * pressed and released, a check of the title row, of each prompt's row and of the GAME OVER row, each
 * at the T-state (from the entry) it happened at, the `run`s between them, and a last `run` to the
 * session's end, when the title has returned.
 */
export function recordSession(rom: SessionRom, s: Session): Step[] {
  const m = machineAtEntry(rom);
  const c = contextOf(m);
  c.events = [];
  s.play(m);
  const steps: Step[] = [];
  let t = 0;
  for (const e of c.events) {
    if (e.t > t) steps.push({ run: e.t - t });
    t = e.t;
    steps.push(e.step);
  }
  steps.push({ run: Math.max(1, now(m) - t) });
  return steps;
}
