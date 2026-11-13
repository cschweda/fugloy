/**
 * @fugloy/recomp, M2 Task 3: Sea Dragon's three scripted games (test/sessions/sea-dragon.ts), the census
 * that watches them on @fugloy/emu (tools/census.ts), and the trace file it writes
 * (examples/sea-dragon/seadrg01.trace.json, `pnpm census`; docs/port-trace-format.md). All on Fugløy's game
 * stub ROM, Model III: no ROM of the user's is needed.
 *
 * The three games are about 255 million T-states, and the census watches them with emu's hooks on, so
 * each session is played once for the census and twice recorded, all in `beforeAll`, and the
 * assertions share the results.
 */
import { readFileSync } from 'node:fs';
import { programHash } from '@fugloy/disasm';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseTrace } from '../src/index.js';
import type { PortTrace } from '../src/index.js';
import { census, markedRead } from '../tools/census.js';
import { gameStubRom } from './game-rom.js';
import type { Step } from './referee.js';
import { SEA_DRAGON, SEA_DRAGON_HINTS, SESSIONS, recordSession, seaDragonSession } from './sessions/sea-dragon.js';

const TRACE = new URL('../../../examples/sea-dragon/seadrg01.trace.json', import.meta.url);
/** How long `beforeAll` may take: the three games played three times, once with the census's hooks. */
const PLAY_TIMEOUT = 300_000;

let recorded: { name: string; first: Step[]; second: Step[] }[];
let trace: PortTrace;

beforeAll(() => {
  recorded = SESSIONS.map((s) => ({ name: s.name, first: recordSession('game', s), second: recordSession('game', s) }));
  trace = census({ cmd: SEA_DRAGON, name: 'seadrg01.cmd', hints: SEA_DRAGON_HINTS, model: 3, rom: 'game', sessions: SESSIONS });
}, PLAY_TIMEOUT);

const rows = (steps: readonly Step[]): string[] => steps.flatMap((s) => ('row' in s ? [s.text] : []));
const length = (steps: readonly Step[]): number => steps.reduce((n, s) => n + ('run' in s ? s.run : 0), 0);

describe("Sea Dragon's three games on the game stub ROM", () => {
  it.each([
    ['novice', ['Player 1: Skill level'], 'Game Over Player 1'],
    ['expert', ['Player 1: Skill level'], 'Game Over Player 1'],
    ['two-players', ['Player 1: Skill level', 'Player 2: Skill level'], 'Game Over Player 2'],
  ])('%s: the title, the prompts, GAME OVER, recorded as steps the same twice', (name, prompts, gameOver) => {
    const r = recorded.find((x) => x.name === name)!;
    const checks = rows(r.first);
    expect(checks).toHaveLength(3 + prompts.length);
    expect(checks[0]).toContain('BY: Wayne');
    expect(checks[1]).toContain('1 or 2 Players?');
    prompts.forEach((p, k) => expect(checks[2 + k]).toContain(p));
    expect(checks.at(-1)).toContain(gameOver);
    // Only the referee's forms, every run positive, a run last
    for (const s of r.first) expect(Object.keys(s).sort().join(',')).toMatch(/^(run|press|release|row,text)$/);
    expect(r.first.every((s) => !('run' in s) || (Number.isInteger(s.run) && s.run > 0))).toBe(true);
    expect('run' in r.first.at(-1)!).toBe(true);
    // Every key let go by the end
    const held = new Set<string>();
    for (const s of r.first) {
      if ('press' in s) held.add(s.press);
      if ('release' in s) held.delete(s.release);
    }
    expect([...held]).toEqual([]);
    expect(r.second, 'the same steps twice').toEqual(r.first);
    // The census played the same game, to the same end
    expect(trace.sessions.find((s) => s.name === name)?.cycles).toBe(length(r.first));
  });
});

describe('a session that never reaches GAME OVER', () => {
  it('throws a sentence when its game has not ended within its limit', () => {
    // No key at all, for two seconds of play: far too soon for the game to end
    const idle = seaDragonSession('idle', ['0'], [[]], { gameLimit: 2 });
    expect(() => recordSession('game', idle)).toThrow(/^Sea Dragon's idle session: no "Game Over Player 1" on the screen within 2 s of play/);
  }, 60_000);
});

describe("Sea Dragon's census", () => {
  it('finds the eight sites the game rewrites (nine cells), with their writers, and the opcode cells with two values each', () => {
    const writers = Object.fromEntries(trace.patches.map((p) => [p.addr, p.writers]));
    expect(writers).toEqual({
      0x49c1: [0x49bc],
      0x4f41: [0x4f3c],
      0x509b: [0x4d00, 0x4d3a],
      0x509c: [0x4d00, 0x4d3a],
      0x5174: [0x5c60, 0x5d5e, 0x5d77, 0x5db6, 0x5dcd],
      0x525e: [0x4d0b, 0x4d4c],
      0x5ad0: [0x5ac7],
      0x5add: [0x5acb],
      0x5aea: [0x4d54, 0x5aef],
    });
    const values = (addr: number): number[] => trace.patches.find((p) => p.addr === addr)!.values;
    // The opcode swaps: JP NZ / JP Z, LD (HL),A / NOP, CALL / RET
    expect(values(0x525e)).toEqual([0xc2, 0xca]);
    expect(values(0x5174)).toEqual([0x00, 0x77]);
    expect(values(0x5aea)).toEqual([0xc9, 0xcd]);
    // The JP at $509A: to $509D or $50C1
    expect(values(0x509b)).toEqual([0x9d, 0xc1]);
    expect(values(0x509c)).toEqual([0x50]);
  });

  it('finds no code the disassembly does not reach, one drop, and two ROM reads', () => {
    // $50C1-$50E9, which only the rewritten JP at $509A reaches, ran in every game; the hint file's entry
    // at $50C1 (M2 Task 4) decodes it, so nothing that ran lies outside the hinted IR's code
    expect(trace.entered).toEqual([]);
    expect(trace.drops.map((d) => d.at)).toEqual([0x4bac]);
    expect(trace.romReads).toEqual([
      { addr: 0x0000, value: 0xf3 },
      { addr: 0x0003, value: gameStubRom(3)[0x0003] },
    ]);
    expect(trace).toMatchObject({ 'fugloy-trace': 1, program: { name: 'seadrg01.cmd', sha256: programHash(SEA_DRAGON) }, model: 3, rom: 'stub' });
    expect(trace.sessions.map((s) => s.name)).toEqual(['novice', 'expert', 'two-players']);
  });

  it('is what examples/sea-dragon/seadrg01.trace.json holds (pnpm census writes it)', () => {
    expect(parseTrace(readFileSync(TRACE, 'utf8'), programHash(SEA_DRAGON))).toEqual(trace);
  });
});

describe("the census's reading of a CALL's return address on the stack", () => {
  // The game stub ROM's code (the stub and the $DELAY stand-in) has no POP, so a POP in the ROM's space
  // cannot be played on it: the census's predicate is tested directly. $3800 is the Model III ROM's end.
  it.each([
    ['POP AF at $4BAC, the game\'s drop', 0xf1, 0x4bac, 'drop'],
    ['POP IX in the program', 0xdde1, 0x6000, 'drop'],
    ['POP HL in the ROM ($0100): not reported, only unmarked', 0xe1, 0x0100, 'unmark'],
    ['POP BC at $37FF, the ROM\'s last byte', 0xc1, 0x37ff, 'unmark'],
    ['RET', 0xc9, 0x5000, 'unmark'],
    ['RET NZ', 0xc0, 0x5000, 'unmark'],
    ['RETI', 0xed4d, 0x5000, 'unmark'],
    ['LD A,(IX+d)', 0xdd7e, 0x5000, 'keep'],
    ['EX (SP),HL (its write unmarks it; see the format document)', 0xe3, 0x5000, 'keep'],
  ] as const)('%s', (_, op, pc, kind) => {
    expect(markedRead(op, pc, 0x3800)).toBe(kind);
  });
});

describe('parseTrace', () => {
  const text = (): string => readFileSync(TRACE, 'utf8');

  it('refuses a trace taken of another program', () => {
    const other = programHash(new Uint8Array(readFileSync(new URL('../../../examples/sea-dragon/seadrg02.cmd', import.meta.url))));
    expect(() => parseTrace(text(), other)).toThrow(/^the trace was taken of another program \(seadrg01\.cmd, SHA-256 [0-9a-f]{64}\), not this one/);
  });

  it('refuses another format version, and a trace whose lists are out of order', () => {
    const sha = programHash(SEA_DRAGON);
    expect(() => parseTrace(text().replace('"fugloy-trace": 1', '"fugloy-trace": 2'), sha)).toThrow('the trace is of format version 2; this reader takes version 1 only');
    const t = JSON.parse(text()) as PortTrace;
    t.patches.reverse();
    expect(() => parseTrace(JSON.stringify(t), sha)).toThrow(/^the trace is not a port trace: "patches" is not sorted by address/);
  });

  // Each change to a good trace (the committed one) that a reader refuses: an address past $FFFF, a byte
  // past $FF, a number as a string, a fraction, a null, a missing key, an empty list, a count of 0, a
  // backward range
  const set = (path: (string | number)[], value: unknown) => (t: Record<string, unknown>): void => {
    let o = t as Record<string | number, unknown>;
    for (const k of path.slice(0, -1)) o = o[k] as Record<string | number, unknown>;
    if (value === undefined) delete o[path.at(-1)!];
    else o[path.at(-1)!] = value;
  };
  it.each([
    ['a patch address of 65536', set(['patches', 0, 'addr'], 65536), /"patches" item 1 is not/],
    ['a patch value of 256', set(['patches', 0, 'values'], [0, 256]), /"patches" item 1 is not/],
    ['a writer as a string', set(['patches', 0, 'writers'], ['18876']), /"patches" item 1 is not/],
    ['a patch address of 1.5', set(['patches', 0, 'addr'], 1.5), /"patches" item 1 is not/],
    ['a patch with no values', set(['patches', 0, 'values'], []), /"patches" item 1 is not/],
    ['writers out of order', set(['patches', 2, 'writers'], [19770, 19712]), /"patches" item 3 is not/],
    ['an entered range of null', set(['entered', 0], null), /"entered" item 1 is not/],
    ['an entered range backward', set(['entered', 0], [20713, 20673]), /"entered" item 1 is not/],
    ['an entered end of 65536', set(['entered', 0], [20673, 65536]), /"entered" item 1 is not/],
    ['a drop count of 0', set(['drops', 0, 'count'], 0), /"drops" item 1 is not/],
    ['a drop at "19372"', set(['drops', 0, 'at'], '19372'), /"drops" item 1 is not/],
    ['a ROM read value of 256', set(['romReads', 0, 'value'], 256), /"romReads" item 1 is not/],
    ['a ROM read value of null', set(['romReads', 0, 'value'], null), /"romReads" item 1 is not/],
    ['no romReads', set(['romReads'], undefined), /"romReads" is not a list/],
    ['a session of 1.5 T-states', set(['sessions', 0, 'cycles'], 1.5), /"sessions" is not a list/],
    ['a model of "3"', set(['model'], '3'), /"model" is not 1 or 3/],
    ['a rom of null', set(['rom'], null), /"rom" is not "stub" or "user"/],
    ['an uppercase SHA-256', set(['program', 'sha256'], 'A'.repeat(64)), /"program" is not a name and a SHA-256/],
  ])('refuses %s', (_, change, why) => {
    const t = JSON.parse(text()) as Record<string, unknown>;
    change(t);
    const refusal = ((): string => {
      try {
        parseTrace(JSON.stringify(t), programHash(SEA_DRAGON));
        return 'accepted';
      } catch (e) {
        return (e as Error).message;
      }
    })();
    expect(refusal).toMatch(/^the trace is not a port trace: /);
    expect(refusal).toMatch(why);
  });
});
