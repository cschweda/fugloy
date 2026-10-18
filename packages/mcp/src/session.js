/**
 * The one session a server process owns (docs/fugloy-mcp-spec.md §3): at most one Machine, the
 * program loaded into it, the labels, and the screen baseline `screen` diffs against. Nothing
 * runs between tool calls, so the session is plain state.
 */
import { existsSync, readFileSync } from 'node:fs';
import { Machine } from '@fugloy/emu';

/** The sentence every tool that needs a machine answers before the first `load`. */
export const NO_MACHINE = 'No program loaded; call load first.';

/**
 * Where the emulator's `log` goes: stderr, one line each, since stdout carries the protocol.
 * @param {string} level
 * @param {string} text
 */
export function stderrLog(level, text) {
  process.stderr.write(`[emu ${level}] ${text}\n`);
}

/**
 * Read the Model III ROM a config names. Throws a sentence when none is configured or the file is missing.
 * @param {import('./config.js').Config} config
 * @returns {Uint8Array}
 */
export function readRom(config) {
  const path = config.roms.model3;
  if (path === undefined) throw new Error('No Model III ROM is configured; set roms.model3 in fugloy.mcp.json (see the MCP spec §3).');
  if (!existsSync(path)) throw new Error(`The configured Model III ROM ${path} does not exist; fix roms.model3 in ${config.source ?? 'fugloy.mcp.json'}.`);
  return new Uint8Array(readFileSync(path));
}

/**
 * A Model III Machine on `rom` (by default the config's), logging to stderr.
 * @param {import('./config.js').Config} config
 * @param {Uint8Array} [rom]
 */
export function makeMachine(config, rom = readRom(config)) {
  return new Machine({ model: 3, ram: 48, roms: { level2: rom }, log: stderrLog });
}

/**
 * @typedef {{ path: string, name: string, bytes: number, manifest: unknown, sha256: string }} Program
 * @typedef {{ addr: number, name: string, kind?: 'code' | 'data', size?: number, note?: string }} Label
 */

export class Session {
  /** @type {Machine | null} */
  machine = null;
  /** @type {Program | null} */
  program = null;
  /** @type {Map<number, Label>} Labels by address. */
  labels = new Map();
  /** @type {Uint8Array | null} Video RAM as the last `screen` call saw it. */
  screenBaseline = null;
  /** @type {{ key: string, text: string } | null} The last full tool result, for `offset` paging. */
  lastOutput = null;

  /** @param {import('./config.js').Config} config */
  constructor(config) {
    this.config = config;
  }

  /** A new Machine for this session's config (on `rom` when given); the caller installs it. */
  createMachine(/** @type {Uint8Array | undefined} */ rom) {
    return makeMachine(this.config, rom);
  }

  /**
   * Make `machine` the session's: coverage (and callers) on from the start (Ruling 3), and the
   * screen baseline at what video RAM holds now. The trace stays off (Ruling 3).
   * @param {Machine} machine
   */
  install(machine) {
    this.machine = machine;
    machine.debug.coverage.enable();
    this.screenBaseline = Uint8Array.from(machine.video.raw);
  }

  /** The machine, or a throw of `No program loaded; call load first.` */
  requireMachine() {
    if (this.machine === null) throw new Error(NO_MACHINE);
    return this.machine;
  }
}
