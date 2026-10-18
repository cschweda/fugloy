/**
 * `load`: put a program into the machine (docs/fugloy-mcp-spec.md §5, Lifecycle). The format
 * comes from the content, never the extension: a .CAS by its leader and sync bytes, then a disk
 * image with a header (DMK, JV3), then `detectFormat` from @fugloy/disasm for .BAS (tokenized)
 * and .CMD, then ASCII BASIC source by its first line's number, and last a JV1 disk image, which
 * has no header and is known only by its size (the emu `DiskImage` decides all three containers,
 * as `m.fdc.mount` does; emu phase 5 plan, Ruling 4). With `reset` (the default) a fresh Machine
 * boots its ROM to READY first, as the emu integration tests do; a disk image instead goes into
 * drive 0 of a fresh Machine, which the ROM boots from. Coverage is on from the start (Ruling 3).
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, isAbsolute, relative, resolve } from 'node:path';
import { detectFormat } from '@fugloy/disasm';
import { CPU_CLOCK_HZ, DiskImage } from '@fugloy/emu';
import { z } from 'zod';
import { hex4, MODELS } from '../args.js';
import { bootToReady, BOOT_SECONDS, seconds } from '../execute.js';
import { readSidecar, sidecarLine, sidecarState } from '../sidecar.js';

/**
 * A cassette image: an optional leader of 00 or 55 bytes, the sync byte (A5 at 500 baud, 7F at
 * 1,500), then a BASIC header (D3 D3 D3) or a SYSTEM header (55).
 * @param {Uint8Array} b
 */
export function isCas(b) {
  let i = 0;
  while (i < b.length && (b[i] === 0x00 || b[i] === 0x55)) i++;
  if (b[i] !== 0xa5 && b[i] !== 0x7f) return false;
  i++;
  return (b[i] === 0xd3 && b[i + 1] === 0xd3 && b[i + 2] === 0xd3) || b[i] === 0x55;
}

/** ASCII BASIC source: printable text whose first non-blank line starts with a line number. */
function isAsciiBas(/** @type {Uint8Array} */ b) {
  for (const byte of b) if (byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== 0x1a && (byte < 0x20 || byte > 0x7e)) return false;
  const first = new TextDecoder('latin1').decode(b).split(/\r\n|\r|\n/).find((l) => l.trim() !== '');
  return first !== undefined && /^\s*\d+/.test(first);
}

/**
 * The disk image container the emu reads `bytes` as, or null: the same rules `m.fdc.mount`
 * applies (DMK header, then JV3 sector table, then a JV1 size; docs/fugloy-emu-spec.md §5).
 * @param {Uint8Array} bytes
 * @returns {'dmk' | 'jv3' | 'jv1' | null}
 */
export function diskContainer(bytes) {
  try {
    return /** @type {'dmk' | 'jv3' | 'jv1'} */ (new DiskImage(bytes).format);
  } catch {
    return null;
  }
}

/**
 * A DMK or JV3 has a header the emu checks field by field, so it is tried before the program
 * formats; a JV1 is only a size (a whole number of 10- or 18-sector tracks), so it comes last,
 * after everything that has a signature of its own.
 * So a JV1 that also parses as a `.CMD` (or as BASIC) loads as a program, not a disk: the
 * program's signature wins over a size.
 * @returns {'cmd' | 'bas' | 'cas' | 'dsk' | null}
 */
export function formatOf(/** @type {Uint8Array} */ bytes) {
  if (isCas(bytes)) return 'cas';
  const disk = diskContainer(bytes);
  if (disk === 'dmk' || disk === 'jv3') return 'dsk';
  const found = detectFormat(bytes);
  if (found === 'cmd' || found === 'bas') return found;
  if (isAsciiBas(bytes)) return 'bas';
  return disk === 'jv1' ? 'dsk' : null;
}

/** Where the Model III ROM puts track 0, sector 1 of drive 0 and jumps (ROM $34D9-$3516). */
export const BOOT_SECTOR = 0x4300;

/** How long `load` lets the ROM take to read a disk's boot sector and jump to it. */
export const DISK_BOOT_SECONDS = 5;

/** `40 tracks, 1 side, 18 sectors a track` for a disk's mount info. */
function geometry(/** @type {{ tracks: number, sides: number, sectorsPerTrack?: number }} */ info) {
  const parts = [`${info.tracks} ${info.tracks === 1 ? 'track' : 'tracks'}`, `${info.sides} ${info.sides === 1 ? 'side' : 'sides'}`];
  parts.push(info.sectorsPerTrack === undefined ? 'sectors a track varying' : `${info.sectorsPerTrack} ${info.sectorsPerTrack === 1 ? 'sector' : 'sectors'} a track`);
  return parts.join(', ');
}

/** `addr–end (len)` for a manifest block. */
const block = (/** @type {{ addr: number, len: number, why?: string, predicted?: boolean }} */ b) =>
  `  ${hex4(b.addr)}–${hex4((b.addr + b.len - 1) & 0xffff)} (${b.len.toLocaleString('en-US')} ${b.len === 1 ? 'byte' : 'bytes'})${b.why ? `  ${b.why}` : ''}`;

/** The path as the agent gave it, resolved: against the working folder, else the config's fixtures folder. */
function locate(/** @type {string} */ given, /** @type {import('../config.js').Config} */ config) {
  const here = resolve(process.cwd(), given);
  if (existsSync(here) || isAbsolute(given) || config.fixtures === undefined) return here;
  const there = resolve(config.fixtures, given);
  return existsSync(there) ? there : here;
}

export default {
  name: 'load',
  description:
    'Load a .CMD, .BAS (tokenized or ASCII), or .CAS program, or a JV1, JV3, or DMK disk image, detected from its content. By default a fresh Model III boots its ROM to READY first; reset: false loads into the machine as it is. A disk image goes into drive 0 of a fresh machine, and the ROM boots it: load runs until the ROM jumps to the boot sector at 4300h (or 5 s emulated), and the disk\'s own loader then reads the rest as the machine runs, which takes seconds of emulated time (the drive turns at 300 rpm), so follow it with run until "settled", repeated until the program\'s screen appears; with reset: false the disk is only put in drive 0 of the running machine, and reset boots from it. Returns the manifest: format, blocks, entry point, the ROM, the sidecar label file (<program>.fugloy.json beside the program, or failing that in the fixtures folder, whose labels are loaded; writes always go beside the program; one that cannot be used is reported and left alone), and the resolved path. Coverage is recorded from the start.',
  inputSchema: {
    path: z.string().describe('The program file; relative paths resolve against the working folder, then the config\'s fixtures folder'),
    model: z.number().int().optional().describe('The machine model; only 3 (the Model III) exists until emu phase 6'),
    reset: z.boolean().optional().describe('Make a fresh machine and boot it to READY first (default true); false loads into the running machine'),
  },
  /**
   * @param {import('../session.js').Session} session
   * @param {{ path: string, model?: number, reset?: boolean }} args
   */
  handler(session, { path, model, reset = true }) {
    const { config } = session;
    if (model !== undefined && model !== 3) {
      if (MODELS[model] === undefined) throw new Error(`model must be 3 (the Model III), not ${model}.`);
      throw new Error(`There is no Model ${MODELS[model]} yet: only the Model III exists until emu phase 6 adds the Model I and the Model 4; call load with model 3 or without model.`);
    }
    if (path.trim() === '') throw new Error('path is empty; give the program file to load.');
    const file = locate(path, config);
    if (!existsSync(file)) throw new Error(`There is no file at ${file}.`);
    if (!statSync(file).isFile()) throw new Error(`${file} is a folder, not a program file.`);
    const bytes = new Uint8Array(readFileSync(file));
    const format = formatOf(bytes);
    if (format === null) {
      throw new Error(`${file} is not a .CMD, .BAS, or .CAS program or a JV1, JV3, or DMK disk image as far as its content shows (the extension is not consulted); raw memory images cannot be loaded.`);
    }

    const lines = [];
    // A fresh machine is booted and loaded before it replaces the session's, so a load that
    // fails leaves the session as it was.
    const fresh = reset || session.machine === null;
    const m = fresh ? session.createMachine() : session.requireMachine();
    let boot;
    let dropped = 0;
    if (fresh) {
      const old = session.machine;
      dropped = old === null ? 0 : old.debug.breaks.length + old.debug.watches.length;
      if (format === 'dsk') boot = ''; // the disk is booted below, once it is mounted
      else {
        const booted = bootToReady(m);
        boot = booted.ready
          ? `Boot: READY after ${seconds(booted.cycles)} emulated`
          : `Boot: the ROM showed no READY within ${BOOT_SECONDS} s emulated, so the program was loaded where the ROM had got to`;
      }
    } else boot = 'Boot: none (reset: false loads into the running machine)';
    // `screen diff` after the load shows what the program drew, including blocks loaded into video RAM.
    let baseline = Uint8Array.from(m.video.raw);

    /** @type {any} */
    let manifest;
    try {
      if (format === 'cmd') manifest = m.load.cmd(bytes);
      else if (format === 'bas') manifest = m.load.bas(bytes);
      else if (format === 'cas') manifest = m.load.cas(bytes, { via: 'fast' });
      // A fresh machine boots from the disk (load.dsk resets it); a running one only gets it in drive 0.
      else manifest = m.load.dsk(bytes, { drive: 0, boot: fresh });
    } catch (err) {
      const as = { cmd: 'a .CMD', bas: 'a .BAS', cas: 'a .CAS', dsk: 'a disk image' }[format];
      throw new Error(`${file} could not be loaded as ${as}: ${err instanceof Error ? err.message.replace(/\.$/, '') : String(err)}.`);
    }
    if (format === 'dsk') {
      if (fresh) {
        // The ROM reads track 0, sector 1 into 4300h and jumps there; reading it takes real
        // emulated time (a revolution is 0.2 s), so the budget is generous.
        const cpu = m.system.cpu;
        const r = m.run({ until: () => cpu.registers.PC === BOOT_SECTOR, cycles: DISK_BOOT_SECONDS * CPU_CLOCK_HZ });
        boot = r.reason === 'predicate'
          ? `Boot: the ROM read the boot sector and jumped to ${hex4(BOOT_SECTOR)} after ${seconds(m.cycles)} emulated; the disk's loader reads the rest as the machine runs, so call run with until "settled" (again if the screen is still loading: a disk can take 10 s emulated or more)`
          : `Boot: the ROM did not reach the boot sector at ${hex4(BOOT_SECTOR)} within ${DISK_BOOT_SECONDS} s emulated (the PC is ${hex4(cpu.registers.PC)}); the disk may not be one the Model III ROM can boot, or it needs longer; call run to go on, and screen to see where it is`;
        // The screen diff starts from what the ROM left, now that the disk's own code runs.
        baseline = Uint8Array.from(m.video.raw);
      } else boot = 'Boot: none (reset: false puts the disk in drive 0 of the running machine; call reset to boot from it)';
    }
    if (dropped > 0) boot += `\nThe previous machine's ${dropped} breakpoints and watches went with it.`;
    if (fresh) session.install(m);
    session.screenBaseline = baseline;
    const name = manifest.name || basename(file, extname(file)).toUpperCase();
    const earlier = session.program;
    const sha256 = m.debug.loaded?.sha256 ?? '';
    // Loaded into a running machine after another program: the coverage since that machine's
    // install covers both, so it is not this program's alone (export refuses; suggest says so).
    const sharesCoverageWith = fresh || earlier === null ? undefined : earlier.sha256 !== sha256 ? earlier.name : earlier.sharesCoverageWith;
    session.program = { path: file, name, bytes: bytes.length, manifest, sha256, ...(sharesCoverageWith === undefined ? {} : { sharesCoverageWith }) };
    // The program's labels are its sidecar's (Ruling 6); a sidecar that cannot be used is reported, not fatal.
    const found = readSidecar(file, session.program.sha256, { fixtures: config.fixtures });
    session.sidecar = sidecarState(file, found);
    session.labels = new Map(found !== null && 'labels' in found ? found.labels.map((l) => [l.addr, l]) : []);

    /** @type {string} */
    let kind;
    if (format === 'dsk') {
      const info = m.fdc.drives[0];
      kind = `disk image (${manifest.container.toUpperCase()}, ${geometry(info)}${info.writeProtected ? ', write-protected' : ''}), in drive 0`;
    } else kind = format === 'cmd' ? '.CMD (load module)' : format === 'bas' ? `.BAS (${manifest.kind})` : `.CAS (${manifest.kind}, loaded at once)`;
    lines.push(`Loaded ${name} from ${file}`, `Format: ${kind}`);
    if (format === 'dsk') lines.push('Blocks: none yet (the ROM and the disk\'s own loader read sectors into memory as the machine runs)');
    else if (manifest.blocks.length === 0) lines.push('Blocks: none yet (ASCII BASIC is typed in through the ROM as the machine runs; call run, then key RUN)');
    else lines.push(`Blocks (${manifest.blocks.length}):`, ...manifest.blocks.map(block));
    if (format === 'dsk') lines.push(`Entry: none (the ROM boots from drive 0: track 0, sector 1 runs at ${hex4(BOOT_SECTOR)})`);
    else if (manifest.entry !== undefined && manifest.entry !== null) lines.push(`Entry: ${hex4(manifest.entry)} (the PC is there now)`);
    else lines.push('Entry: none (a BASIC program; key RUN to start it)');
    lines.push(`ROM: ${m.rom.recognized ?? `unrecognised (SHA-256 ${m.rom.sha256.slice(0, 16)}…)`}`);
    lines.push(boot);
    lines.push(sidecarLine(session.sidecar));
    const outside = config.fixtures !== undefined && relative(config.fixtures, file).startsWith('..') ? ' (outside the fixtures folder)' : '';
    lines.push(`Path: ${file}${outside}`);
    // Kept for the fugloy://program/manifest resource.
    session.program.manifestText = lines.join('\n');
    return session.program.manifestText;
  },
};
