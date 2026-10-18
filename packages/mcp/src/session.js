/**
 * The one session a server process owns (docs/fugloy-mcp-spec.md §3): at most one Machine, the
 * program loaded into it, the labels, and the screen baseline `screen` diffs against. Nothing
 * runs between tool calls, so the session is plain state.
 */
import { existsSync, readFileSync } from 'node:fs';
import { Machine } from '@fugloy/emu';
import { MODELS } from './args.js';
import { recordFacts } from './attribution.js';
import { TraceLog } from './trace-log.js';
import { geometryOf } from './format/screen.js';

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

/** The models the server builds: the Model I, the Model III, and the Model 4 (emu phase 6b). */
export const BUILT_MODELS = /** @type {const} */ ([1, 3, 4]);

/** What each model's ROM is called in a sentence. */
const ROM_WHAT = /** @type {Record<number, string>} */ ({ 1: 'Model I Level II ROM', 3: 'Model III ROM', 4: 'Model 4 ROM' });

/** The RAM each model is built with: 48K, and the Model 4's full 128K. */
export const RAM_OF = /** @type {Record<number, number>} */ ({ 1: 48, 3: 48, 4: 128 });

/** `Model I`, `Model III`, or `Model 4`. */
export const modelName = (/** @type {number} */ model) => `Model ${MODELS[model] ?? model}`;

/**
 * Read the ROM a config names for `model` (`roms.model1`, `roms.model3`, or `roms.model4`).
 * Throws a sentence when none is configured or the file is missing.
 * @param {import('./config.js').Config} config
 * @param {1 | 3 | 4} [model]
 * @returns {Uint8Array}
 */
export function readRom(config, model = 3) {
  const key = `model${model}`;
  const path = config.roms[key];
  if (path === undefined) {
    const what = ROM_WHAT[model] ?? `${modelName(model)} ROM`;
    throw new Error(`No ${what} is configured; set roms.${key} in fugloy.mcp.json (see the MCP spec §3).`);
  }
  if (!existsSync(path)) throw new Error(`The configured ${modelName(model)} ROM ${path} does not exist; fix roms.${key} in ${config.source ?? 'fugloy.mcp.json'}.`);
  return new Uint8Array(readFileSync(path));
}

/**
 * A Machine of `model` (by default the config's defaultModel) on `rom` (by default the config's
 * ROM for that model), with 48K (the Model 4 with 128K), logging to stderr. A configured ROM the
 * emulator recognises as another model's is refused with a sentence naming the config entry to fix.
 * @param {import('./config.js').Config} config
 * @param {Uint8Array} [rom]
 * @param {1 | 3 | 4} [model]
 */
export function makeMachine(config, rom, model = config.defaultModel ?? 3) {
  const given = rom !== undefined;
  const image = rom ?? readRom(config, model);
  try {
    return new Machine({ model, ram: /** @type {any} */ (RAM_OF[model] ?? 48), roms: { level2: image }, log: stderrLog });
  } catch (err) {
    // The emulator names the model a recognised ROM belongs to ("…: construct the Machine with
    // model: 3"); that one is put in the server's terms. Anything else (a wrong size) is the emulator's sentence.
    const message = err instanceof Error ? err.message : String(err);
    const other = /^(.*): construct the Machine with model: (\d)\.?$/.exec(message);
    if (other === null) throw err;
    const [, why, owner] = /** @type {[string, string, string]} */ (other);
    if (given) throw new Error(`${why}; load with model ${owner}.`);
    const key = `model${model}`;
    throw new Error(`The configured roms.${key} ${config.roms[key]} cannot run the ${modelName(model)}: ${why.charAt(0).toLowerCase()}${why.slice(1)}; load with model ${owner}, or fix roms.${key} in ${config.source ?? 'fugloy.mcp.json'}.`);
  }
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
 * @typedef {{ memory: Uint8Array, mapRegister: number | null, geometry: import('./format/screen.js').Geometry }} DiffView
 *   What `diff` compares: `memory` is $3C00-$FFFF (50,176 bytes) as the CPU sees it, video RAM
 *   and RAM (on the Model 4, in the memory map and page in force); `mapRegister` the Model 4's
 *   port $84 byte then (null on the other models); `geometry` the screen's layout then.
 * @typedef {DiffView & { name: string, state: any, cycles: number, kb: number, video: Uint8Array, program: ProgramId | null, model: 1 | 3 | 4 }} Snapshot
 *   `state` is `m.debug.snapshot()`; `video` all of video RAM (1K, or the Model 4's 2K) for
 *   `screen diff` against it; `program` is null for a machine with no program loaded (powered on by `reset`);
 *   `model` the model it was taken on, which `restore` checks before the emulator does.
 */

/** The first address a snapshot keeps for `diff`: video RAM then RAM, $3C00-$FFFF. */
export const DIFF_START = 0x3c00;

/**
 * The machine's $3C00-$FFFF as `diff` compares it. On the Model III and Model I that is video
 * RAM and `m.mem.ram` (from $4000) as stored; on the Model 4, whose `m.mem.ram` is its 32K banks
 * in physical order, it is what the CPU reads in the map and page in force (peeked, which has no
 * side effect: in map 2 the keyboard at $F400-$F7FF reads the live matrix, so a key held at the
 * time shows there).
 * @param {Machine} m
 * @returns {DiffView}
 */
export function diffView(m) {
  const memory = new Uint8Array(0x10000 - DIFF_START);
  if (m.model === 4) memory.set(m.mem.read(DIFF_START, memory.length));
  else {
    memory.set(m.video.raw, 0);
    memory.set(m.mem.ram, 0x4000 - DIFF_START);
  }
  return { memory, mapRegister: m.mem.map?.register ?? null, geometry: geometryOf(m) };
}

/**
 * Where a CPU address shows video RAM in a diff view, as the offset into the 2K, or -1 (the
 * Model III's $3C00-$3FFF is offsets 0-1023; the Model 4 shows its 1K page at $3C00 in maps 0-1
 * and all 2K at $F800 in map 2, and none in map 3).
 * @param {DiffView} view
 * @param {number} addr
 */
export function videoOffset(view, addr) {
  const reg = view.mapRegister;
  if (reg === null || (reg & 3) < 2) return addr >= DIFF_START && addr < 0x4000 ? (reg !== null && reg & 0x80 ? 0x400 : 0) + addr - DIFF_START : -1;
  return (reg & 3) === 2 && addr >= 0xf800 ? addr - 0xf800 : -1;
}

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

  /**
   * A new Machine for this session's config (on `rom` when given), of `model`: by default the
   * running machine's, else the config's defaultModel. The caller installs it.
   * @param {Uint8Array} [rom]
   * @param {1 | 3 | 4} [model]
   */
  createMachine(rom, model = this.machine?.model ?? this.config.defaultModel ?? 3) {
    return makeMachine(this.config, rom, model);
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
    const p = this.program;
    /** @type {Snapshot} */
    const snap = { name, state, cycles: m.cycles, kb: Math.ceil(JSON.stringify(state).length / 1024), ...diffView(m), video: Uint8Array.from(m.video.raw), model: m.model, program: p === null ? null : { name: p.name, path: p.path, sha256: p.sha256 } };
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
