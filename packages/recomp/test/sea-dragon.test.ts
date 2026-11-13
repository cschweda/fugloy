/**
 * @fugloy/recomp, M2 Task 7: Sea Dragon's port (examples/sea-dragon/seadrg01.cmd, the Model III, with its
 * hint file and the trace its census wrote) refereed against @fugloy/emu through the three recorded games,
 * Novice, Expert and two players, from the title to GAME OVER and back to the title: every block's
 * registers, flags, T-states, R, MEMPTR and Q, every byte written, video RAM and the sound at every frame,
 * and the 64K at the end (referee.ts). In CI on Fugløy's game stub ROM; locally also on the user's Model
 * III ROM when fugloy.mcp.json names one.
 *
 * Each session is recorded on emu (sessions/sea-dragon.ts, `recordSession`) and replayed on both machines
 * in its own test: the three are about 273 million T-states.
 */
import { readFileSync } from 'node:fs';
import { programHash } from '@fugloy/disasm';
import { standins } from '@fugloy/runtime';
import type { PortModule } from '@fugloy/runtime';
import { describe, expect, it } from 'vitest';
import { configuredRom } from '../../emu/test/rom.js';
import { parseTrace, port } from '../src/index.js';
import type { PortOptions, PortResult } from '../src/index.js';
import { prepare } from '../src/port.js';
import { gameStubRom } from './game-rom.js';
import { RUNTIME, importPort } from './helpers.js';
import { referee } from './referee.js';
import type { RefereeResult, Step } from './referee.js';
import { SEA_DRAGON, SEA_DRAGON_HINTS, SESSIONS, recordSession } from './sessions/sea-dragon.js';
import type { SessionRom } from './sessions/sea-dragon.js';

const TRACE = parseTrace(readFileSync(new URL('../../../examples/sea-dragon/seadrg01.trace.json', import.meta.url), 'utf8'), programHash(SEA_DRAGON));
const OPTIONS: PortOptions = {
  model: 3,
  hints: SEA_DRAGON_HINTS,
  trace: TRACE,
  runtimeImport: RUNTIME,
  source: 'seadrg01.cmd',
  standins: new Map([...standins(3)].map(([at, s]) => [at, s.name])),
};

/**
 * How long one session may take: recorded on emu, then refereed (emu stepped an instruction at a time
 * beside the port). The longest, two players, is about 132 million T-states; learn.test.ts's limit.
 */
const SESSION_TIMEOUT_MS = 180_000;

/** The local Model III ROM fugloy.mcp.json names, or null (no config, no entry, or no such file): those tests skip. */
const userRom = ((): Uint8Array | null => {
  try {
    return configuredRom('model3');
  } catch {
    return null;
  }
})();

const ok = (p: PortResult): Extract<PortResult, { ok: true }> => {
  if (!p.ok) throw new Error(`the port was refused: ${p.errors.join(' ')}`);
  return p;
};
const passed = (res: RefereeResult): Extract<RefereeResult, { ok: true }> => {
  if (!res.ok) throw new Error(`the referee stopped (${res.field}): ${res.report}`);
  return res;
};

/** Each session's GAME OVER row: the last player's. */
const GAME_OVER: Readonly<Record<string, string>> = { novice: 'Game Over Player 1', expert: 'Game Over Player 1', 'two-players': 'Game Over Player 2' };

/** The steps of each session on the game stub ROM, recorded once for the file's tests that replay it. */
const recorded = new Map<string, Step[]>();
const stepsOf = (rom: SessionRom, name: string): Step[] => {
  const session = SESSIONS.find((s) => s.name === name)!;
  if (rom !== 'game') return recordSession(rom, session);
  if (!recorded.has(name)) recorded.set(name, recordSession('game', session));
  return recorded.get(name)!;
};

/** A session recorded on `rom` and refereed there: the steps' checks (the title, the prompts, GAME OVER) run on both machines. */
async function refereed(rom: SessionRom, name: string): Promise<{ steps: Step[]; res: Extract<RefereeResult, { ok: true }> }> {
  const steps = stepsOf(rom, name);
  const res = passed(
    await referee({
      cmd: SEA_DRAGON,
      model: 3,
      hints: SEA_DRAGON_HINTS,
      trace: TRACE,
      steps,
      ...(rom === 'game' ? { rom: 'game' as const } : { rom, boot: 'ready' as const }),
    }),
  );
  return { steps, res };
}

/** What every refereed session shows: it ran its whole length, with block starts and frames compared, and its GAME OVER row checked. */
function expectWhole(name: string, steps: readonly Step[], res: Extract<RefereeResult, { ok: true }>): void {
  const length = steps.reduce((n, s) => n + ('run' in s ? s.run : 0), 0);
  // The run ends at the first block start at or after the session's end
  expect(res.cycles).toBeGreaterThanOrEqual(length);
  expect(res.blocks).toBeGreaterThan(0);
  expect(res.frames).toBeGreaterThan(0);
  const rows = steps.flatMap((s) => ('row' in s ? [s.text] : []));
  expect(rows[0]).toContain('BY: Wayne');
  expect(rows.at(-1)).toContain(GAME_OVER[name]);
}

describe("Sea Dragon's port", () => {
  const p = ok(port(SEA_DRAGON, OPTIONS));

  it('ports with its hints and trace, the same module twice', () => {
    expect(ok(port(SEA_DRAGON, OPTIONS)).js).toBe(p.js);
    expect(p.js).toMatch(/^import \* as o from /m);
  });

  it('has no labelled routine, eight rewritten sites (nine cells), one drop, the $DELAY stand-in, two ROM bytes, and refuses nothing', () => {
    const r = p.report;
    expect(r.routines.filter((x) => x.labelled)).toEqual([]);
    expect(r.refused).toEqual([]);
    expect(r.entryAddr).toBe(0x497f);
    expect(r.cells).toHaveLength(9);
    expect(new Set(r.cells.map((c) => c.instruction)).size).toBe(8);
    expect(r.drops).toEqual([{ at: 0x4bac, continuation: 'SUB_4BAD' }]);
    expect(r.standins).toEqual([{ addr: 0x0060, name: 'DELAY', sites: [0x4eac, 0x4ebc, 0x4ec6, 0x5512, 0x5f71, 0x6022] }]);
    expect(r.rom).toEqual([{ addr: 0x0000, value: 0xf3 }, { addr: 0x0003, value: gameStubRom(3)[0x0003] }]);
  });

  it("carries none of the game's code bytes: no IR code byte is in DATA, and the cells' bytes as loaded are in CELLS", async () => {
    const prepared = prepare(SEA_DRAGON, OPTIONS);
    if (!prepared.ok) throw new Error(prepared.errors.join(' '));
    const { ir, analysis } = prepared.prepared;
    const mod = (await importPort(p.js)) as PortModule & { CELLS: [number, number][]; ROM: [number, number][] };
    const inData = new Uint8Array(0x10000);
    for (const [at, bytes] of mod.DATA) inData.fill(1, at, at + bytes.length);
    // Every code region of the IR, the loader's mover included
    const codeBytes = ir.regions.filter((x) => x.kind === 'code').reduce((n, x) => n + x.end - x.start + 1, 0);
    expect(codeBytes).toBeGreaterThan(6000);
    for (const region of ir.regions.filter((x) => x.kind === 'code')) {
      for (let a = region.start; a <= region.end; a++) expect(inData[a], `$${a.toString(16)} in DATA`).toBe(0);
    }
    expect(mod.CELLS).toEqual(p.report.cells.map((c) => [c.addr, analysis.space.image.bytes[c.addr]]));
    expect(mod.ROM).toEqual([[0x0000, 0xf3], [0x0003, gameStubRom(3)[0x0003]]]);
  });
});

describe("Sea Dragon's three games, refereed on the game stub ROM", () => {
  for (const name of ['novice', 'expert', 'two-players']) {
    it(
      `${name}: the port matches emu at every block from the title to GAME OVER and back`,
      async () => {
        const { steps, res } = await refereed('game', name);
        expectWhole(name, steps, res);
        // Each session's length is the census's (the trace's sessions)
        expect(steps.reduce((n, s) => n + ('run' in s ? s.run : 0), 0)).toBe(TRACE.sessions.find((s) => s.name === name)!.cycles);
      },
      SESSION_TIMEOUT_MS,
    );
  }

  it(
    "stops a port whose OUT stamps its writes one T-state late in the sound, at the first frame after the game's first write",
    async () => {
      const steps = stepsOf('game', 'novice');
      const late = (js: string): string => js.replace(/z\.out\(0xFF, z\.a\);/g, 'z.cycles += 1; z.out(0xFF, z.a); z.cycles -= 1;');
      const res = await referee({ cmd: SEA_DRAGON, model: 3, hints: SEA_DRAGON_HINTS, trace: TRACE, steps, rom: 'game', transform: late });
      if (res.ok) throw new Error('the referee passed a port whose sound is late');
      expect(res.field).toBe('sound');
      expect(res.report).toMatch(/^sound: write 1 to port \$FF since the last compare \(of \d+ on emu, \d+ on the port\): port \$[0-9A-F]{2} at T-state (\d+), emu \$[0-9A-F]{2} at T-state (\d+)/);
      const [, portT, emuT] = /port \$[0-9A-F]{2} at T-state (\d+), emu \$[0-9A-F]{2} at T-state (\d+)/.exec(res.report)!;
      expect(Number(portT) - Number(emuT)).toBe(1);
    },
    SESSION_TIMEOUT_MS,
  );
});

describe.skipIf(userRom === null)("Sea Dragon's three games, refereed on the user's Model III ROM (fugloy.mcp.json)", () => {
  for (const name of ['novice', 'expert', 'two-players']) {
    it(
      `${name}: the same port matches emu booted to READY on the ROM, from the title to GAME OVER and back`,
      async () => {
        const { steps, res } = await refereed(userRom!, name);
        expectWhole(name, steps, res);
      },
      SESSION_TIMEOUT_MS,
    );
  }
});
