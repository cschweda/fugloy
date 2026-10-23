/**
 * The Model I's trace reference for emu phase 7's differential harness: MAME 0.289's `trs80l2`,
 * run headless with packages/emu/scripts/mame-trace.lua, which logs every instruction (the state
 * before it, its memory writes, its keyboard and interrupt-latch reads; MAME marks each maskable
 * interrupt it takes) into a FIFO. `recordMameTrace` turns that text into a compact binary trace
 * file; `openTrace` replays the file as a Reference that compareRun (compare.js) drives like the
 * lockstep ones, except that nothing can be synced into it (Ruling 4): it brings `follow`, which
 * starts our machine in MAME's power-on state and makes it take the trace's interrupts and read
 * the trace's keyboard bytes. The format is in the spike note,
 * docs/superpowers/notes/2026-10-19-model1-references-spike.md, "MAME trace format".
 *
 * Nothing of MAME or any ROM is committed. `pnpm mame:install` checks the binary and assembles
 * the ROM set from the user's roms.model1 into the gitignored tools/mame/roms/trs80l2/; the
 * recorder refuses a MAME that is not Homebrew's 0.289 or a ROM set whose CRCs are not the
 * driver's, with a sentence naming the fix. Traces go to the gitignored tools/mame/traces/ by
 * default. MAME runs with -nothrottle and no video or sound, from a scratch working directory
 * with its snapshot, NVRAM and configuration directories inside it, so a run leaves nothing in the
 * checkout and repeats byte for byte.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, createReadStream, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, realpathSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCmd } from '../../src/loaders/cmd-format.js';
import { configuredRom } from '../rom.js';

/** `mame -version` of the pinned MAME. */
export const MAME_VERSION = '0.289 (unknown)';
/** The Homebrew formula version of the pinned MAME (its Cellar folder). */
export const MAME_HOMEBREW = '0.289';
/** trs80l2's CPU clock (`mame -listxml trs80l2`: maincpu, clock="1774083"; 10.6445 MHz / 6). */
export const MAME_CLOCK_HZ = 1_774_083;
/**
 * T-states of the interrupt responses MAME 0.289's Z80 takes, measured on trs80l2 with a synthetic
 * ROM (the spike note): IM 1, 13 (Zilog UM0080: 13); NMI, 11 (Zilog: 11).
 */
export const IRQ_RESPONSE = 13;
export const NMI_RESPONSE = 11;

export const MAME_ROMS = fileURLToPath(new URL('../../../../tools/mame/roms', import.meta.url));
export const MAME_TRACES = fileURLToPath(new URL('../../../../tools/mame/traces', import.meta.url));
export const MAME_LUA = fileURLToPath(new URL('../../scripts/mame-trace.lua', import.meta.url));

/** trs80l2's BIOS sets in MAME 0.289 (`mame -listroms trs80l2`), each the Level II ROM in three 4K pieces. */
export const ROM_SETS = {
  level2: [{ name: 'rom-a.z1', crc: '37c59db2' }, { name: 'rom-b.z2', crc: '05818718' }, { name: 'rom-c.z3', crc: '306e5d66' }],
  rsl2: [{ name: 'rom-a_alt.z1', crc: 'be46faf5' }, { name: 'rom-b_alt.z2', crc: '6c791c2d' }, { name: 'rom-c_alt.z3', crc: '55b3ad13' }],
};
/** The character generator; not among the user's files, so a placeholder of zeros stands in (CRC 0033f2b9 is the driver's). */
export const CHARGEN = { name: 'mcm6670p.z29', size: 1024, crc: '0033f2b9' };

/**
 * How long MAME may write nothing to the trace before the recorder stops it (Review Focus 5: fail
 * clearly rather than hang), and how long it may take to exit once it has closed the trace. MAME
 * writes about 70,000 records a second from power-on, so a minute of silence is a MAME that hangs
 * or never opened the trace, never a slow one.
 */
export const MAME_SILENCE_MS = 60_000;

const INSTALL = '`pnpm mame:install`';
const BREW = '`brew install mame`';

/** The CRC-32 table (the reflected IEEE 802.3 polynomial, EDB88320H). */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/**
 * CRC-32 as zip, zlib and MAME's ROM listings compute it. Computed here, not with node:zlib's
 * `crc32`, which only Node 22.2 and later have: this module loads on any Node 22 (`engines`), and
 * every test file that imports it with it.
 * @param {Uint8Array} bytes
 */
function crc32(bytes) {
  let c = 0xffffffff;
  for (let k = 0; k < bytes.length; k++) c = CRC_TABLE[(c ^ bytes[k]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const hexCrc = (/** @type {Uint8Array} */ b) => crc32(b).toString(16).padStart(8, '0');

/** The CRCs of a 12K Level II ROM's three 4K pieces. @param {Uint8Array} rom */
export function pieceCrcs(rom) {
  if (rom.length !== 12288) throw new Error(`a Model I Level II ROM is 12,288 bytes; this one is ${rom.length}`);
  return [0, 1, 2].map((k) => hexCrc(rom.subarray(k * 4096, (k + 1) * 4096)));
}

/** @param {string} name */
function onPath(name) {
  if (name.includes('/')) return existsSync(name) ? name : null;
  for (const d of (process.env.PATH ?? '').split(delimiter)) {
    const p = join(d, name);
    if (d !== '' && existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

/**
 * Check that `bin` (default `mame` on PATH) is the pinned MAME: Homebrew's 0.289 (the Cellar
 * folder its path resolves into) whose `-version` is MAME_VERSION. Each failure is a sentence.
 * @param {{ bin?: string }} [opts]
 * @returns {{ path: string, version: string }}
 */
export function checkMame({ bin = 'mame' } = {}) {
  const path = onPath(bin);
  if (path === null) throw new Error(`no MAME at ${bin}; install MAME ${MAME_HOMEBREW} with ${BREW}, then run ${INSTALL}`);
  const real = realpathSync(path);
  const cellar = /\/Cellar\/mame\/([^/]+)\//.exec(real);
  if (cellar === null || cellar[1].replace(/_\d+$/, '') !== MAME_HOMEBREW) {
    throw new Error(`${path} is not Homebrew's MAME ${MAME_HOMEBREW} (it resolves to ${real}); install it with ${BREW}, then run ${INSTALL}`);
  }
  let version;
  try {
    version = execFileSync(path, ['-version'], { encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (e) {
    throw new Error(`${path} -version failed (${/** @type {Error} */ (e).message.split('\n')[0]}); reinstall it with ${BREW}, then run ${INSTALL}`);
  }
  if (version !== MAME_VERSION) throw new Error(`${path} says it is MAME ${version}, not the pinned ${MAME_VERSION}; install MAME ${MAME_HOMEBREW} with ${BREW}, then run ${INSTALL}`);
  return { path, version };
}

/**
 * Check the trs80l2 ROM set in `dir` (default tools/mame/roms) against the driver's CRCs and the
 * user's ROM: the three pieces must be one of ROM_SETS, byte for byte the user's ROM, and the
 * character generator must be there. Returns the BIOS to pass MAME.
 * @param {{ dir?: string, rom: Uint8Array }} opts
 * @returns {{ bios: string }}
 */
export function checkRomSet({ dir = MAME_ROMS, rom }) {
  const crcs = pieceCrcs(rom);
  const bios = Object.keys(ROM_SETS).find((b) => ROM_SETS[/** @type {keyof ROM_SETS} */ (b)].every((f, k) => f.crc === crcs[k]));
  if (bios === undefined) {
    throw new Error(`the Model I ROM (roms.model1) splits into 4K pieces with CRCs ${crcs.join(', ')}, which match neither of MAME ${MAME_HOMEBREW}'s trs80l2 sets (${Object.entries(ROM_SETS).map(([b, fs]) => `${b}: ${fs.map((f) => f.crc).join(', ')}`).join('; ')}), so MAME cannot run it`);
  }
  const set = join(dir, 'trs80l2');
  for (const [k, f] of ROM_SETS[/** @type {keyof ROM_SETS} */ (bios)].entries()) {
    const p = join(set, f.name);
    if (!existsSync(p)) throw new Error(`no ${p}; run ${INSTALL} to assemble MAME's trs80l2 ROM set from your Level II ROM`);
    const got = hexCrc(readFileSync(p));
    if (got !== f.crc) throw new Error(`${p} has CRC ${got}, not the driver's ${f.crc}; run ${INSTALL} to assemble it again from your Level II ROM`);
    if (got !== crcs[k]) throw new Error(`${p} is not your Level II ROM's piece ${k}; run ${INSTALL}`);
  }
  const cg = join(set, CHARGEN.name);
  if (!existsSync(cg) || statSync(cg).size !== CHARGEN.size) throw new Error(`no ${CHARGEN.size}-byte ${cg}; run ${INSTALL}`);
  return { bios };
}

// --- The trace file -------------------------------------------------------------------------

const FORMAT = 'fugloy-mame-trace';
const VERSION = 1;
const HEADER = 4096;
const MEM = 0x10000;
const RECORDS_AT = HEADER + 2 * MEM;
/** The registers in a record, as 16-bit words in this order. */
const WORDS = ['pc', 'af', 'bc', 'de', 'hl', 'af2', 'bc2', 'de2', 'hl2', 'ix', 'iy', 'sp'];
const M_I = 1 << 12;
const M_STATE = 1 << 13;
const M_RESPONSE = 1 << 14;
const M_ACCESS = 1 << 15;
/** A response before a record's instruction. */
export const IRQ = 1;
export const NMI = 2;

/**
 * One record: MAME's state before an instruction, after any interrupt response before it.
 * @typedef {{
 *   w: number[], i: number, r: number, iff1: boolean, iff2: boolean, im: number, total: number,
 *   kind: 0 | 1 | 2, writes: import('./reference.js').Write[], reads: import('./reference.js').Write[],
 * }} TraceRecord
 *   w: the WORDS; kind: the response before it (0 none, IRQ, NMI); writes: its step's writes (the
 *   response's push first, then the instruction's); reads: the instruction's reads of the keyboard
 *   matrix and the interrupt latch, in order.
 */

/** Encodes records into the compact form, each against the one before it. */
class Encoder {
  constructor() {
    /** @type {TraceRecord | null} */
    this.prev = null;
    this.buf = Buffer.alloc(1 << 20);
    this.len = 0;
  }

  /** @param {number} n */
  room(n) {
    if (this.len + n > this.buf.length) {
      const b = Buffer.alloc(this.buf.length * 2);
      this.buf.copy(b, 0, 0, this.len);
      this.buf = b;
    }
  }

  /** @param {TraceRecord} rec */
  push(rec) {
    const p = this.prev;
    this.room(64 + 3 * (rec.writes.length + rec.reads.length));
    const b = this.buf;
    const at = this.len;
    let o = at + 2;
    let mask = 0;
    for (let k = 0; k < WORDS.length; k++) {
      if (p === null || p.w[k] !== rec.w[k]) {
        mask |= 1 << k;
        b.writeUInt16LE(rec.w[k], o);
        o += 2;
      }
    }
    const state = (rec.iff1 ? 1 : 0) | (rec.iff2 ? 2 : 0) | (rec.im << 2);
    const prevState = p === null ? -1 : (p.iff1 ? 1 : 0) | (p.iff2 ? 2 : 0) | (p.im << 2);
    if (p === null || p.i !== rec.i) { mask |= M_I; b[o++] = rec.i; }
    if (state !== prevState) { mask |= M_STATE; b[o++] = state; }
    if (rec.kind !== 0) { mask |= M_RESPONSE; b[o++] = rec.kind; }
    if (rec.writes.length + rec.reads.length > 0) {
      mask |= M_ACCESS;
      b[o++] = rec.writes.length;
      b[o++] = rec.reads.length;
    }
    b[o++] = rec.r;
    // The total cycles, as the difference from the record before (LEB128).
    let d = rec.total - (p === null ? 0 : p.total);
    if (d < 0) throw new Error(`MAME's cycle count went backwards at a record (${rec.total})`);
    do {
      const byte = d % 128;
      d = Math.floor(d / 128);
      b[o++] = d > 0 ? byte | 0x80 : byte;
    } while (d > 0);
    for (const a of [...rec.writes, ...rec.reads]) {
      b.writeUInt16LE(a.addr, o);
      b[o + 2] = a.value;
      o += 3;
    }
    b.writeUInt16LE(mask, at);
    this.len = o;
    this.prev = rec;
  }

  /** Take the encoded bytes so far. */
  take() {
    const out = Buffer.from(this.buf.subarray(0, this.len));
    this.len = 0;
    return out;
  }
}

/** Decodes records from a trace file's record area, reading it in chunks. */
class Decoder {
  /** @param {number} fd @param {number} start */
  constructor(fd, start) {
    this.fd = fd;
    this.pos = start;
    this.buf = Buffer.alloc(0);
    this.off = 0;
    this.eof = false;
    /** @type {TraceRecord | null} */
    this.prev = null;
  }

  /** Make `n` bytes available at this.off; false at the end of the file. @param {number} n */
  need(n) {
    if (this.buf.length - this.off >= n) return true;
    if (this.eof) return false;
    const rest = this.buf.subarray(this.off);
    const chunk = Buffer.alloc(Math.max(1 << 20, n));
    const got = readSync(this.fd, chunk, 0, chunk.length, this.pos);
    this.pos += got;
    if (got < chunk.length) this.eof = true;
    this.buf = Buffer.concat([rest, chunk.subarray(0, got)]);
    this.off = 0;
    return this.buf.length >= n;
  }

  /** The next record, or null at the end of the file (a record cut short counts as the end). @returns {TraceRecord | null} */
  next() {
    if (!this.need(2)) return null;
    const p = this.prev;
    const mask = this.buf.readUInt16LE(this.off);
    // The longest a record can be before its accesses: mask, 12 words, I, state, kind, counts, R, 8 bytes of cycles.
    this.need(2 + 24 + 5 + 1 + 8);
    const b = this.buf;
    let o = this.off + 2;
    const end = b.length;
    const take = (/** @type {number} */ n) => {
      if (o + n > end) throw new RangeError('cut');
      const at = o;
      o += n;
      return at;
    };
    try {
      const w = new Array(WORDS.length);
      for (let k = 0; k < WORDS.length; k++) w[k] = mask & (1 << k) ? b.readUInt16LE(take(2)) : /** @type {TraceRecord} */ (p).w[k];
      const i = mask & M_I ? b[take(1)] : /** @type {TraceRecord} */ (p).i;
      const prevState = p === null ? 0 : (p.iff1 ? 1 : 0) | (p.iff2 ? 2 : 0) | (p.im << 2);
      const state = mask & M_STATE ? b[take(1)] : prevState;
      const kind = /** @type {0 | 1 | 2} */ (mask & M_RESPONSE ? b[take(1)] : 0);
      let nw = 0;
      let nr = 0;
      if (mask & M_ACCESS) {
        nw = b[take(1)];
        nr = b[take(1)];
      }
      const r = b[take(1)];
      let d = 0;
      let scale = 1;
      for (;;) {
        const byte = b[take(1)];
        d += (byte & 0x7f) * scale;
        scale *= 128;
        if ((byte & 0x80) === 0) break;
      }
      const used = o - this.off;
      if (!this.need(used + 3 * (nw + nr))) throw new RangeError('cut');
      o = this.off + used;
      const acc = [];
      for (let k = 0; k < nw + nr; k++) {
        acc.push({ addr: this.buf.readUInt16LE(o), value: this.buf[o + 2] });
        o += 3;
      }
      this.off = o;
      /** @type {TraceRecord} */
      const rec = { w, i, r, iff1: (state & 1) !== 0, iff2: (state & 2) !== 0, im: state >> 2, total: (p === null ? 0 : p.total) + d, kind, writes: acc.slice(0, nw), reads: acc.slice(nw) };
      this.prev = rec;
      return rec;
    } catch (e) {
      if (e instanceof RangeError) {
        this.off = this.buf.length;
        this.eof = true;
        return null;
      }
      throw e;
    }
  }
}

/**
 * A program the recording loaded (recordMameTrace's `load`): before record `at` ran, its runs went
 * into memory and the PC moved from `pc` to `entry`, so record `at` (the state before it, as MAME
 * wrote it) holds `pc` and its instruction is the program's first.
 * @typedef {{ at: number, cycles: number, sha256: string, entry: number, pc: number, runs: { addr: number, len: number }[] }} TraceLoad
 */

/**
 * The bytes a .CMD puts in memory, as runs of consecutive addresses (a later block's byte over an
 * earlier one's, as the loader writes them), for MAME's debugger to load and for the trace's
 * memory image. Bytes below $3C00 (ROM, the keyboard, the devices) are refused: m.load.cmd drops
 * them and MAME's `load` would write the ROM.
 * @param {Uint8Array} program
 * @returns {{ addr: number, bytes: Uint8Array }[]}
 */
export function loadRuns(program) {
  const parsed = parseCmd(program);
  const image = new Uint8Array(MEM);
  const set = new Uint8Array(MEM);
  for (const b of parsed.blocks) {
    for (let k = 0; k < b.data.length; k++) {
      const a = (b.addr + k) & 0xffff;
      if (a < 0x3c00) throw new Error(`the program writes $${a.toString(16).toUpperCase().padStart(4, '0')}, below $3C00; a MAME session loads only RAM and video RAM`);
      image[a] = b.data[k];
      set[a] = 1;
    }
  }
  /** @type {{ addr: number, bytes: Uint8Array }[]} */
  const runs = [];
  for (let a = 0; a < MEM;) {
    if (!set[a]) { a++; continue; }
    let e = a;
    while (e < MEM && set[e]) e++;
    runs.push({ addr: a, bytes: image.slice(a, e) });
    a = e;
  }
  return runs;
}

/**
 * The header of a trace file.
 * @typedef {{
 *   format: string, version: number, mame: string, bios: string, romSha256: string,
 *   requested: number, records: number, complete: boolean, reason: string | null, verified: boolean,
 *   keys: { at: number, text: string }[], matrix?: number, load?: TraceLoad | null,
 * }} TraceHeader
 *   requested: instructions asked for (records = requested + 1 when complete: the state after the
 *   last instruction is the record after it); reason: why it ended short, else null; verified:
 *   MAME's memory at the end equals the power-on memory with every recorded write applied.
 */

/** @param {number} fd @param {TraceHeader} h */
function writeHeader(fd, h) {
  const text = `${JSON.stringify(h)}\n`;
  if (text.length > HEADER) throw new Error('trace header too long');
  writeSync(fd, Buffer.from(text.padEnd(HEADER, ' '), 'latin1'), 0, HEADER, 0);
}

/**
 * Write a trace file from records (tests, and the recorder's own writer).
 * @param {string} path
 * @param {{ header: Partial<TraceHeader>, start: Uint8Array, end?: Uint8Array, records: TraceRecord[] }} t
 */
export function writeTrace(path, { header, start, end = new Uint8Array(MEM), records }) {
  const fd = openSync(path, 'w');
  try {
    writeHeader(fd, { format: FORMAT, version: VERSION, mame: MAME_VERSION, bios: '', romSha256: '', requested: records.length - 1, records: records.length, complete: true, reason: null, verified: false, keys: [], ...header });
    writeSync(fd, start, 0, MEM, HEADER);
    writeSync(fd, end, 0, MEM, HEADER + MEM);
    const enc = new Encoder();
    for (const r of records) enc.push(r);
    writeSync(fd, enc.take(), 0, undefined, RECORDS_AT);
  } finally {
    closeSync(fd);
  }
}

// --- Recording ------------------------------------------------------------------------------

const CALLS = new Set([0xcd, 0xc4, 0xcc, 0xd4, 0xdc, 0xe4, 0xec, 0xf4, 0xfc]);

/**
 * Run MAME and record `instructions` instructions from power-on into the trace file `out`
 * (default tools/mame/traces/trace-<instructions>.fmt). `keys` are posted through MAME's natural
 * keyboard at their T-state (converted with MAME_CLOCK_HZ, at frame granularity); `matrix` are key
 * events of the matrix (compare.js, keyEvents: `{ at, row, bit, down }`, at in T-states), set and
 * cleared on MAME's keyboard rows at the first frame at or after their time, so a key is held as
 * long as asked. Either way the comparison follows the bytes the ROM read, not these times.
 *
 * `load` puts a .CMD program in memory at the first instruction boundary at or after `at` T-states
 * from power-on and moves the PC to its entry, as m.load.cmd does on ours (the trace's header
 * says at which record, TraceLoad); `instructions` then counts from the load, and the header's
 * `requested` is the instructions from power-on (the load's record and those after it).
 *
 * Resolves with the path and the instructions recorded, which are fewer than asked when MAME
 * stopped early: the file's header then says why, and a comparison against it reports that
 * sentence. MAME stopped early includes a MAME that writes nothing to the trace for `silenceMs`
 * (default MAME_SILENCE_MS): the recorder kills it and the trace ends there, with that reason. A
 * recorder too busy to read the trace (its event loop blocked past a tick of the watchdog, as
 * recordings beside a comparison are) does not take that for MAME's silence, and the watchdog ends
 * with the trace, so a MAME slow to exit after its last record leaves the trace whole (one still
 * there `silenceMs` later is stopped, its trace as whole as it was).
 * Rejects (a sentence) when MAME or the ROM set is not the pinned one, or when MAME's
 * memory at the end disagrees with the recorded writes (the trace lost something).
 * @param {{ instructions: number, keys?: { at: number, text: string }[], matrix?: { at: number, row: number, bit: number, down: boolean }[], load?: { program: Uint8Array, at: number }, out?: string, bin?: string, romDir?: string, rom?: Uint8Array, skipRomCheck?: boolean, silenceMs?: number }} opts
 *   skipRomCheck: tests only, to run a synthetic ROM set in `romDir` (the user's ROM is then not compared).
 * @returns {Promise<{ path: string, instructions: number, load?: TraceLoad }>}
 */
export async function recordMameTrace({ instructions, keys = [], matrix = [], load, out, bin = 'mame', romDir = MAME_ROMS, rom, skipRomCheck = false, silenceMs = MAME_SILENCE_MS }) {
  if (!Number.isInteger(instructions) || instructions < 1) throw new Error(`recordMameTrace: instructions must be a whole number above 0, not ${instructions}`);
  const mame = checkMame({ bin });
  let bios = 'rsl2';
  let romSha256 = '';
  if (!skipRomCheck) {
    const userRom = rom ?? configuredRom('model1');
    if (userRom === null) throw new Error('recordMameTrace needs the Model I ROM, and fugloy.mcp.json names none: add roms.model1 (docs/fugloy-mcp-spec.md §3)');
    bios = checkRomSet({ dir: romDir, rom: userRom }).bios;
    romSha256 = createHash('sha256').update(userRom).digest('hex');
  }
  const path = out ?? join(MAME_TRACES, `trace-${instructions}.fmt`);
  mkdirSync(dirname(path), { recursive: true });

  const work = mkdtempSync(join(tmpdir(), 'fugloy-mame-'));
  if (/[\s,;{}"]/.test(work)) throw new Error(`MAME's debugger cannot take the path ${work} (it has a space, comma, semicolon, brace or quote); set TMPDIR to a plain path`);
  const fifo = join(work, 'trace.fifo');
  const startMem = join(work, 'start.bin');
  const endMem = join(work, 'end.bin');
  execFileSync('mkfifo', [fifo]);
  const keysFile = join(work, 'keys.txt');
  writeFileSync(keysFile, keys.map((k) => `${(k.at / MAME_CLOCK_HZ).toFixed(9)} ${Buffer.from(k.text, 'latin1').toString('hex')}\n`).join(''));
  const matrixFile = join(work, 'matrix.txt');
  writeFileSync(matrixFile, matrix.map((e) => `${(e.at / MAME_CLOCK_HZ).toFixed(9)} ${e.row} ${e.bit} ${e.down ? 1 : 0}\n`).join(''));
  /** @type {TraceLoad | null} */
  let loaded = null;
  /** @type {{ addr: number, bytes: Uint8Array }[]} */
  let runs = [];
  const loadFile = join(work, 'load.txt');
  if (load !== undefined) {
    if (!Number.isInteger(load.at) || load.at < 0) throw new Error(`recordMameTrace: load.at must be a whole number of T-states, not ${load.at}`);
    runs = loadRuns(load.program);
    const entry = parseCmd(load.program).entry;
    const files = runs.map((r, k) => {
      const f = join(work, `run${k}.bin`);
      writeFileSync(f, r.bytes);
      return `${r.addr.toString(16)} ${f}`;
    });
    writeFileSync(loadFile, [`${load.at} ${entry.toString(16)}`, ...files].join('\n') + '\n');
    loaded = { at: -1, cycles: load.at, sha256: createHash('sha256').update(load.program).digest('hex'), entry, pc: -1, runs: runs.map((r) => ({ addr: r.addr, len: r.bytes.length })) };
  }
  // With a load, the records MAME writes after it; the records before it are counted when it comes.
  const records = instructions + 1;
  const lastKey = Math.max(keys.reduce((m, k) => Math.max(m, k.at), 0), matrix.reduce((m, k) => Math.max(m, k.at), 0), load?.at ?? 0);
  // A cap on emulated time, never reached in a normal run (the register point stops MAME first):
  // 40 T-states an instruction is more than any instruction and its interrupt response take.
  const seconds = Math.ceil((records * 40 + lastKey) / MAME_CLOCK_HZ) + 5;

  /** @type {TraceHeader} */
  const header = { format: FORMAT, version: VERSION, mame: mame.version, bios, romSha256, requested: instructions, records: 0, complete: false, reason: 'the recording did not finish', verified: false, keys, matrix: matrix.length, load: loaded };
  const fd = openSync(path, 'w');
  writeHeader(fd, header);
  let pos = RECORDS_AT;

  const args = ['trs80l2', '-rompath', romDir, '-bios', bios, '-video', 'none', '-sound', 'none', '-nothrottle', '-debug', '-debugger', 'none',
    '-autoboot_script', MAME_LUA, '-autoboot_delay', '0', '-seconds_to_run', String(seconds), '-skip_gameinfo',
    '-snapshot_directory', join(work, 'snap'), '-nvram_directory', join(work, 'nvram'), '-cfg_directory', join(work, 'cfg'),
    '-diff_directory', join(work, 'diff'), '-state_directory', join(work, 'sta'), '-input_directory', join(work, 'inp'), '-noreadconfig'];
  const env = { ...process.env, FUGLOY_MAME_TRACE: fifo, FUGLOY_MAME_RECORDS: String(records), FUGLOY_MAME_START: startMem, FUGLOY_MAME_END: endMem, FUGLOY_MAME_KEYS: keys.length > 0 ? keysFile : '', FUGLOY_MAME_MATRIX: matrix.length > 0 ? matrixFile : '', FUGLOY_MAME_LOAD: loaded !== null ? loadFile : '' };
  const child = spawn(mame.path, args, { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let tail = '';
  const keepTail = (/** @type {Buffer} */ d) => { tail = (tail + d.toString('latin1')).slice(-4000); };
  child.stdout.on('data', keepTail);
  child.stderr.on('data', keepTail);
  const exited = new Promise((resolve) => child.on('close', (code, signal) => resolve({ code, signal })));

  const enc = new Encoder();
  const image = new Uint8Array(MEM);
  let imageReady = false;
  /** @type {TraceRecord | null} */
  let pending = null;
  let pendingOp = 0;
  let count = 0;
  let sawIrq = false;
  let ended = false;
  /** Between the load's `L` and `M` lines. */
  let loading = false;
  /** The records before the load's (its index), once it came. */
  let beforeLoad = 0;
  /** @type {string | null} */
  let stop = null;

  const flush = () => {
    const bytes = enc.take();
    if (bytes.length > 0) {
      writeSync(fd, bytes, 0, bytes.length, pos);
      pos += bytes.length;
    }
  };
  /** @param {TraceRecord} rec */
  const emit = (rec) => {
    if (!imageReady) {
      image.set(readFileSync(startMem));
      imageReady = true;
    }
    for (const w of rec.writes) if (w.addr >= 0x3c00) image[w.addr] = w.value;
    enc.push(rec);
    if (enc.len > 1 << 19) flush();
  };

  /** @param {string} line */
  const onLine = (line) => {
    if (stop !== null || ended) return;
    const c = line.charCodeAt(0);
    if (c === 0x57 /* W */ || c === 0x52 /* R */) {
      if (line[1] !== ' ' || pending === null || loading) return;
      const a = { addr: parseInt(line.slice(2, 6), 16), value: parseInt(line.slice(7, 9), 16) };
      (c === 0x57 ? pending.writes : pending.reads).push(a);
    } else if (c === 0x54 /* T */ && line[1] === ' ') {
      const f = line.slice(2).split(' ');
      if (f.length !== 19) {
        stop = `MAME wrote a trace line this recorder cannot read: ${line.slice(0, 80)}`;
        return;
      }
      const h = (/** @type {string} */ s) => parseInt(s, 16);
      /** @type {TraceRecord} */
      const rec = { w: f.slice(0, 12).map(h), i: h(f[12]), r: h(f[13]), iff1: f[14] === '1', iff2: f[15] === '1', im: Number(f[16]), total: Number(f[17]), kind: 0, writes: [], reads: [] };
      const op = h(f[18]);
      if (pending !== null) {
        const sp = rec.w[11];
        const pw = pending.writes;
        const pushed = pw.length >= 2 && pw[pw.length - 2].addr === ((sp + 1) & 0xffff) && pw[pw.length - 1].addr === sp;
        if (sawIrq) {
          // MAME marks a maskable interrupt: `(interrupted at XXXX, IRQ n)`.
          if (rec.im !== 1) {
            stop = `MAME took an interrupt in IM ${rec.im} before instruction ${count}, which this recorder does not decode (only IM 1)`;
            return;
          }
          if (!pushed || rec.w[0] !== 0x0038 || rec.iff1 || rec.iff2) {
            stop = `MAME marked an interrupt before instruction ${count} without the IM 1 response this recorder expects (a push of the return address and a jump to $0038 with interrupts off)`;
            return;
          }
          rec.kind = IRQ;
        } else if (rec.w[0] === 0x0066 && pushed && !CALLS.has(pendingOp) && !rec.iff1) {
          // MAME's tracer marks no NMI: a jump to $0066 with the return address pushed, after an
          // instruction that is not a CALL, and IFF1 off.
          rec.kind = NMI;
        }
        if (rec.kind !== 0) rec.writes = pw.splice(pw.length - 2, 2);
        emit(pending);
      } else if (sawIrq) {
        stop = 'MAME marked an interrupt before the first instruction';
        return;
      }
      sawIrq = false;
      pending = rec;
      pendingOp = op;
      count++;
    } else if (line.startsWith('   (interrupted at ')) {
      if (!/IRQ \d+\)$/.test(line)) {
        stop = `MAME marked an interrupt this recorder does not decode: ${line.trim()}`;
        return;
      }
      sawIrq = true;
    } else if (c === 0x4c /* L */ && line[1] === ' ') {
      // The load, before the pending record's instruction ran (it ran at the entry instead).
      if (loaded === null || loaded.at !== -1 || pending === null) {
        stop = `MAME wrote a load line this recording did not ask for: ${line}`;
        return;
      }
      if (pending.kind !== 0) {
        stop = `the load fell on an interrupt response (before instruction ${count - 1}); load at another time`;
        return;
      }
      if (!imageReady) {
        image.set(readFileSync(startMem));
        imageReady = true;
      }
      loaded.at = count - 1;
      loaded.pc = parseInt(line.slice(2, 6), 16);
      beforeLoad = count - 1;
      for (const r of runs) image.set(r.bytes, r.addr);
      loading = true;
    } else if (line === 'M') {
      loading = false;
    } else if (line === 'E') {
      ended = true;
    }
  };

  const stream = createReadStream(fifo, { highWaterMark: 1 << 20 });
  let rest = '';
  /** When MAME last wrote to the trace (or started), or the recorder last found itself stalled. */
  let heard = Date.now();
  /** The watchdog's interval, and when it last ticked. */
  const every = Math.min(1000, silenceMs);
  let ticked = heard;
  /** @type {NodeJS.Timeout | undefined} */
  let watchdog;
  try {
    await new Promise((resolve, reject) => {
      // A MAME that writes nothing for silenceMs (hung, or stuck before it opened the trace) is
      // killed, and the trace ends there with the reason, as any short trace does. A tick more than
      // one interval late is a stall of the recorder itself, not MAME's silence: its event loop was
      // blocked (another session's synchronous compareRun blocks it when recordings run at once, the
      // Model I sweep's Review Focus 3), and MAME's lines may have waited in the FIFO all along,
      // unread, so the count starts again.
      watchdog = setInterval(() => {
        const now = Date.now();
        const late = now - ticked - every;
        ticked = now;
        if (late > every) {
          heard = now;
          return;
        }
        if (now - heard <= silenceMs) return;
        stop ??= `MAME wrote nothing to the trace for ${silenceMs / 1000} s, so the recorder stopped it`;
        child.kill('SIGKILL');
        stream.destroy();
        resolve(undefined);
      }, every);
      stream.on('data', (chunk) => {
        heard = Date.now();
        try {
          const text = rest + chunk.toString('latin1');
          const lines = text.split('\n');
          rest = /** @type {string} */ (lines.pop());
          for (const l of lines) onLine(l);
          if (stop !== null) {
            child.kill('SIGKILL');
            stream.destroy();
            resolve(undefined);
          }
        } catch (e) {
          child.kill('SIGKILL');
          stream.destroy();
          reject(e);
        }
      });
      stream.on('end', () => {
        // MAME closed the trace, so the watchdog, which watches the trace, ends with it: MAME
        // writes nothing more to it while it exits, and that is no silence.
        clearInterval(watchdog);
        if (rest !== '') onLine(rest);
        resolve(undefined);
      });
      stream.on('error', reject);
      // MAME failing before it opens the FIFO would leave the read waiting: open it ourselves for writing to end the read.
      child.on('close', () => {
        try { closeSync(openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK)); } catch { /* no reader: the stream is done */ }
      });
    });
    // A MAME that has not exited silenceMs after the trace ended is stuck in its shutdown, and is
    // stopped rather than waited on for ever. Its trace is as whole as it was: mame-trace.lua saves
    // the end memory before the exit that closes the trace.
    const stuck = setTimeout(() => child.kill('SIGKILL'), silenceMs);
    const { code, signal } = /** @type {{ code: number | null, signal: string | null }} */ (await exited);
    clearTimeout(stuck);
    if (pending !== null) emit(pending);
    flush();
    header.records = count;
    if (loaded !== null && loaded.at === -1) stop ??= `MAME never reached the load at ${loaded.cycles} T-states`;
    if (loaded !== null) header.requested = beforeLoad + instructions;
    if (ended && stop === null && count === beforeLoad + records) {
      const end = readFileSync(endMem);
      writeSync(fd, readFileSync(startMem), 0, MEM, HEADER);
      writeSync(fd, end, 0, MEM, HEADER + MEM);
      for (let a = 0x3c00; a < MEM; a++) {
        if (image[a] !== end[a]) {
          throw new Error(`MAME's memory at the end has $${end[a].toString(16).toUpperCase().padStart(2, '0')} at $${a.toString(16).toUpperCase().padStart(4, '0')} where the trace's writes leave $${image[a].toString(16).toUpperCase().padStart(2, '0')}: the trace lost a write, so ${path} cannot be trusted`);
        }
      }
      header.complete = true;
      header.reason = null;
      header.verified = true;
    } else {
      if (existsSync(startMem)) writeSync(fd, readFileSync(startMem), 0, MEM, HEADER);
      const why = stop ?? (code === 0 && signal === null
        ? `MAME stopped at its time limit of ${seconds} emulated seconds`
        : code !== null ? `MAME exited with code ${code}${tail.trim() === '' ? '' : `: ${tail.trim().split('\n').slice(-1)[0]}`}` : `MAME exited on ${signal}`);
      header.reason = why;
    }
    writeHeader(fd, header);
  } catch (e) {
    const err = /** @type {NodeJS.ErrnoException} */ (e);
    child.kill('SIGKILL');
    if (err.code !== undefined) {
      // The trace could not be written (a full disk): say so in the header if it still can be.
      try {
        header.records = count;
        header.reason = `the trace could not be written (${err.code}: ${err.message})`;
        writeHeader(fd, header);
      } catch { /* the header keeps "the recording did not finish" */ }
    }
    throw e;
  } finally {
    clearInterval(watchdog);
    closeSync(fd);
    rmSync(work, { recursive: true, force: true });
  }
  return { path, instructions: Math.max(0, header.records - 1), ...(loaded !== null ? { load: loaded } : {}) };
}

// --- Replaying ------------------------------------------------------------------------------

/** @param {TraceRecord} rec */
const responseCost = (rec) => (rec.kind === IRQ ? IRQ_RESPONSE : rec.kind === NMI ? NMI_RESPONSE : 0);

/**
 * A record's registers before any interrupt response it carries (the state after the instruction
 * before it), in compare.js's terms (R as 7 bits).
 * @param {TraceRecord} rec
 * @returns {import('./reference.js').Regs}
 */
function before(rec) {
  const [pc, af, bc, de, hl, af2, bc2, de2, hl2, ix, iy, sp] = rec.w;
  /** @type {import('./reference.js').Regs} */
  const o = {
    a: af >> 8, f: af & 0xff, b: bc >> 8, c: bc & 0xff, d: de >> 8, e: de & 0xff, h: hl >> 8, l: hl & 0xff,
    a2: af2 >> 8, f2: af2 & 0xff, b2: bc2 >> 8, c2: bc2 & 0xff, d2: de2 >> 8, e2: de2 & 0xff, h2: hl2 >> 8, l2: hl2 & 0xff,
    ix, iy, sp, pc, i: rec.i, r: rec.r & 0x7f, iff1: rec.iff1, iff2: rec.iff2, im: rec.im,
  };
  if (rec.kind !== 0) {
    // Undo the response: the pushed return address, SP, R (the acknowledge is an M1 cycle), and
    // IFF1 (IM 1 clears both; an NMI copies IFF1 into IFF2).
    o.pc = (rec.writes[0].value << 8) | rec.writes[1].value;
    o.sp = (sp + 2) & 0xffff;
    o.r = (rec.r - 1) & 0x7f;
    o.iff1 = rec.kind === IRQ ? true : rec.iff2;
    o.iff2 = rec.kind === IRQ ? true : rec.iff2;
  }
  return o;
}

/**
 * Set our machine's registers. @param {import('../../src/machine/machine.js').Machine} m
 * @param {import('./reference.js').Regs} o
 */
function setRegs(m, o) {
  const cpu = m.system.cpu;
  const r = cpu.registers;
  r.A = o.a; r.F = o.f; r.B = o.b; r.C = o.c; r.D = o.d; r.E = o.e; r.H = o.h; r.L = o.l;
  r.A_ = o.a2; r.F_ = o.f2; r.B_ = o.b2; r.C_ = o.c2; r.D_ = o.d2; r.E_ = o.e2; r.H_ = o.h2; r.L_ = o.l2;
  cpu.IX = o.ix; cpu.IY = o.iy; r.SP = o.sp; r.PC = o.pc; r.I = o.i;
  r.R = (r.R & 0x80) | (o.r & 0x7f);
  cpu.IFF1 = o.iff1; cpu.IFF2 = o.iff2; cpu.interruptMode = o.im;
}

/**
 * What a trace reference gives compareRun in place of syncFrom (Ruling 4): our machine starts in
 * MAME's power-on state, takes its interrupts where MAME took them, and reads MAME's keyboard
 * bytes. Steps are numbered from 0, as compareRun counts them, and asked for in order.
 * @typedef {{
 *   index: number,
 *   has(index: number): boolean,
 *   start(machine: import('../../src/machine/machine.js').Machine): void,
 *   beforeStep(index: number, machine: import('../../src/machine/machine.js').Machine): void,
 *   irqAt(index: number): boolean,
 *   keyRead(index: number, addr: number): number | undefined,
 *   latchReads(index: number): import('./reference.js').Write[],
 *   keyReadsLeft(index: number): number,
 *   adopt(machine: import('../../src/machine/machine.js').Machine): void,
 *   ended(index: number, asked: number): string,
 *   readonly header: TraceHeader,
 * }} Follow
 *   index: the step the reference is at (its next step); has: whether step `index` is in the trace;
 *   irqAt: MAME took a maskable interrupt at the start of step `index`; keyRead: the byte MAME's
 *   step `index` read from keyboard address `addr` (its next unconsumed read there), or undefined;
 *   latchReads: the bytes MAME's step `index` read from the interrupt latch ($37E0-$37E3), in
 *   order; keyReadsLeft: its keyboard reads not consumed yet; adopt: copy the reference's state after the
 *   last step into our machine (compareRun does this after a difference a known class explains,
 *   since a trace cannot be resynced); ended: the sentence for a trace that ends at step `index`
 *   of `asked`; beforeStep: at the trace's load (TraceLoad), load the same program into our
 *   machine with m.load.cmd before step `index` runs, as MAME's debugger did.
 * @typedef {import('./reference.js').Reference & { follow: Follow, header: TraceHeader }} TraceReference
 */

const isKeyboard = (/** @type {number} */ a) => a >= 0x3800 && a < 0x3c00;
const isLatch = (/** @type {number} */ a) => a >= 0x37e0 && a < 0x37e4;

/**
 * The known classes (known.js) a MAME trace needs (plan Ruling 6; Reference.classes): only its
 * device difference, the video read without the bit-6 gate (trs80l2 keeps video RAM as plain
 * RAM), a reference fix that excuses nothing. No step class: MAME's Z80 follows the rules ours
 * does, flags 3 and 5 included (Task 4 and Task 5 fixed our core where it did not), so any
 * difference in a step against it is a divergence. No interrupt class: our machine takes MAME's
 * interrupts where the trace took them (Ruling 4).
 */
export const MAME_CLASSES = new Set(['video-read-gate']);

/**
 * Open a trace file as a Reference that compareRun drives (TraceReference). It cannot be synced
 * or changed: `syncFrom`, `syncRegs`, `poke`, `setKeyBit`, `alignRtc` and `reset` throw. A trace
 * that loaded a program needs that program (`program`, checked by its SHA-256).
 * @param {string} path
 * @param {{ program?: Uint8Array }} [opts]
 * @returns {TraceReference}
 */
export function openTrace(path, { program } = {}) {
  if (!existsSync(path)) throw new Error(`no MAME trace at ${path}; record one with recordMameTrace (pnpm mame:install first)`);
  const fd = openSync(path, 'r');
  const head = Buffer.alloc(HEADER);
  readSync(fd, head, 0, HEADER, 0);
  /** @type {TraceHeader} */
  let header;
  try {
    header = JSON.parse(head.toString('latin1').trim());
  } catch {
    closeSync(fd);
    throw new Error(`${path} is not a MAME trace (its header is not ${FORMAT} JSON)`);
  }
  if (header.format !== FORMAT || header.version !== VERSION) {
    closeSync(fd);
    throw new Error(`${path} is a ${header.format} ${header.version} file, not a ${FORMAT} ${VERSION}; record it again`);
  }
  const load = header.load ?? null;
  /** @type {{ addr: number, bytes: Uint8Array }[]} */
  let runs = [];
  if (load !== null) {
    if (program === undefined) {
      closeSync(fd);
      throw new Error(`${path} loaded a program (SHA-256 ${load.sha256}) at instruction ${load.at}; give the same program (openTrace's program, pnpm diff's <program>, or pnpm mame:trace lines --program <file>)`);
    }
    const sha = createHash('sha256').update(program).digest('hex');
    if (sha !== load.sha256) {
      closeSync(fd);
      throw new Error(`${path} loaded another program (SHA-256 ${load.sha256}) than the one given (${sha})`);
    }
    runs = loadRuns(program);
  }
  let loadDone = false;
  const start = Buffer.alloc(MEM);
  readSync(fd, start, 0, MEM, HEADER);
  const dec = new Decoder(fd, RECORDS_AT);
  let cur = dec.next();
  let nxt = cur === null ? null : dec.next();
  let n = 0;
  let decoded = cur === null ? 0 : nxt === null ? 1 : 2;
  const image = new Uint8Array(start);
  let lastWrites = /** @type {import('./reference.js').Write[]} */ ([]);
  let readsUsed = 0;
  let closed = false;
  const no = (/** @type {string} */ what) => () => { throw new Error(`a MAME trace cannot ${what} (Ruling 4: our machine follows it instead)`); };

  /** @type {Follow} */
  const follow = {
    get index() {
      return n;
    },
    has(index) {
      return index === n && cur !== null && nxt !== null;
    },
    start(m) {
      if (n !== 0) throw new Error('follow.start: the trace has already been stepped');
      if (cur === null) throw new Error(`${path} holds no records`);
      if (m.model !== 1) throw new Error(`a MAME trace is of the Model I; this machine is a Model ${m.model}`);
      if (m.cycles !== 0) throw new Error('a MAME trace starts at power-on; this machine has already run');
      const sys = m.system;
      if (sys.memory.ramLimit !== 0x10000) throw new Error(`MAME's trs80l2 has 48K of RAM; this machine has ${(sys.memory.ramLimit - 0x4000) / 1024}K`);
      if (sys.io.latch === null) throw new Error('MAME\'s trs80l2 has the Expansion Interface\'s interrupt latch; this machine has none');
      if (header.romSha256 !== '' && m.rom.sha256 !== header.romSha256) throw new Error(`${path} was recorded on another ROM (SHA-256 ${header.romSha256}) than this machine's (${m.rom.sha256})`);
      setRegs(m, before(cur));
      // MAME's power-on video RAM and RAM (Ruling 4 revised: all $00 in MAME 0.289). MAME keeps
      // video bytes as written; a Model I without the lowercase modification reads bit 6 through
      // its gate (compare.js, videoGate), so ours holds them as its CPU would read them.
      const video = start.subarray(0x3c00, 0x4000);
      sys.memory.videoRam.set(sys.memory.videoBit6Gate ? video.map((b) => (b & 0xa0 ? b & 0xbf : b | 0x40)) : video);
      sys.memory.ram.set(start.subarray(0x4000, 0x10000));
    },
    beforeStep(index, m) {
      if (load === null || loadDone || index !== load.at) return;
      if (index !== n || cur === null) throw new Error(`follow.beforeStep(${index}): the trace is at step ${n}`);
      if (cur.w[0] !== load.pc) throw new Error(`${path}: the record before the load has PC $${cur.w[0].toString(16)}, not the load's $${load.pc.toString(16)}`);
      const manifest = m.load.cmd(/** @type {Uint8Array} */ (program));
      if (manifest.entry !== load.entry) throw new Error(`${path}: the program's entry is $${manifest.entry.toString(16)}, the trace's $${load.entry.toString(16)}`);
      for (const r of runs) image.set(r.bytes, r.addr);
      // The instruction MAME ran in this record is the program's first.
      cur.w[0] = load.entry;
      loadDone = true;
    },
    irqAt(index) {
      if (index !== n || cur === null) throw new Error(`follow.irqAt(${index}): the trace is at step ${n}`);
      return cur.kind === IRQ;
    },
    keyRead(index, addr) {
      if (index !== n || cur === null) throw new Error(`follow.keyRead(${index}): the trace is at step ${n}`);
      for (let k = readsUsed; k < cur.reads.length; k++) {
        const r = cur.reads[k];
        if (!isKeyboard(r.addr)) continue;
        if (r.addr !== addr) return undefined;
        readsUsed = k + 1;
        return r.value;
      }
      return undefined;
    },
    latchReads(index) {
      if (index !== n || cur === null) throw new Error(`follow.latchReads(${index}): the trace is at step ${n}`);
      return cur.reads.filter((r) => isLatch(r.addr));
    },
    keyReadsLeft(index) {
      if (index !== n || cur === null) throw new Error(`follow.keyReadsLeft(${index}): the trace is at step ${n}`);
      let left = 0;
      for (let k = readsUsed; k < cur.reads.length; k++) if (isKeyboard(cur.reads[k].addr)) left++;
      return left;
    },
    adopt(m) {
      setRegs(m, ref.regs());
      for (const w of lastWrites) m.mem.write(w.addr, [w.value]);
    },
    ended(index, asked) {
      let reason;
      if (!header.complete) reason = header.reason ?? 'the recording did not finish';
      else if (decoded < header.records) reason = `the file is cut short: it holds ${decoded} of the ${header.records} records its header lists`;
      else reason = `it was recorded for ${header.requested} instructions`;
      return `MAME's trace ends after ${index} of ${asked} instructions (${reason}), so the run proves nothing past that point.`;
    },
    header,
  };

  /** @type {TraceReference} */
  const ref = {
    reset: no('be reset'),
    step() {
      if (closed) throw new Error('this MAME trace is closed');
      if (cur === null || nxt === null) throw new Error(`MAME's trace has no instruction ${n}`);
      const cycles = nxt.total - cur.total + responseCost(cur) - responseCost(nxt);
      const irq = cur.kind === IRQ;
      lastWrites = cur.writes;
      for (const w of lastWrites) if (w.addr >= 0x3c00) image[w.addr] = w.value;
      cur = nxt;
      nxt = dec.next();
      if (nxt !== null) decoded++;
      readsUsed = 0;
      n++;
      return { cycles, irq, raised: false };
    },
    regs() {
      if (cur === null) throw new Error(`${path} holds no records`);
      return before(cur);
    },
    peek(addr, len) {
      const out = new Uint8Array(len);
      for (let k = 0; k < len; k++) out[k] = image[(addr + k) & 0xffff];
      return out;
    },
    poke: no('be written'),
    setKeyBit: no('take keys (its keyboard bytes are recorded)'),
    alignRtc: no('move its timer'),
    syncFrom: no('be synced'),
    syncRegs: no('be synced'),
    redoDroppedPrefix() {
      throw new Error('MAME drops no DD/FD pair; there is nothing to redo');
    },
    writes() {
      return lastWrites.map((w) => ({ ...w }));
    },
    close() {
      if (!closed) closeSync(fd);
      closed = true;
    },
    get cycles() {
      return cur === null ? 0 : cur.total - responseCost(cur);
    },
    // The opcodes after DD or FD that run with the prefix as one step: all but the lone prefixes.
    prefixedOps: new Set(Array.from({ length: 256 }, (_, k) => k).filter((k) => k !== 0xdd && k !== 0xfd && k !== 0xed)),
    classes: MAME_CLASSES,
    follow,
    header,
    name: `MAME ${header.mame.split(' ')[0]} trace`,
  };
  return ref;
}
