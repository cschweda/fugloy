/**
 * The Model I's lockstep reference for emu phase 7's differential harness: xtrs (Tim Mann's
 * TRS-80 emulator, https://github.com/TimothyPMann/xtrs), its Model I core built headless with our
 * driver (packages/emu/scripts/xtrs/fugloy-xtrs.c) and run as a child process that answers a line
 * protocol on stdin and stdout, one instruction per `step` (the protocol is in the driver's header).
 *
 * Nothing of xtrs is committed: `pnpm xtrs:install` clones it into the gitignored `tools/xtrs/src`
 * at the pinned commit, applies Fugløy's patch (xtrs-fugloy.patch, which only exports what the
 * driver needs), and builds `tools/xtrs/build/fugloy-xtrs` with a stamp naming the tree and the
 * driver and install script it was built from. This loader refuses a missing binary, a source tree whose SHA-256 is
 * not the pinned one, or a binary whose stamp is not this checkout's, before running anything.
 *
 * The pipe is synchronous, as compareRun is: two FIFOs, written and read with `writeSync` and a
 * non-blocking `readSync`. Every reply must come within XTRS_STEP_TIMEOUT_MS; if it does not, the
 * child is killed and the adapter throws a sentence saying so (Review Focus 5), and if the child
 * exits, it says that at once.
 *
 * The driver steps as our Machine.step does: the 40 Hz tick when its T-state has come, then the
 * interrupt check, then one instruction, so an interrupt response counts with the instruction
 * after it on both sides. Its power-on state is xtrs's (AF and SP $FFFF, video RAM $00: the spike
 * note, docs/superpowers/notes/2026-10-19-model1-references-spike.md); syncFrom replaces it with
 * our machine's (Ruling 4 revised).
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, existsSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The xtrs commit `pnpm xtrs:install` builds (scripts/install-xtrs.sh pins the same). */
export const XTRS_COMMIT = '3a2180c063811a715faa28d39a94739c33e0abd0';

/** The SHA-256 of tools/xtrs/src at XTRS_COMMIT with xtrs-fugloy.patch applied (treeSha256). */
export const XTRS_TREE_SHA256 = '8f94e3d99b7fe8d9b4b421a29e495d4e5b95fe615a823da7a2a6a8786dde1618';

/** How long a reply may take before the adapter gives up on the reference. */
export const XTRS_STEP_TIMEOUT_MS = 5000;

/** Where `pnpm xtrs:install` puts the source and the binary, and our driver. */
export const XTRS_SRC = fileURLToPath(new URL('../../../../tools/xtrs/src', import.meta.url));
export const XTRS_PATH = fileURLToPath(new URL('../../../../tools/xtrs/build/fugloy-xtrs', import.meta.url));
export const XTRS_DRIVER = fileURLToPath(new URL('../../scripts/xtrs/fugloy-xtrs.c', import.meta.url));
export const XTRS_INSTALL = fileURLToPath(new URL('../../../../scripts/install-xtrs.sh', import.meta.url));

const READY = 'ready fugloy-xtrs 1';
/**
 * The opcodes after DD or FD that xtrs runs with the prefix as one step: every one but DD, FD and
 * ED (before those the prefix is a lone one, its own step, as on the Z80 and in ours). For an
 * opcode xtrs has no indexed form for, it ignores the prefix in a 4-T-state step of its own
 * (z80.c, do_indexed_instruction's `default:`), and the driver runs the instruction after it in
 * the same step (fugloy-xtrs.c, step()); so no pair is dropped, and known.js's dropped-prefix fix
 * (a trsjs one) never applies.
 */
const PAIRED_OPCODES = new Set(Array.from({ length: 256 }, (_, k) => k).filter((k) => k !== 0xdd && k !== 0xfd && k !== 0xed));

/** @param {Buffer | string} b */
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

/**
 * The SHA-256 of a source tree as scripts/install-xtrs.sh computes it: every file but `.git`, by
 * path in byte order, listed as `shasum -a 256` lists them (`<sha256>  <path>`), then that list's
 * SHA-256.
 * @param {string} dir
 */
export function treeSha256(dir) {
  /** @type {string[]} */
  const files = [];
  /** @param {string} d */
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (d === dir && e.name === '.git') continue;
        walk(p);
      } else if (e.isFile()) {
        files.push(relative(dir, p));
      }
    }
  };
  walk(dir);
  files.sort((a, b) => (Buffer.compare(Buffer.from(a), Buffer.from(b))));
  return sha256(files.map((f) => `${sha256(readFileSync(join(dir, f)))}  ${f}\n`).join(''));
}

/**
 * Check the build: the binary, the pinned source tree, and the stamp the install wrote beside the
 * binary (the tree and the driver it was built from). Each failure is a sentence naming the fix.
 * @param {string} path @param {string} src
 */
function checkBuild(path, src) {
  const fix = '`pnpm xtrs:install`';
  if (!existsSync(path)) throw new Error(`no xtrs at ${path}; run ${fix} to build it (xtrs at its pinned commit, with Fugløy's patch and driver)`);
  if (!existsSync(src) || !statSync(src).isDirectory()) throw new Error(`no xtrs source at ${src}; run ${fix}`);
  const tree = treeSha256(src);
  if (tree !== XTRS_TREE_SHA256) throw new Error(`${src} has SHA-256 ${tree}, not the pinned ${XTRS_TREE_SHA256}; delete it and run ${fix}`);
  const want = `tree ${XTRS_TREE_SHA256}\ndriver ${sha256(readFileSync(XTRS_DRIVER))}\nscript ${sha256(readFileSync(XTRS_INSTALL))}`;
  const stamp = existsSync(`${path}.stamp`) ? readFileSync(`${path}.stamp`, 'utf8').trim() : '';
  if (stamp !== want) throw new Error(`${path} was built from another driver or patch than this checkout's; run ${fix} to rebuild it`);
}

/**
 * Load xtrs's Model I as a Reference, in xtrs's power-on state, on the given ROM (the user's
 * Level II ROM; it is written to a temporary file for the child and never kept).
 * @param {{ path?: string, src?: string, rom: Uint8Array }} opts
 * @returns {import('./reference.js').Reference}
 */
export function loadXtrs({ path = XTRS_PATH, src = XTRS_SRC, rom }) {
  checkBuild(path, src);
  const dir = mkdtempSync(join(tmpdir(), 'fugloy-xtrs-rom-'));
  const romPath = join(dir, 'level2.rom');
  writeFileSync(romPath, rom);
  try {
    return openXtrs({ command: path, args: [romPath], cleanup: () => rmSync(dir, { recursive: true, force: true }) });
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

/**
 * Run `command` as the reference process and wrap its protocol as a Reference. No checks: loadXtrs
 * makes them; tests use this with a stand-in child.
 * `shell` runs the wrapper that holds the reply FIFO open and records the exit status; it uses
 * only POSIX sh (the tests run it under /bin/sh and, where present, dash, as on CI's Linux).
 * @param {{ command: string, args?: string[], timeoutMs?: number, cleanup?: () => void, shell?: string }} opts
 * @returns {import('./reference.js').Reference}
 */
export function openXtrs({ command, args = [], timeoutMs = XTRS_STEP_TIMEOUT_MS, cleanup, shell = '/bin/sh' }) {
  const dir = mkdtempSync(join(tmpdir(), 'fugloy-xtrs-pipe-'));
  const req = join(dir, 'req');
  const resp = join(dir, 'resp');
  const status = join(dir, 'status');
  execFileSync('mkfifo', [req, resp]);
  // Ours first, non-blocking, so the child's open of resp for writing finds a reader.
  const respR = openSync(resp, constants.O_RDONLY | constants.O_NONBLOCK);
  const errFd = openSync(join(dir, 'stderr'), 'w');
  // A shell holds resp open for writing until it has written the child's exit status, so the end
  // of the reply stream comes after the status is there to read.
  const child = spawn(shell, ['-c', 'exec 4>"$1"; req=$2; st=$3; shift 3; "$@" <"$req" >&4 4>&-; echo $? >"$st"', 'sh', resp, req, status, command, ...args], {
    stdio: ['ignore', 'ignore', errFd],
    detached: true,
  });
  closeSync(errFd);
  let instructions = 0;
  let closed = false;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  const buf = Buffer.alloc(1 << 20);
  let pending = '';
  /** @type {number | null} */
  let reqW = null;

  const finish = () => {
    if (closed) return;
    closed = true;
    try { process.kill(-(/** @type {number} */ (child.pid)), 'SIGKILL'); } catch { /* gone already */ }
    if (reqW !== null) try { closeSync(reqW); } catch { /* closed */ }
    try { closeSync(respR); } catch { /* closed */ }
    rmSync(dir, { recursive: true, force: true });
    cleanup?.();
  };
  const tail = '. Run it again; if it repeats, rebuild with pnpm xtrs:install.';
  const stalled = () => {
    finish();
    return new Error(`xtrs stopped answering after ${instructions} instructions${tail}`);
  };
  const exited = () => {
    const code = existsSync(status) ? readFileSync(status, 'utf8').trim() : '';
    finish();
    return new Error(`xtrs exited after ${instructions} instructions${code === '' ? '' : ` (exit code ${code})`}${tail}`);
  };

  // The child opens req for reading when it starts; until then an open for writing fails ENXIO.
  const deadline0 = performance.now() + timeoutMs;
  while (reqW === null) {
    try {
      reqW = openSync(req, constants.O_WRONLY | constants.O_NONBLOCK);
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'ENXIO') { finish(); throw e; }
      if (existsSync(status)) throw exited();
      if (performance.now() > deadline0) throw stalled();
      Atomics.wait(sleeper, 0, 0, 1);
    }
  }

  /** One line from the child, within the timeout. */
  const readLine = () => {
    const deadline = performance.now() + timeoutMs;
    let spins = 0;
    for (;;) {
      const nl = pending.indexOf('\n');
      if (nl >= 0) {
        const line = pending.slice(0, nl);
        pending = pending.slice(nl + 1);
        return line;
      }
      let got = -1;
      try {
        got = readSync(respR, buf, 0, buf.length, null);
      } catch (e) {
        if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'EAGAIN') throw e;
      }
      if (got === 0) throw exited();
      if (got > 0) {
        pending += buf.toString('latin1', 0, got);
        spins = 0;
        continue;
      }
      if (performance.now() > deadline) throw stalled();
      // Spin briefly (a step's reply takes microseconds), then sleep a millisecond at a time.
      if (++spins > 1000) Atomics.wait(sleeper, 0, 0, 1);
    }
  };

  /**
   * Write all of `text` (req is open non-blocking, so a long line goes in pieces as the child
   * reads), within the timeout.
   * @param {string} text
   */
  const send = (text) => {
    const data = Buffer.from(text, 'latin1');
    const deadline = performance.now() + timeoutMs;
    let off = 0;
    while (off < data.length) {
      try {
        off += writeSync(/** @type {number} */ (reqW), data, off, data.length - off);
        continue;
      } catch (e) {
        const code = /** @type {NodeJS.ErrnoException} */ (e).code;
        if (code === 'EPIPE') throw exited();
        if (code !== 'EAGAIN') throw e;
      }
      if (performance.now() > deadline) throw stalled();
      Atomics.wait(sleeper, 0, 0, 1);
    }
  };

  /** Send a command and read its one reply. @param {string} cmd */
  const call = (cmd) => {
    if (closed) throw new Error('xtrs: this reference is closed');
    send(`${cmd}\n`);
    const line = readLine();
    if (line.startsWith('error')) throw new Error(`xtrs did not take \`${cmd.slice(0, 40)}\`: ${line}`);
    return line;
  };

  /** @type {import('./reference.js').Regs} */
  let regs = /** @type {any} */ (null);
  let cycles = 0;
  /** @type {import('./reference.js').Write[]} */
  let lastWrites = [];

  /** Parse an R record's fields (after the `R`). @param {string[]} f */
  const takeRegs = (f) => {
    const h = (/** @type {string} */ s) => parseInt(s, 16);
    const [pc, af, bc, de, hl, af2, bc2, de2, hl2, ix, iy, sp, i, r] = f.slice(0, 14).map(h);
    regs = {
      a: af >> 8, f: af & 0xff, b: bc >> 8, c: bc & 0xff, d: de >> 8, e: de & 0xff, h: hl >> 8, l: hl & 0xff,
      a2: af2 >> 8, f2: af2 & 0xff, b2: bc2 >> 8, c2: bc2 & 0xff, d2: de2 >> 8, e2: de2 & 0xff, h2: hl2 >> 8, l2: hl2 & 0xff,
      ix, iy, sp, pc, i, r: r & 0x7f,
      iff1: f[14] === '1', iff2: f[15] === '1', im: Number(f[16]),
    };
    cycles = Number(f[17]);
  };
  /** @param {string} line */
  const regsLine = (line) => {
    const f = line.split(' ');
    if (f[0] !== 'R' || f.length !== 19) throw new Error(`xtrs answered \`${line.slice(0, 80)}\` where it should give its registers`);
    takeRegs(f.slice(1));
  };

  const hello = readLine();
  if (hello !== READY) {
    finish();
    throw new Error(`${command} is not Fugløy's xtrs driver (it said \`${hello.slice(0, 60)}\`); run \`pnpm xtrs:install\``);
  }
  regsLine(call('regs'));

  const hex2 = (/** @type {number} */ v) => (v & 0xff).toString(16).toUpperCase().padStart(2, '0');
  const hex4 = (/** @type {number} */ v) => (v & 0xffff).toString(16).toUpperCase().padStart(4, '0');

  /** @type {import('./reference.js').Reference} */
  const ref = {
    reset() {
      throw new Error('xtrs: reset is not supported; load a new reference for a fresh power-on');
    },

    step({ irq = 'auto' } = {}) {
      const line = call(`step ${irq}`);
      const r = line.indexOf(' R ');
      const head = line.slice(0, r).split(' ');
      if (head[0] !== 'S' || r < 0) throw new Error(`xtrs answered \`${line.slice(0, 80)}\` to a step`);
      const n = Number(head[4]);
      if (n < 0) throw new Error('xtrs: one step wrote more bytes than its log holds');
      lastWrites = head.slice(5, 5 + n).map((w) => ({ addr: parseInt(w.slice(0, 4), 16), value: parseInt(w.slice(5), 16) }));
      regsLine(line.slice(r + 1));
      instructions++;
      return { cycles: Number(head[1]), irq: head[2] === '1', raised: head[3] === '1' };
    },

    regs() {
      return { ...regs };
    },

    peek(addr, len) {
      const line = call(`peek ${hex4(addr)} ${len}`);
      return new Uint8Array(Buffer.from(line.slice(2), 'hex'));
    },

    poke(addr, bytes) {
      // In pieces, so no one line is very long.
      for (let k = 0; k < bytes.length; k += 8192) {
        const part = Array.from(bytes).slice(k, k + 8192);
        call(`poke ${hex4(addr + k)} ${Buffer.from(part).toString('hex')}`);
      }
    },

    setKeyBit(row, bit, down) {
      call(`key ${row} ${bit} ${down ? 1 : 0}`);
    },

    alignRtc(phase) {
      call(`timer ${cycles + phase}`);
    },

    syncFrom(machine) {
      if (machine.model !== 1) throw new Error(`xtrs runs the Model I here; this machine is a Model ${machine.model}`);
      const sys = machine.system;
      if (sys.memory.ramLimit !== 0x10000) throw new Error(`xtrs's Model I has 48K of RAM; this machine has ${(sys.memory.ramLimit - 0x4000) / 1024}K`);
      if (sys.io.latch === null) throw new Error('xtrs\'s Model I has the Expansion Interface; this machine has none');
      call(`lowercase ${sys.memory.videoBit6Gate ? 0 : 1}`);
      ref.syncRegs(machine);
      // Video RAM and RAM; the ROM is the one xtrs loaded, and $3800-$3BFF is the matrix, below.
      ref.poke(0x3c00, machine.mem.read(0x3c00, 0x10000 - 0x3c00));
      const rows = sys.keyboard.rows;
      for (let row = 0; row < 8; row++) for (let bit = 0; bit < 8; bit++) ref.setKeyBit(row, bit, ((rows[row] >> bit) & 1) === 1);
      lastWrites = [];
    },

    syncRegs(machine) {
      const sys = machine.system;
      const cpu = sys.cpu;
      const o = machine.cpu.regs;
      if (cpu.halted) throw new Error('xtrs: our CPU is halted, and xtrs\'s Model I resets on HALT (z80.c, case 0x76), so the two cannot be synced there');
      // Our EI takes effect after the next instruction (pendingEI); xtrs's IFF1 is set by EI itself
      // and the boundary after it takes no interrupt.
      const ei = cpu.pendingEI > 0;
      const iff1 = o.iff1 || ei ? 1 : 0;
      const iff2 = o.iff2 || ei ? 1 : 0;
      regsLine(call(['setregs', hex4(o.pc), hex2(o.a) + hex2(o.f), hex2(o.b) + hex2(o.c), hex2(o.d) + hex2(o.e), hex2(o.h) + hex2(o.l),
        hex2(o.a2) + hex2(o.f2), hex2(o.b2) + hex2(o.c2), hex2(o.d2) + hex2(o.e2), hex2(o.h2) + hex2(o.l2),
        hex4(o.ix), hex4(o.iy), hex4(o.sp), hex2(o.i), hex2(o.r), iff1, iff2, o.im, ei ? 1 : 0, machine.cycles].join(' ')));
      // The 40 Hz tick's T-state, and the latch the tick and the disk raise (no CPU write sets them).
      call(`timer ${sys.nextRtcAt}`);
      call(`latch ${hex2(sys.io.latch === null ? 0 : sys.io.latch.peek())}`);
    },

    redoDroppedPrefix() {
      throw new Error('xtrs drops no DD/FD pair (the driver runs an ignored prefix and its instruction as one step); there is nothing to redo');
    },

    writes() {
      return lastWrites.map((w) => ({ ...w }));
    },

    close() {
      if (closed) return;
      try { writeSync(/** @type {number} */ (reqW), 'quit\n'); } catch { /* gone */ }
      finish();
    },

    get cycles() {
      return cycles;
    },

    latch() {
      // The driver's peek reads the latch without acknowledging the clock (the patch's peek).
      return ref.peek(0x37e0, 1)[0];
    },

    prefixedOps: PAIRED_OPCODES,
    name: 'xtrs',
  };
  return ref;
}
