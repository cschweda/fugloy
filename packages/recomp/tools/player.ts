/**
 * The browser player's folder and its local server (M2 Task 9), for `pnpm play` (play.ts). `buildPlayer`
 * ports a program and writes a folder of plain static files that play it: the port, the runtime's files
 * the page and the worker import, the page (`index.html`) and a small manifest (`manifest.json`). Any
 * static host can serve the folder if it sends the two cross-origin isolation headers the player needs for
 * its shared memory (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy:
 * require-corp`); `servePlayer` is such a host, on localhost. The player is not on the site in M2 (the
 * plan's calls 4 and 5); M3 is the bundle and the arcade.
 *
 * The port starts in the state the referee proves it from (`startState`): emu's registers at the program's
 * entry on Fugløy's game stub ROM, after the file's loader has run. This is tools code: it uses Node and
 * @fugloy/emu, which src never does.
 */
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { basename, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { programHash } from '@fugloy/disasm';
import { standins } from '@fugloy/runtime';
import { port } from '../src/index.js';
import type { PortReport, PortTrace } from '../src/index.js';
import { emuState } from '../test/helpers.js';
import { machineAtEntry } from '../test/sessions/sea-dragon.js';

/** The runtime's sources, which the folder carries as `runtime/`. */
const RUNTIME_SRC = fileURLToPath(new URL('../../runtime/src/', import.meta.url));
const RUNTIME_NOTICE = fileURLToPath(new URL('../../runtime/NOTICE.md', import.meta.url));

/** What the page says about a game: its name, who wrote it, its rights, and its keys. */
export interface GameInfo {
  title: string;
  authors?: string;
  rights?: string;
  /** Each key and what it does, in the order the page lists them. */
  keys: readonly (readonly [key: string, does: string])[];
}

/**
 * The games the player knows, by their program's SHA-256 (`programHash`): Sea Dragon's from
 * examples/sea-dragon/README.md, and its keys from the hint file's notes (TITLE_FRAME, START_GAME,
 * MAIN_LOOP, MOVE_PLAYER and the fire keys at $5B42).
 */
export const GAMES: Readonly<Record<string, GameInfo>> = {
  '8fa50e79d9f699e23f5daf41c654fc82c288e4df8816d5aaebd709bce43ed2af': {
    title: 'Sea Dragon',
    authors: 'Wayne Westmoreland and Terry Gilman (Adventure International, 1982)',
    rights: 'In the public domain since 1995, when Wayne Westmoreland released it.',
    keys: [
      ['Enter', 'start at the title; then 1 or 2 players, and 0 (Novice) or 1 (Expert) for each'],
      ['Arrow keys', 'move the sub'],
      ['Space', 'fire'],
      ['Enter', 'fire the other shot, during play'],
      ['Shift+S', 'pause; Enter goes on'],
      ['Shift+Esc', 'back to the title (Esc is BREAK)'],
    ],
  },
};

/** For a program the player does not know: its file's name, and the TRS-80's keys. */
const unknownGame = (file: string): GameInfo => ({
  title: basename(file),
  keys: [
    ['Letters, digits, punctuation', 'the TRS-80 key that types them'],
    ['Enter, arrow keys, Space, Shift', 'ENTER, the arrows, the space bar, SHIFT'],
    ['Esc, Home, Backspace', 'BREAK, CLEAR, and ← (as LEFT)'],
  ],
});

/** The registers a player starts a port with (@fugloy/runtime's src/player/worker.js, `Start`). */
export interface Start {
  sp: number; ret: number;
  a: number; f: number; b: number; c: number; d: number; e: number; h: number; l: number;
  i: number; r: number; ix: number; iy: number; wz: number; q: number;
  af_: number; bc_: number; de_: number; hl_: number;
}

/**
 * The state the port starts in: emu's registers at the program's entry on Fugløy's game stub ROM, after
 * the .CMD is loaded and its loader has run, and the return address on top of the stack there (the stub's
 * RETURNED). The referee starts a port from the same state; Sea Dragon reads R (its random numbers) before
 * anything sets it, so the start matters. The Model III only, as M2's sessions are.
 */
export function startState(cmd: Uint8Array, entry: number): Start {
  const m = machineAtEntry('game', cmd, entry);
  const s = emuState(m);
  const ret = m.mem.read(s.sp, 2);
  return {
    sp: s.sp, ret: ret[0]! | (ret[1]! << 8),
    a: s.a, f: s.f, b: s.b, c: s.c, d: s.d, e: s.e, h: s.h, l: s.l,
    i: s.i, r: s.r, ix: s.ix, iy: s.iy, wz: s.wz, q: s.q,
    af_: s.af_, bc_: s.bc_, de_: s.de_, hl_: s.hl_,
  };
}

/** What `manifest.json` holds: the page reads it, and tells the worker the module and the start. */
export interface Manifest extends GameInfo {
  /** The program's file name. */
  file: string;
  model: 3;
  /** The port module, relative to the folder. */
  module: string;
  start: Start;
}

/** Where the port imports the runtime's helpers from, in the folder: a relative path, as a worker has no import map. */
const RUNTIME_IMPORT = './runtime/ops.js';

/**
 * Port `cmd` and write the player's folder at `dir` (emptied first): `<name>.port.js` (importing the
 * runtime as `./runtime/ops.js`), `runtime/` (the runtime's source files and its player, with the glyphs'
 * NOTICE.md), `index.html` and `manifest.json`. Returns the manifest and the port's report; throws the
 * port's sentences when it cannot be ported.
 */
export function buildPlayer(opts: { cmd: Uint8Array; file: string; hints?: string; trace?: PortTrace; dir: string }): { manifest: Manifest; report: PortReport } {
  const { cmd, file, dir } = opts;
  const name = basename(file).replace(/\.[^.]*$/, '');
  const result = port(cmd, {
    model: 3,
    runtimeImport: RUNTIME_IMPORT,
    source: basename(file),
    standins: new Map([...standins(3)].map(([at, s]) => [at, s.name])),
    ...(opts.hints === undefined ? {} : { hints: opts.hints }),
    ...(opts.trace === undefined ? {} : { trace: opts.trace }),
  });
  if (!result.ok) throw new Error(`${basename(file)} cannot be ported: ${result.errors.join(' ')}`);

  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'runtime', 'player'), { recursive: true });
  const module = `${name}.port.js`;
  writeFileSync(join(dir, module), result.js);
  for (const f of readdirSync(RUNTIME_SRC)) if (f.endsWith('.js')) copyFileSync(join(RUNTIME_SRC, f), join(dir, 'runtime', f));
  for (const f of readdirSync(join(RUNTIME_SRC, 'player'))) {
    if (f === 'index.html') continue;
    copyFileSync(join(RUNTIME_SRC, 'player', f), join(dir, 'runtime', 'player', f));
  }
  copyFileSync(RUNTIME_NOTICE, join(dir, 'runtime', 'NOTICE.md'));
  copyFileSync(join(RUNTIME_SRC, 'player', 'index.html'), join(dir, 'index.html'));

  const game = GAMES[programHash(cmd)] ?? unknownGame(file);
  const manifest: Manifest = { ...game, file: basename(file), model: 3, module, start: startState(cmd, result.report.entryAddr) };
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, report: result.report };
}

/** The headers every file is served with: the two that isolate the page, so it may share memory with its worker. */
export const ISOLATION_HEADERS: Readonly<Record<string, string>> = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

/** The media type of each extension the folder holds. */
const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

/**
 * Serve the folder `dir` on 127.0.0.1 at `port` (0 picks a free one), every response with the isolation
 * headers and its media type; `/` is `index.html`. Nothing outside the folder is served. Resolves with the
 * URL once listening, and the server to close.
 */
export function servePlayer(dir: string, port: number): Promise<{ url: string; server: Server }> {
  const root = resolve(dir);
  const server = createServer((req, res) => {
    let path: string;
    try {
      path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    } catch {
      res.writeHead(400, { ...ISOLATION_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('bad request\n');
      return;
    }
    const file = resolve(root, `.${path.endsWith('/') ? `${path}index.html` : path}`);
    const type = TYPES[extname(file)];
    let body: Buffer | null = null;
    if ((file === root || file.startsWith(root + sep)) && type !== undefined) {
      try {
        body = readFileSync(file);
      } catch {
        body = null;
      }
    }
    if (body === null) {
      res.writeHead(404, { ...ISOLATION_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`not found: ${path}\n`);
      return;
    }
    res.writeHead(200, { ...ISOLATION_HEADERS, 'Content-Type': type!, 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
  return new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const at = typeof address === 'object' && address !== null ? address.port : port;
      done({ url: `http://127.0.0.1:${at}/`, server });
    });
  });
}
