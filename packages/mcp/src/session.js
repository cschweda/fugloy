/**
 * The one session a server process owns (docs/fugloy-mcp-spec.md §3): at most one Machine, the
 * program loaded into it, the labels, and the screen baseline `screen` diffs against. Nothing
 * runs between tool calls, so the session is plain state.
 */
import { existsSync, readFileSync } from 'node:fs';
import { Machine } from '@fugloy/emu';
import { recordFacts } from './attribution.js';
import { TraceLog } from './trace-log.js';

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
 * @typedef {{ path: string, name: string, bytes: number, manifest: unknown, sha256: string, sharesCoverageWith?: string, manifestText?: string }} Program
 *   `manifestText` is what load returned, for the fugloy://program/manifest resource;
 *   `sharesCoverageWith` names an earlier program loaded into the same machine (load with reset: false), whose coverage is mixed in
 * @typedef {{ addr: number, name: string, kind?: 'code' | 'data', size?: number, source?: 'loader' | 'observed' | 'user' | 'disasm', evidence?: string, note?: string }} Label
 *   A label as the §8 file holds it; `kind` defaults to code and `source` to user.
 */

/**
 * @typedef {{ name: string, path: string, sha256: string }} ProgramId The program a snapshot belongs to.
 * @typedef {{ name: string, state: any, cycles: number, kb: number, memory: Uint8Array, program: ProgramId | null }} Snapshot
 *   `state` is `m.debug.snapshot()`; `memory` is video RAM and RAM ($3C00-$FFFF, 50,176 bytes) for `diff`;
 *   `program` is null for a machine with no program loaded (powered on by `reset`).
 */

/** The bytes a snapshot keeps for `diff`: video RAM then RAM, $3C00-$FFFF. */
export const DIFF_START = 0x3c00;

/** `limits.snapshots` as a cap: a whole number, at least 1. */
export const snapshotCap = (/** @type {import('./config.js').Config} */ config) => Math.max(1, Math.floor(config.limits.snapshots ?? 16));

/** `limits.traceDepth` as the emulator takes it: a whole number from 1 to 1,000,000. */
export const traceDepth = (/** @type {import('./config.js').Config} */ config) => Math.min(1_000_000, Math.max(1, Math.round(config.limits.traceDepth)));

export class Session {
  /** @type {Machine | null} */
  machine = null;
  /** @type {Program | null} */
  program = null;
  /** @type {Map<number, Label>} Labels by address: the sidecar's, then the agent's (src/sidecar.js). */
  labels = new Map();
  /** @type {import('./sidecar.js').SidecarState | null} The loaded program's sidecar file. */
  sidecar = null;
  /** Per instruction address, what it did while coverage was on (src/attribution.js, Ruling 4). */
  facts = new Uint8Array(0x10000);
  /** @type {Uint8Array | null} Video RAM as the last `screen` call saw it. */
  screenBaseline = null;
  /**
   * @type {Map<string, Snapshot>} Named snapshots, least recently used first (a use moves one to
   * the end); they outlive a `load`, and `restore` refuses one that belongs to another program.
   */
  snapshots = new Map();
  /** @type {{ key: string, text: string, isError: boolean } | null} The last full tool result, for `offset` paging. */
  lastOutput = null;

  /** @param {import('./config.js').Config} config */
  constructor(config) {
    this.config = config;
    /** The instructions traced runs and steps recorded (src/trace-log.js). */
    this.trace = new TraceLog(traceDepth(config));
  }

  /** A new Machine for this session's config (on `rom` when given); the caller installs it. */
  createMachine(/** @type {Uint8Array | undefined} */ rom) {
    return makeMachine(this.config, rom);
  }

  /**
   * Make `machine` the session's: coverage (and callers) on from the start (Ruling 3), with the
   * hooks that record what each instruction did for `suggest` (Ruling 4), and the screen
   * baseline at what video RAM holds now. The trace stays off (Ruling 3), and the trace log
   * starts empty.
   * @param {Machine} machine
   */
  install(machine) {
    this.machine = machine;
    this.trace.clear();
    machine.debug.coverage.enable();
    this.facts.fill(0);
    recordFacts(machine, this.facts);
    this.screenBaseline = Uint8Array.from(machine.video.raw);
  }

  /** The machine, or a throw of `No program loaded; call load first.` */
  requireMachine() {
    if (this.machine === null) throw new Error(NO_MACHINE);
    return this.machine;
  }

  /** The machine and the program loaded into it (labels and coverage belong to a program), or the same throw. */
  requireProgram() {
    const m = this.requireMachine();
    if (this.program === null || this.sidecar === null) throw new Error(NO_MACHINE);
    return { m, program: this.program, sidecar: this.sidecar };
  }

  /**
   * Save the machine as `name`, replacing a snapshot of that name, and evict the least recently
   * used one when the cap would be passed (MCP spec §3, §7).
   * @param {string} name
   * @returns {{ snap: Snapshot, replaced: boolean, evicted: string | null }}
   */
  takeSnapshot(name) {
    const m = this.requireMachine();
    const state = m.debug.snapshot();
    const memory = new Uint8Array(0x10000 - DIFF_START);
    memory.set(m.video.raw, 0);
    memory.set(m.mem.ram, 0x4000 - DIFF_START);
    const p = this.program;
    /** @type {Snapshot} */
    const snap = { name, state, cycles: m.cycles, kb: Math.ceil(JSON.stringify(state).length / 1024), memory, program: p === null ? null : { name: p.name, path: p.path, sha256: p.sha256 } };
    const replaced = this.snapshots.delete(name);
    let evicted = null;
    if (this.snapshots.size >= snapshotCap(this.config)) {
      evicted = /** @type {string} */ (this.snapshots.keys().next().value);
      this.snapshots.delete(evicted);
    }
    this.snapshots.set(name, snap);
    return { snap, replaced, evicted };
  }

  /**
   * The snapshot named `name`, marked as used now (so the cap evicts it last), or a throw naming those there are.
   * @param {string} name
   * @param {string} [extra] appended to the names in the throw
   */
  useSnapshot(name, extra = '') {
    const snap = this.snapshots.get(name);
    if (snap === undefined) {
      const names = [...this.snapshots.keys()];
      throw new Error(`There is no snapshot named ${JSON.stringify(name)}; ${names.length === 0 ? 'none has been taken yet' : `the snapshots are ${names.join(', ')}`}${extra}.`);
    }
    this.snapshots.delete(name);
    this.snapshots.set(name, snap);
    return snap;
  }
}
