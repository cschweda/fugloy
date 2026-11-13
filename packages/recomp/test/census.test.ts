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
import { census } from '../tools/census.js';
import { gameStubRom } from './game-rom.js';
import type { Step } from './referee.js';
import { SEA_DRAGON, SEA_DRAGON_HINTS, SESSIONS, recordSession } from './sessions/sea-dragon.js';

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

  it('finds the code the disassembly does not reach ($50C1-$50E9, behind the rewritten JP), one drop, and two ROM reads', () => {
    // $50E7 is the range's last instruction, JP 50C1H: its bytes run to $50E9, and the IR's code resumes at $50EA
    expect(trace.entered).toEqual([[0x50c1, 0x50e9]]);
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
});
