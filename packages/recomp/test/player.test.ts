/**
 * @fugloy/recomp, M2 Task 9 (controller Ruling 3): Sea Dragon's port through the browser player's loop,
 * headless. `play` (@fugloy/runtime's src/player/worker.js) runs the port as the worker does, a fresh
 * machine loaded with the port and put in the player's start state, with its posting and its wait
 * injected; for 600 frames (ten seconds of the game: the title, ENTER, one player, Novice, and play with
 * the sub moving and firing) it must post 600 screens, and each must equal @fugloy/emu's video RAM at the
 * same T-state from the entry, emu running the original on Fugløy's game stub ROM from the game's entry
 * (after the loader's mover, as the referee starts it) with the same keys pressed at the same frames. The
 * sound each frame posts is compared with emu's too. The comparison starts at the first frame.
 *
 * The player starts the port in the state `pnpm play` writes into its manifest (tools/player.ts,
 * `startState`): emu's registers at the entry on the game stub ROM. A port started from the runtime's
 * reset registers instead goes another way once the game is in play, because the game reads R for its
 * random numbers (LD A,R) and never sets it; the last test shows that, so the start state is not decoration.
 *
 * The folder `pnpm play` writes, and its server, are checked here too: static files whose every import
 * resolves inside the folder, served with the two isolation headers.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { programHash } from '@fugloy/disasm';
import { createZ, standins } from '@fugloy/runtime';
import { START, play } from '@fugloy/runtime/player';
import type { FrameMessage, Start } from '@fugloy/runtime/player';
import { describe, expect, it } from 'vitest';
import { parseTrace, port } from '../src/index.js';
import { RUNTIME, importPort, stub } from './helpers.js';
import { SEA_DRAGON, SEA_DRAGON_HINTS, machineAtEntry, seaDragonEntry } from './sessions/sea-dragon.js';
import { ISOLATION_HEADERS, buildPlayer, servePlayer, startState } from '../tools/player.js';

const TRACE = parseTrace(readFileSync(new URL('../../../examples/sea-dragon/seadrg01.trace.json', import.meta.url), 'utf8'), programHash(SEA_DRAGON));

/** The frames run: ten seconds at 60 a second. */
const FRAMES = 600;

/**
 * The keys, each pressed or released in the rows the worker copies at frame `frame` (so after the post of
 * frame `frame - 1`), as a player's KeyTracker writes them. The title is up 5 s after the load; ENTER,
 * `1` (one player) and `0` (Novice) are each held half a second with half a second between, as the
 * recorded sessions answer the prompts (sessions/sea-dragon.ts); then the sub climbs and fires, and moves
 * right and dives.
 */
const KEYS: readonly { frame: number; press?: string; release?: string }[] = [
  { frame: 340, press: 'ENTER' },
  { frame: 370, release: 'ENTER' },
  { frame: 400, press: '1' },
  { frame: 430, release: '1' },
  { frame: 460, press: '0' },
  { frame: 490, release: '0' },
  { frame: 520, press: 'UP' },
  { frame: 520, press: 'SPACE' },
  { frame: 545, release: 'SPACE' },
  { frame: 560, release: 'UP' },
  { frame: 560, press: 'RIGHT' },
  { frame: 560, press: 'DOWN' },
  { frame: 580, release: 'RIGHT' },
];

const STOP = { stop: true };

interface Post {
  frame: number;
  to: number;
  video: Uint8Array;
  sound: { t: number; v: number }[];
}

/** Sea Dragon's port run by the player's loop from `start` for FRAMES frames: what it posted, and how often it was asked to wait. */
async function playPort(start: Start): Promise<{ posts: Post[]; waits: number }> {
  const p = port(SEA_DRAGON, {
    model: 3,
    hints: SEA_DRAGON_HINTS,
    trace: TRACE,
    runtimeImport: RUNTIME,
    standins: new Map([...standins(3)].map(([at, s]) => [at, s.name])),
  });
  if (!p.ok) throw new Error(`Sea Dragon was not ported: ${p.errors.join(' ')}`);
  const mod = await importPort(p.js);
  const keys = new Uint8Array(8);
  // The keys held, on a machine of their own: its matrix rows are what a KeyTracker writes
  const held = createZ({ model: 3 });
  const posts: Post[] = [];
  let waits = 0;
  try {
    play({
      mod,
      keys,
      post: (m: FrameMessage) => {
        posts.push({ frame: m.frame, to: m.to, video: m.video, sound: m.sound });
        if (posts.length === FRAMES) throw STOP;
        for (const k of KEYS.filter((x) => x.frame === m.frame + 1)) {
          if (k.press !== undefined) held.press(k.press);
          if (k.release !== undefined) held.release(k.release);
        }
        for (let row = 0; row < 8; row++) keys[row] = held.read(0x3800 | (1 << row));
      },
      wait: () => void waits++,
      // Real time stands still, so every frame is ahead and the injected wait is asked for (and returns at once)
      now: () => 0,
      start,
    });
  } catch (e) {
    if (e !== STOP) throw e;
  }
  return { posts, waits };
}

/**
 * emu running the original from its entry on the game stub ROM beside the posts: at each post, emu run to
 * the same T-state from the entry, its video RAM and its port $FF writes since the post before compared,
 * then the frame's keys pressed. Returns the first difference as a sentence, or null; and emu.
 */
function compareWithEmu(posts: readonly Post[]): { difference: string | null; m: ReturnType<typeof machineAtEntry> } {
  const m = machineAtEntry('game');
  const entryT = m.cycles;
  m.sound.clear();
  for (const p of posts) {
    const at = `frame ${p.frame}, T-state ${p.to} from the entry`;
    const left = entryT + p.to - m.cycles;
    if (left > 0) m.run({ cycles: left });
    if (m.cycles - entryT !== p.to) return { difference: `${at}: emu has no instruction start there (it is at T-state ${m.cycles - entryT})`, m };
    const video = m.mem.read(0x3c00, 0x400);
    const cell = video.findIndex((b, i) => b !== p.video[i]);
    if (cell >= 0) return { difference: `${at}: video RAM differs first at $${(0x3c00 + cell).toString(16).toUpperCase()}, port $${p.video[cell]!.toString(16)}, emu $${video[cell]!.toString(16)}`, m };
    const sound = m.sound.events().map((e) => ({ t: e.cycle - entryT, v: e.value }));
    if (JSON.stringify(sound) !== JSON.stringify(p.sound)) return { difference: `${at}: the sound differs (${p.sound.length} writes on the port, ${sound.length} on emu)`, m };
    m.sound.clear();
    // The keys the worker copied in at this frame, just before it posted it: they reach the blocks after
    for (const key of KEYS.filter((x) => x.frame === p.frame)) {
      if (key.press !== undefined) m.keyboard.press(key.press);
      if (key.release !== undefined) m.keyboard.release(key.release);
    }
  }
  return { difference: null, m };
}

/** The start `pnpm play` writes into Sea Dragon's manifest. */
const start = startState(SEA_DRAGON, seaDragonEntry());

describe("Sea Dragon's port in the player's loop", () => {
  it("starts where Fugløy's game stub ROM and the loader leave the game: SP $FFFE holding RETURNED, and emu's registers", () => {
    expect(START).toEqual({ sp: 0xfffe, ret: stub(3).returned });
    expect({ sp: start.sp, ret: start.ret }).toEqual(START);
    // What the loader's mover leaves (LD HL,5200H / LD DE,497FH / LD BC,3681H / LDIR / JP 497FH), and the R
    // the boot and the move have counted
    expect(start).toMatchObject({ b: 0, c: 0, d: 0x80, e: 0x00, h: 0x88, l: 0x81, wz: 0x497f, r: 0x0e });
  });

  it(
    "posts 600 screens, each equal to emu's video RAM at the same T-state with the same keys, and the same sound",
    async () => {
      const { posts, waits } = await playPort(start);
      expect(posts).toHaveLength(FRAMES);
      expect(waits).toBe(FRAMES - 1);
      const frameT = 2027520 / 60;
      let boundary = frameT;
      for (const [k, p] of posts.entries()) {
        expect(p.frame).toBe(k + 1);
        // The first block start at or after the next frame boundary: at most one block (a $DELAY's call,
        // under a second, at the longest) past it
        expect(p.to).toBeGreaterThanOrEqual(boundary);
        expect(p.to - boundary).toBeLessThan(2027520);
        boundary = (Math.floor(p.to / frameT) + 1) * frameT;
      }

      const { difference, m } = compareWithEmu(posts);
      expect(difference).toBeNull();

      // The keys did what they were pressed for: the title came and went, and a game is in play
      const rows = m.video.text();
      expect(rows.join('\n')).not.toContain('BY: Wayne');
      expect(rows[15]).toContain('SHIPS');
      // and the screen changed as the game ran: the title animates, the cavern scrolls (146 of the 599
      // frames after the first change something, measured; the title redraws every few frames)
      const changes = posts.slice(1).filter((p, k) => p.video.some((b, i) => b !== posts[k]!.video[i])).length;
      expect(changes).toBeGreaterThan(100);
      // the game made sound in those ten seconds
      expect(posts.reduce((n, p) => n + p.sound.length, 0)).toBeGreaterThan(0);
    },
    120_000,
  );

  it(
    "goes another way than emu when started from the runtime's reset registers (the game reads R before it sets it)",
    async () => {
      const { posts } = await playPort(START);
      expect(compareWithEmu(posts).difference).toMatch(/^frame \d+, T-state \d+ from the entry: /);
    },
    120_000,
  );
});

describe("the player's folder and its server (pnpm play)", () => {
  it(
    'writes static files whose every import resolves inside the folder, and serves them with the isolation headers',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'fugloy-play-'));
      try {
        const { manifest } = buildPlayer({ cmd: SEA_DRAGON, file: 'examples/sea-dragon/seadrg01.cmd', hints: SEA_DRAGON_HINTS, trace: TRACE, dir });
        expect(manifest).toMatchObject({ title: 'Sea Dragon', file: 'seadrg01.cmd', model: 3, module: 'seadrg01.port.js', start });
        expect(manifest.authors).toContain('Wayne Westmoreland and Terry Gilman');
        expect(manifest.rights).toContain('public domain since 1995');
        expect(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))).toEqual(manifest);

        // Every file, and every relative import in a JavaScript file, is in the folder; nothing is bare
        const files: string[] = [];
        const walk = (d: string): void => {
          for (const f of readdirSync(d)) {
            const path = join(d, f);
            if (statSync(path).isDirectory()) walk(path);
            else files.push(relative(dir, path));
          }
        };
        walk(dir);
        expect(files).toEqual(expect.arrayContaining(['index.html', 'manifest.json', 'seadrg01.port.js', 'runtime/ops.js', 'runtime/screen.js', 'runtime/glyphs.generated.js', 'runtime/NOTICE.md', 'runtime/player/page.js', 'runtime/player/worker.js']));
        for (const f of files.filter((x) => x.endsWith('.js'))) {
          const text = readFileSync(join(dir, f), 'utf8');
          for (const [, spec] of text.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm)) {
            expect(spec, `${f} imports ${spec}`).toMatch(/^\.\.?\//);
            expect(files, `${f} imports ${spec}`).toContain(relative(dir, resolve(dirname(join(dir, f)), spec!)));
          }
        }
        expect(readFileSync(join(dir, 'seadrg01.port.js'), 'utf8')).toMatch(/^import \* as o from '\.\/runtime\/ops\.js';$/m);
        expect(readFileSync(join(dir, 'index.html'), 'utf8')).toContain('<script type="module" src="runtime/player/page.js"></script>');

        const { url, server } = await servePlayer(dir, 0);
        try {
          for (const [path, type] of [['', 'text/html'], ['runtime/player/worker.js', 'text/javascript'], ['seadrg01.port.js', 'text/javascript'], ['manifest.json', 'application/json']] as const) {
            const res = await fetch(`${url}${path}`);
            expect(res.status, path).toBe(200);
            expect(res.headers.get('content-type'), path).toContain(type);
            for (const [header, value] of Object.entries(ISOLATION_HEADERS)) expect(res.headers.get(header), `${path}: ${header}`).toBe(value);
          }
          expect((await fetch(`${url}nothing.js`)).status).toBe(404);
          expect((await fetch(`${url}..%2F..%2Fpackage.json`)).status).toBe(404);
          expect((await fetch(`${url}%E0%A4%A`)).status).toBe(400);
        } finally {
          server.close();
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
