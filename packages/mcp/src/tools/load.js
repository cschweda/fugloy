/**
 * `load`: put a program into the machine (docs/fugloy-mcp-spec.md §5, Lifecycle). The format
 * comes from the content, never the extension: a .CAS by its leader and sync bytes, then
 * `detectFormat` from @fugloy/disasm for .BAS (tokenized) and .CMD, then ASCII BASIC source by
 * its first line's number. With `reset` (the default) a fresh Machine boots its ROM to READY
 * first, as the emu integration tests do; coverage is on from the start (Ruling 3).
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, isAbsolute, relative, resolve } from 'node:path';
import { detectFormat } from '@fugloy/disasm';
import { z } from 'zod';
import { hex4 } from '../args.js';
import { bootToReady, BOOT_SECONDS, seconds } from '../execute.js';
import { readSidecar, sidecarLine, sidecarPath } from '../sidecar.js';

const MODEL_NAMES = { 1: 'Model I', 4: 'Model 4' };

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

/** @returns {'cmd' | 'bas' | 'cas' | null} */
export function formatOf(/** @type {Uint8Array} */ bytes) {
  if (isCas(bytes)) return 'cas';
  const found = detectFormat(bytes);
  if (found === 'cmd' || found === 'bas') return found;
  return isAsciiBas(bytes) ? 'bas' : null;
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
    'Load a .CMD, .BAS (tokenized or ASCII), or .CAS program, detected from its content. By default a fresh Model III boots its ROM to READY first; reset: false loads into the machine as it is. Returns the manifest: format, blocks, entry point, the ROM, the sidecar label file (<program>.fugloy.json beside the program, whose labels are loaded; one that cannot be used is reported and left alone), and the resolved path. Coverage is recorded from the start.',
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
      const name = MODEL_NAMES[/** @type {1 | 4} */ (model)];
      if (name === undefined) throw new Error(`model must be 3 (the Model III), not ${model}.`);
      throw new Error(`There is no ${name} yet: only the Model III exists until emu phase 6 adds the Model I and the Model 4; call load with model 3 or without model.`);
    }
    if (path.trim() === '') throw new Error('path is empty; give the program file to load.');
    const file = locate(path, config);
    if (!existsSync(file)) throw new Error(`There is no file at ${file}.`);
    if (!statSync(file).isFile()) throw new Error(`${file} is a folder, not a program file.`);
    const bytes = new Uint8Array(readFileSync(file));
    const format = formatOf(bytes);
    if (format === null) {
      throw new Error(`${file} is not a .CMD, .BAS, or .CAS program as far as its content shows (the extension is not consulted); raw memory images cannot be loaded.`);
    }

    const lines = [];
    // A fresh machine is booted and loaded before it replaces the session's, so a load that
    // fails leaves the session as it was.
    const fresh = reset || session.machine === null;
    const m = fresh ? session.createMachine() : session.requireMachine();
    let boot;
    if (fresh) {
      const old = session.machine;
      const dropped = old === null ? 0 : old.debug.breaks.length + old.debug.watches.length;
      const booted = bootToReady(m);
      boot = booted.ready
        ? `Boot: READY after ${seconds(booted.cycles)} emulated`
        : `Boot: the ROM showed no READY within ${BOOT_SECONDS} s emulated, so the program was loaded where the ROM had got to`;
      if (dropped > 0) boot += `\nThe previous machine's ${dropped} breakpoints and watches went with it.`;
    } else boot = 'Boot: none (reset: false loads into the running machine)';
    // `screen diff` after the load shows what the program drew, including blocks loaded into video RAM.
    const baseline = Uint8Array.from(m.video.raw);

    /** @type {any} */
    let manifest;
    try {
      if (format === 'cmd') manifest = m.load.cmd(bytes);
      else if (format === 'bas') manifest = m.load.bas(bytes);
      else manifest = m.load.cas(bytes, { via: 'fast' });
    } catch (err) {
      throw new Error(`${file} could not be loaded as ${format === 'cmd' ? 'a .CMD' : format === 'bas' ? 'a .BAS' : 'a .CAS'}: ${err instanceof Error ? err.message.replace(/\.$/, '') : String(err)}.`);
    }
    if (fresh) session.install(m);
    session.screenBaseline = baseline;
    const name = manifest.name || basename(file, extname(file)).toUpperCase();
    session.program = { path: file, name, bytes: bytes.length, manifest, sha256: m.debug.loaded?.sha256 ?? '' };
    // The program's labels are its sidecar's (Ruling 6); a sidecar that cannot be used is reported, not fatal.
    const found = readSidecar(file, session.program.sha256, { fixtures: config.fixtures });
    session.sidecar = {
      path: found?.path ?? sidecarPath(file),
      base: found !== null && 'file' in found ? found.file : null,
      file: found !== null && 'file' in found ? found.file : null,
      ignored: found !== null && 'ignored' in found ? found.ignored : null,
    };
    session.labels = new Map(found !== null && 'labels' in found ? found.labels.map((l) => [l.addr, l]) : []);

    const kind = format === 'cmd' ? '.CMD (load module)' : format === 'bas' ? `.BAS (${manifest.kind})` : `.CAS (${manifest.kind}, loaded at once)`;
    lines.push(`Loaded ${name} from ${file}`, `Format: ${kind}`);
    if (manifest.blocks.length === 0) lines.push('Blocks: none yet (ASCII BASIC is typed in through the ROM as the machine runs; call run, then key RUN)');
    else lines.push(`Blocks (${manifest.blocks.length}):`, ...manifest.blocks.map(block));
    if (manifest.entry !== undefined && manifest.entry !== null) lines.push(`Entry: ${hex4(manifest.entry)} (the PC is there now)`);
    else lines.push('Entry: none (a BASIC program; key RUN to start it)');
    lines.push(`ROM: ${m.rom.recognized ?? `unrecognised (SHA-256 ${m.rom.sha256.slice(0, 16)}…)`}`);
    lines.push(boot);
    lines.push(sidecarLine(session.sidecar));
    const outside = config.fixtures !== undefined && relative(config.fixtures, file).startsWith('..') ? ' (outside the fixtures folder)' : '';
    lines.push(`Path: ${file}${outside}`);
    return lines.join('\n');
  },
};
