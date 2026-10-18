/**
 * The spec §7 debugger, over a Machine. Task by task it grows breakpoints, watchpoints, coverage,
 * and a trace; the Machine consults it at each instruction boundary only while `active` is true,
 * so a machine with nothing set pays one boolean check per instruction.
 *
 * Memory and port accesses are seen by swapping the CPU's accessor functions (`readMemory`,
 * `writeMemory`, `readPort`, `writePort`) for instrumented ones only while something listens,
 * and putting the original function objects back when nothing does. An instruction fetch is not
 * a read (phase 3 Ruling 2): `startInstruction` records the instruction's start and length, and
 * read k of the instruction is a fetch when k < len and its address is pc + k (the core fetches
 * every instruction's bytes first, in order; a test checks that for every opcode).
 */
import { instructionInfo } from './instr.js';
import { serializeState, restoreState } from './state.js';
import { writeLabelFile } from './label-file.js';
import { sha256Hex } from '../machine/sha256.js';

/** The hit log keeps the newest this many hits. */
const RING = 65536;

/**
 * Coverage bits, one byte per address (spec §7): `EXEC` is the first byte of an executed
 * instruction, prefix included, and `OPERAND` its other bytes (phase 3 Ruling 1); `READ` and
 * `WRITE` are data accesses, never fetches (Ruling 2); `JUMP_TARGET` is where a taken jump, jump
 * relative, `DJNZ`, or `JP (HL)` landed, and `CALL_TARGET` where a taken call or `RST` did. Where a
 * return lands is not marked (the callers map still records it as `ret-to`).
 */
export const COVERAGE = Object.freeze({ EXEC: 1, OPERAND: 2, READ: 4, WRITE: 8, JUMP_TARGET: 16, CALL_TARGET: 32 });

/** Callers kinds by index; an edge is keyed `from * 8 + index` within its target. */
const EDGE_KINDS = /** @type {const} */ (['call', 'jp', 'jr', 'rst', 'ret-to']);
/** @type {Record<string, number>} An `instructionInfo` kind → its EDGE_KINDS index. */
const EDGE_OF = { call: 0, jp: 1, 'jp-ind': 1, jr: 2, djnz: 2, rst: 3, ret: 4 };
const { EXEC, OPERAND, READ, WRITE, JUMP_TARGET, CALL_TARGET } = COVERAGE;

/**
 * @typedef {{ id: number, addr: number, once: boolean, hits: number, when?: (m: any) => boolean }} BreakEntry
 * @typedef {{ id: number, addr: number, len: number, read: boolean, write: boolean, stop: boolean, hits: number }} WatchEntry
 * @typedef {{ id: number, kind: 'read' | 'write', cycle: number, pc: number, addr: number, value: number, prev: number }} Hit
 * @typedef {((addr: number, value: number, pc: number) => void) | null} ReadHook
 * @typedef {((addr: number, value: number, prev: number, pc: number) => void) | null} WriteHook
 * @typedef {((port: number, value: number, dir: 'in' | 'out', pc: number) => void) | null} PortHook
 * @typedef {{ pc: number, bytes: number[], cycles: number, regs?: any }} TraceEntry
 * @typedef {{ from: number, kind: 'call' | 'jp' | 'jr' | 'rst' | 'ret-to', count: number }} CallerEdge
 * @typedef {{ addr: number, name: string, kind: 'code' | 'data', size?: number, source: 'user', note?: string }} UserLabel
 */

/** A label name: an identifier of up to 32 characters, as the disassembler's hint file takes. */
const LABEL_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;

export class Debugger {
  /** @type {boolean} True while anything needs per-instruction work. */
  active = false;
  /** @type {number | null} The id of the breakpoint that made the last `beforeInstruction` stop. */
  stopId = null;
  /** @type {boolean} True while memory reads or writes are instrumented (coverage, a watch, or a memory hook listens). */
  tracksAccess = false;
  /** @type {boolean} True while the Machine must call `startInstruction` before each instruction: memory accesses are instrumented or the trace is on. */
  startsInstruction = false;
  /** @type {boolean} True when the hit log dropped its oldest hits to stay at 65,536. */
  hitsOverflowed = false;
  /**
   * @type {{ onMemRead: ReadHook, onMemWrite: WriteHook, onPort: PortHook }}
   * Called on every data read (fetches excluded), every memory write (with the byte it replaced),
   * and every port access. The last argument, `pc`, is the start of the instruction making the
   * access, as a hit's `pc` (the CPU's PC outside one, or for a port access while no memory
   * access is instrumented). Setting one to a function or null re-instruments the CPU.
   */
  hooks;
  /**
   * @type {{ enable(): void, disable(): void, clear(): void, readonly enabled: boolean, readonly bits: Uint8Array,
   *   readonly keys: string[], bitsOf(key: string): Uint8Array | undefined }}
   * Per-byte coverage and the callers map, behind one switch (phase 3 Ruling 6). `disable` keeps
   * what was recorded and `clear` empties both. Coverage is kept per `(map, page)` (spec §8): the
   * Model III and Model I have only `"0:0"`; the Model 4 keeps one bitfield for each memory map
   * (port $84 bits 0-1) and 128K page select (bits 4-6, always 0 with 64K) it has run in, keyed
   * `"<map>:<page>"`. `bits` is the live bitfield of the map and page in force now, `keys` the
   * keys recorded (`"0:0"` always first, the rest in the order first seen), and `bitsOf` one
   * key's live bitfield.
   */
  coverage;
  /**
   * @type {{ enable(opts: { depth: number, regs?: boolean }): void, disable(): void, clear(): void,
   *   last(n: number): TraceEntry[], collapsed(n: number): { entries: TraceEntry[], repeat: number }[], readonly enabled: boolean }}
   * The instruction trace (spec §7): a preallocated ring of the last `depth` executed instructions.
   * `enable` allocates a fresh, empty ring; `disable` keeps what was recorded; `clear` empties it.
   */
  trace;

  #machine;
  /** @type {any} The Z80CPU whose accessors are swapped. */
  #cpu;
  /** @type {{ readMemory: (a: number) => number, writeMemory: (a: number, v: number) => void, readPort: (p: number) => number, writePort: (p: number, v: number) => void, peek: (a: number) => number }} The CPU's own accessors, restored when nothing listens, and `peek`, a read with no device side effect (memory.peekByte) for the debugger's own looks at memory. */
  #plain;
  /** @type {Map<number, BreakEntry[]>} */
  #breaks = new Map();
  /** @type {Map<number, WatchEntry>} In id order. */
  #watches = new Map();
  /** Per address: bit 0 set when a read watch covers it, bit 1 for a write watch. */
  #watchMask = new Uint8Array(0x10000);
  #nextId = 1;
  /** @type {ReadHook} */
  #onMemRead = null;
  /** @type {WriteHook} */
  #onMemWrite = null;
  /** @type {PortHook} */
  #onPort = null;

  /** True between `startInstruction` and `afterInstruction`: accesses then belong to the instruction at `#pc`. */
  #inInstr = false;
  #pc = 0;
  /** Bytes the current instruction fetches (0 when reads are not instrumented). */
  #len = 0;
  /** Reads the current instruction has made so far. */
  #reads = 0;
  /** True while `readMemory` is instrumented, so `startInstruction` needs the length. */
  #readsOn = false;
  /** @type {number[]} The ids of the stop watches hit since the last `afterInstruction` (or pending from a breakpoint stop), unsorted. */
  #stopHits = [];

  /** True while coverage is enabled. */
  #covOn = false;
  /** True while coverage records: enabled, and not inside the keyboard hook's stand-in RET. */
  #marking = false;
  /** True during the keyboard hook's stand-in RET. */
  #inStandIn = false;
  #bits = new Uint8Array(0x10000);
  /** True on a machine whose memory has maps and pages (the Model 4), so the bitfield follows them. */
  #banked = false;
  /** The memory, for its `map` and `page` on the Model 4. @type {any} */
  #memory;
  /** The `(map, page)` `#bits` belongs to, as map × 8 + page. */
  #covKey = 0;
  /** @type {Map<number, Uint8Array>} Every `(map, page)`'s bitfield, by map × 8 + page; `0` (`"0:0"`) always present. */
  #covByKey = new Map();
  /** @type {Map<number, Map<number, CallerEdge>>} target → (from * 8 + kind index) → edge */
  #callers = new Map();
  /** @type {string | null} The current instruction's `instructionInfo` kind (null unless coverage looked it up). */
  #kind = null;
  /** @type {number | null} The current instruction's static target. */
  #target = null;

  /** True while the trace records. */
  #traceOn = false;
  #traceRegs = false;
  #depth = 0;
  /** The slot the next entry fills, and how many slots hold entries. */
  #tHead = 0;
  #tCount = 0;
  #tPcs = new Uint16Array(0);
  #tLens = new Uint8Array(0);
  #tBytes = new Uint8Array(0);
  #tCycles = new Uint16Array(0);
  /** @type {any[]} */
  #tRegs = [];
  /** True between `startInstruction` and `afterInstruction` when an entry is open. */
  #tOpen = false;
  #tStart = 0;

  /** @type {Hit[]} The hit log, a ring once full: `#ringHead` is the oldest entry. */
  #ring = [];
  #ringHead = 0;

  /** @type {Map<number, UserLabel>} User labels by address. */
  #labels = new Map();
  /** @type {{ manifest: any, sha256: string } | null} The last `m.load.*` call's manifest and the SHA-256 of the bytes it was given. */
  #loaded = null;
  /** @type {{ addr: number, bytes: Uint8Array }[]} What the last load placed in memory: each landed manifest block's bytes, read back once the loader finished. */
  #placed = [];
  /** The Model 4's port $84 byte when the last load placed its bytes (0 on the other models). */
  #placedReg = 0;

  /** @param {any} machine */
  constructor(machine) {
    this.#machine = machine;
    const cpu = machine.system.cpu;
    this.#cpu = cpu;
    const memory = machine.system.memory;
    this.#memory = memory;
    this.#banked = typeof memory.setMapRegister === 'function';
    this.#covByKey.set(0, this.#bits);
    // The debugger's own reads (an old value, the look-ahead, the trace, the label file) peek: a
    // CPU read of the Model I's $37E0 clears the latch's clock bit, and one of $37EC drops the
    // WD1771's INTRQ. With no Expansion Interface (every Model III) a read has no side effect, and
    // the CPU's own accessor serves.
    this.#plain = {
      readMemory: cpu.readMemory,
      writeMemory: cpu.writeMemory,
      readPort: cpu.readPort,
      writePort: cpu.writePort,
      peek: memory.expansion === null ? cpu.readMemory : (/** @type {number} */ a) => memory.peekByte(a),
    };
    const dbg = this;
    /** @param {string} name @param {unknown} f */
    const check = (name, f) => {
      if (f !== null && typeof f !== 'function') throw new Error(`hooks.${name} must be a function or null, not ${String(f)}`);
    };
    this.hooks = {
      get onMemRead() {
        return dbg.#onMemRead;
      },
      set onMemRead(f) {
        check('onMemRead', f);
        dbg.#onMemRead = f;
        dbg.#refresh();
      },
      get onMemWrite() {
        return dbg.#onMemWrite;
      },
      set onMemWrite(f) {
        check('onMemWrite', f);
        dbg.#onMemWrite = f;
        dbg.#refresh();
      },
      get onPort() {
        return dbg.#onPort;
      },
      set onPort(f) {
        check('onPort', f);
        dbg.#onPort = f;
        dbg.#refresh();
      },
    };
    this.coverage = {
      enable() {
        dbg.#covOn = true;
        dbg.#refresh();
      },
      disable() {
        dbg.#covOn = false;
        dbg.#refresh();
      },
      clear() {
        for (const b of dbg.#covByKey.values()) b.fill(0);
        // Keep "0:0" and the bitfield in force (their arrays stay the same); forget the rest.
        for (const k of [...dbg.#covByKey.keys()]) if (k !== 0 && k !== dbg.#covKey) dbg.#covByKey.delete(k);
        dbg.#callers.clear();
      },
      get enabled() {
        return dbg.#covOn;
      },
      get bits() {
        if (dbg.#banked) dbg.#syncBits();
        return dbg.#bits;
      },
      get keys() {
        if (dbg.#banked) dbg.#syncBits();
        return [...dbg.#covByKey.keys()].map(keyText);
      },
      bitsOf(key) {
        const m = /^(\d):(\d)$/.exec(String(key));
        return m === null ? undefined : dbg.#covByKey.get(Number(m[1]) * 8 + Number(m[2]));
      },
    };
    this.trace = {
      enable({ depth, regs = false } = /** @type {any} */ ({})) {
        if (!Number.isInteger(depth) || depth < 1 || depth > 1000000) throw new Error(`trace: depth must be an integer 1..1000000 (the trace is never unlimited), not ${String(depth)}`);
        dbg.#depth = depth;
        dbg.#traceRegs = !!regs;
        dbg.#tPcs = new Uint16Array(depth);
        dbg.#tLens = new Uint8Array(depth);
        dbg.#tBytes = new Uint8Array(depth * 4);
        dbg.#tCycles = new Uint16Array(depth);
        dbg.#tRegs = regs ? new Array(depth) : [];
        dbg.#tHead = 0;
        dbg.#tCount = 0;
        dbg.#tOpen = false;
        dbg.#traceOn = true;
        dbg.#refresh();
      },
      disable() {
        dbg.#traceOn = false;
        dbg.#tOpen = false;
        dbg.#refresh();
      },
      clear() {
        dbg.#tHead = 0;
        dbg.#tCount = 0;
        dbg.#tOpen = false;
        if (dbg.#traceRegs) dbg.#tRegs = new Array(dbg.#depth);
      },
      last: (n) => dbg.#last(n),
      collapsed: (n) => collapse(dbg.#last(n)),
      get enabled() {
        return dbg.#traceOn;
      },
    };
  }

  /**
   * A serializable snapshot of the machine (spec §7): everything `serializeState` carries. It
   * survives `JSON.stringify` and `parse`.
   * @returns {any}
   */
  snapshot() {
    return serializeState(this.#machine.system);
  }

  /**
   * Restore the machine exactly from a snapshot, cycles included, then start a fresh timeline:
   * the key queue and the sound ring are cleared, and the Machine forgets where the last run
   * stopped and any watch stop pending. Breakpoints, watches, hooks, the hit log, coverage,
   * callers, the trace, and labels stay as they were.
   * @param {any} snap
   */
  restore(snap) {
    restoreState(this.#machine.system, snap);
    this.#stopHits = [];
    this.#inInstr = false;
    this.#tOpen = false;
    this.#machine.newTimeline();
  }

  /**
   * Name an address (a `source: 'user'` label in the label file, which wins over an observed one
   * there). A second label at the same address replaces the first.
   * @param {number} addr 0..$FFFF
   * @param {string} name an identifier: a letter or `_`, then letters, digits, or `_`, up to 32 characters
   * @param {{ kind?: 'code' | 'data', size?: number, note?: string }} [opts] `size` is how many bytes the label covers (1..65536); `note` is a remark for a human, with no control character
   */
  label(addr, name, { kind = 'code', size, note } = {}) {
    if (!Number.isInteger(addr) || addr < 0 || addr > 0xffff) throw new Error(`label: address must be an integer 0..65535 ($0000..$FFFF), not ${String(addr)}`);
    if (typeof name !== 'string' || !LABEL_NAME.test(name)) throw new Error(`label: name must be an identifier (a letter or _, then letters, digits, or _, up to 32 characters), not ${JSON.stringify(name)}`);
    if (kind !== 'code' && kind !== 'data') throw new Error(`label: kind must be 'code' or 'data', not ${String(kind)}`);
    if (size !== undefined && (!Number.isInteger(size) || size < 1 || size > 0x10000)) throw new Error(`label: size must be an integer 1..65536, not ${String(size)}`);
    if (note !== undefined && (typeof note !== 'string' || /[\u0000-\u001f\u007f]/.test(note))) throw new Error(`label: note must be a string with no control character, not ${JSON.stringify(note)}`);
    /** @type {UserLabel} */
    const l = size === undefined ? { addr, name, kind, source: 'user' } : { addr, name, kind, size, source: 'user' };
    if (note !== undefined) l.note = note;
    this.#labels.set(addr, l);
  }

  /** @returns {UserLabel[]} the user labels, copies, sorted by address */
  get labels() {
    return [...this.#labels.values()].sort((a, b) => a.addr - b.addr).map((l) => ({ ...l }));
  }

  /** @returns {{ manifest: any, sha256: string } | null} the last `m.load.*` call's manifest and the SHA-256 (hex) of the bytes it was given, or null */
  get loaded() {
    return this.#loaded === null ? null : JSON.parse(JSON.stringify(this.#loaded));
  }

  /**
   * Internal: called by each `m.load.*` after it succeeds.
   * @param {any} manifest
   * @param {Uint8Array} bytes the bytes the loader was given
   */
  recordLoad(manifest, bytes) {
    this.#loaded = { manifest: JSON.parse(JSON.stringify(manifest)), sha256: sha256Hex(bytes) };
    this.#placedReg = this.#banked ? this.#memory.mapRegister : 0;
    // A copy of what landed, so the label file can tell which loaded bytes changed since (a
    // block still `predicted` has not landed). Read after the loader, so a later block wins.
    const read = this.#plain.peek;
    this.#placed = manifest.blocks
      .filter((/** @type {any} */ b) => !b.predicted)
      .map((/** @type {any} */ b) => {
        const placed = new Uint8Array(b.len);
        for (let i = 0; i < b.len; i++) placed[i] = read((b.addr + i) & 0xffff);
        return { addr: b.addr, bytes: placed };
      });
  }

  /**
   * The spec §8 label and coverage file for this session: the program (named by `name`, else by
   * the last load's manifest), its loaded blocks and entry, labels (`ENTRY`, observed call
   * targets in the loaded blocks, user labels), the six coverage fields, the callers map, and one
   * session. The core reads no clock: `started` is recorded only when the caller passes it.
   * `write` marks a byte written while coverage was on, or a loaded byte that differs now from
   * what the load placed there (so a program that rewrote itself before coverage started still
   * says so); the live `coverage.bits` are not changed.
   * @param {{ name?: string, started?: string, input?: string }} [opts]
   * @returns {import('./label-file.js').LabelFile}
   */
  labelFile({ name, started, input } = {}) {
    if (this.#banked) this.#syncBits();
    /** @type {Map<number, Uint8Array>} */
    const copies = new Map();
    for (const [k, b] of this.#covByKey) copies.set(k, b.slice());
    // The loaded bytes are compared in the map and page they were loaded in (on the Model 4 the
    // register is set back to the load's for the comparison, then restored; nothing else reads it).
    const memory = this.#memory;
    const now = this.#banked ? memory.mapRegister : 0;
    const then = this.#banked ? this.#placedReg : 0;
    const read = this.#plain.peek;
    if (then !== now) memory.setMapRegister(then);
    try {
      const key = this.#banked ? memory.map * 8 + memory.page : 0;
      let bits = copies.get(key);
      if (bits === undefined) copies.set(key, (bits = new Uint8Array(0x10000)));
      for (const { addr, bytes } of this.#placed) {
        for (let i = 0; i < bytes.length; i++) {
          const a = (addr + i) & 0xffff;
          if (read(a) !== bytes[i]) bits[a] |= WRITE;
        }
      }
    } finally {
      if (then !== now) memory.setMapRegister(now);
    }
    /** @type {Map<string, Uint8Array>} */
    const coverage = new Map();
    for (const [k, b] of copies) coverage.set(keyText(k), b);
    return writeLabelFile({
      name,
      started,
      input,
      loaded: this.#loaded,
      userLabels: [...this.#labels.values()],
      bits: coverage,
      callerMap: this.callerMap(),
      cycles: this.#cpu.cycles,
      model: this.#machine.model,
    });
  }

  /** @param {number} n @returns {TraceEntry[]} the newest `n` entries, oldest first */
  #last(n) {
    const count = Math.min(Math.max(0, Math.floor(n) || 0), this.#tCount);
    const out = [];
    const depth = this.#depth;
    for (let k = count; k > 0; k--) {
      const i = (this.#tHead - k + depth) % depth;
      const len = this.#tLens[i];
      /** @type {TraceEntry} */
      const e = { pc: this.#tPcs[i], bytes: Array.from(this.#tBytes.subarray(i * 4, i * 4 + len)), cycles: this.#tCycles[i] };
      if (this.#traceRegs) e.regs = { ...this.#tRegs[i] };
      out.push(e);
    }
    return out;
  }

  /**
   * Stop before the instruction at `addr` runs.
   * @param {number} addr 0..$FFFF
   * @param {{ once?: boolean, when?: (m: any) => boolean }} [opts] `once` removes it after its first hit; `when` gates each hit
   * @returns {number} the breakpoint id (ids count up from 1 across breakpoints and watches)
   */
  break(addr, { once = false, when } = {}) {
    if (!Number.isInteger(addr) || addr < 0 || addr > 0xffff) throw new Error(`break: address must be an integer 0..65535 ($0000..$FFFF), not ${String(addr)}`);
    if (when !== undefined && typeof when !== 'function') throw new Error(`break: when must be a function, not ${String(when)}`);
    const id = this.#nextId++;
    const list = this.#breaks.get(addr);
    const entry = { id, addr, once, hits: 0, when };
    if (list) list.push(entry);
    else this.#breaks.set(addr, [entry]);
    this.#refresh();
    return id;
  }

  /**
   * Remove a breakpoint.
   * @param {number} id
   * @returns {boolean} false when no breakpoint has that id
   */
  unbreak(id) {
    for (const [addr, list] of this.#breaks) {
      const k = list.findIndex((e) => e.id === id);
      if (k < 0) continue;
      list.splice(k, 1);
      if (list.length === 0) this.#breaks.delete(addr);
      this.#refresh();
      return true;
    }
    return false;
  }

  /** @returns {{ id: number, addr: number, once: boolean, hits: number }[]} the breakpoints, in id order */
  get breaks() {
    const out = [];
    for (const list of this.#breaks.values()) for (const e of list) out.push({ id: e.id, addr: e.addr, once: e.once, hits: e.hits });
    return out.sort((a, b) => a.id - b.id);
  }

  /**
   * Watch memory accesses to `len` bytes from `addr` (wrapping at $FFFF). Each matching access is
   * logged (`hits`); with `stop`, `run` returns `{ reason: 'watch', id }` after the instruction
   * that made it. Instruction fetches are not reads.
   * @param {number} addr 0..$FFFF
   * @param {number} len 1..65536
   * @param {{ read?: boolean, write?: boolean, stop?: boolean }} [opts] at least one of `read` and `write`
   * @returns {number} the watch id (ids count up from 1 across breakpoints and watches)
   */
  watch(addr, len, { read = false, write = true, stop = false } = {}) {
    if (!Number.isInteger(addr) || addr < 0 || addr > 0xffff) throw new Error(`watch: address must be an integer 0..65535 ($0000..$FFFF), not ${String(addr)}`);
    if (!Number.isInteger(len) || len < 1 || len > 0x10000) throw new Error(`watch: len must be an integer 1..65536, not ${String(len)}`);
    if (!read && !write) throw new Error('watch: it must watch read or write (or both); with neither it would never hit');
    const id = this.#nextId++;
    this.#watches.set(id, { id, addr, len, read: !!read, write: !!write, stop: !!stop, hits: 0 });
    this.#rebuildMask();
    this.#refresh();
    return id;
  }

  /**
   * Remove a watchpoint. Its hits stay in the log.
   * @param {number} id
   * @returns {boolean} false when no watch has that id
   */
  unwatch(id) {
    if (!this.#watches.delete(id)) return false;
    // A stop this watch made and `run` has not yet returned goes with it.
    if (this.#stopHits.length > 0) this.#stopHits = this.#stopHits.filter((x) => x !== id);
    this.#rebuildMask();
    this.#refresh();
    return true;
  }

  /** @returns {WatchEntry[]} the watchpoints, in id order */
  get watches() {
    return [...this.#watches.values()].map((w) => ({ ...w }));
  }

  /**
   * The hit log, oldest first: the newest 65,536 hits (`hitsOverflowed` tells whether older ones
   * were dropped). `pc` is the start of the instruction making the access, or the CPU's PC for an
   * access outside one (an interrupt response, the keyboard hook's stand-in RET); `cycle` is
   * `m.cycles` at the access; `prev` is the byte a write replaced, and equals `value` for a read.
   * @param {number} [id] only this watch's hits
   * @returns {Hit[]}
   */
  hits(id) {
    const ring = this.#ring;
    const out = ring.length < RING ? ring.slice() : [...ring.slice(this.#ringHead), ...ring.slice(0, this.#ringHead)];
    return id === undefined ? out : out.filter((h) => h.id === id);
  }

  /**
   * Who transferred control to `addr`, with how many times each edge was taken: calls, jumps
   * (`JP (HL)` included), relative jumps (`DJNZ` included), `RST`s, and returns (`ret-to`).
   * Recorded while coverage is enabled; an interrupt response and the keyboard hook's stand-in
   * RET are not instructions and record nothing.
   * @param {number} addr
   * @returns {CallerEdge[]} fresh objects, sorted by `from`, then `kind`
   */
  callers(addr) {
    const edges = this.#callers.get(addr & 0xffff);
    return edges === undefined ? [] : sortEdges(edges);
  }

  /** @returns {Map<number, CallerEdge[]>} every target's callers, as `callers` gives them, in the order targets were first reached */
  callerMap() {
    const out = new Map();
    for (const [target, edges] of this.#callers) out.set(target, sortEdges(edges));
    return out;
  }

  /** Empty the hit log and clear `hitsOverflowed`. */
  clearHits() {
    this.#ring = [];
    this.#ringHead = 0;
    this.hitsOverflowed = false;
  }

  /**
   * Internal: called at an instruction boundary before the instruction runs.
   * @param {number} pc
   * @param {boolean} first true for a run's first boundary, which never stops, so a run resumes past the breakpoint it stopped at
   * @returns {boolean} true to stop; `stopId` then names the breakpoint (the lowest id when several hit)
   */
  beforeInstruction(pc, first) {
    if (first) return false;
    const list = this.#breaks.get(pc);
    if (list === undefined) return false;
    let stop = null;
    for (const e of list.slice()) {
      if (e.when !== undefined && !e.when(this.#machine)) continue;
      e.hits++;
      if (stop === null) stop = e.id;
      if (e.once) this.unbreak(e.id);
    }
    this.stopId = stop;
    return stop !== null;
  }

  /**
   * Internal: called while `tracksAccess`, once the boundary is certain to execute an instruction
   * at `pc` (not for a breakpoint stop, a halted CPU's idle, or the keyboard hook's stand-in RET).
   * @param {number} pc
   */
  startInstruction(pc) {
    this.#pc = pc;
    this.#reads = 0;
    this.#inInstr = true;
    // Reset each instruction, so coverage enabled by a hook mid-instruction records no stale edge.
    this.#kind = null;
    if (this.#traceOn) this.#traceStart(pc);
    if (!this.#readsOn) {
      this.#len = 0;
      return;
    }
    // The look-ahead peeks, so it clears no device latch (the Model I's $37E0 and $37EC).
    const info = instructionInfo(this.#plain.peek, pc);
    const len = info.len;
    this.#len = len;
    if (this.#covOn) {
      if (this.#banked) this.#syncBits();
      this.#kind = info.kind;
      this.#target = info.target;
      const bits = this.#bits;
      bits[pc] |= EXEC;
      for (let k = 1; k < len; k++) bits[(pc + k) & 0xffff] |= OPERAND;
    }
  }

  /**
   * Internal: on a breakpoint stop, close any open instruction but keep a pending watch stop (one
   * the boundary's interrupt response hit), so the next run returns it after the held instruction.
   */
  endInstruction() {
    this.#inInstr = false;
  }

  /**
   * Internal: called after each boundary while `active`. Ends the instruction `startInstruction` began.
   * @returns {number | null} the lowest id of a stop watch hit since the last call, or null
   */
  afterInstruction() {
    if (this.#tOpen) {
      this.#tCycles[(this.#tHead - 1 + this.#depth) % this.#depth] = this.#cpu.cycles - this.#tStart;
      this.#tOpen = false;
    }
    if (this.#inInstr && this.#covOn && this.#kind !== null) this.#transfer();
    this.#inInstr = false;
    const hits = this.#stopHits;
    if (hits.length === 0) return null;
    this.#stopHits = [];
    return Math.min(...hits);
  }

  /**
   * Internal: around the keyboard hook's stand-in RET, which executes no instruction and so marks
   * no coverage (its stack reads are still logged by watches and hooks).
   * @param {boolean} on
   */
  standIn(on) {
    this.#inStandIn = on;
    this.#marking = this.#covOn && !on;
  }

  /** Open the next trace entry for the instruction at `pc`: its bytes and registers before it runs; `afterInstruction` adds its T-states. */
  #traceStart(/** @type {number} */ pc) {
    const i = this.#tHead;
    const read = this.#plain.peek;
    const len = instructionInfo(read, pc).len;
    this.#tPcs[i] = pc;
    this.#tLens[i] = len;
    for (let k = 0; k < len; k++) this.#tBytes[i * 4 + k] = read((pc + k) & 0xffff);
    if (this.#traceRegs) this.#tRegs[i] = this.#machine.cpu.regs;
    this.#tHead = (i + 1) % this.#depth;
    if (this.#tCount < this.#depth) this.#tCount++;
    this.#tStart = this.#cpu.cycles;
    this.#tOpen = true;
  }

  /** After a control-transfer instruction: when it was taken, mark where it landed (not for a return) and count the edge. */
  #transfer() {
    const kind = /** @type {string} */ (this.#kind);
    const pc = this.#pc;
    const to = this.#cpu.registers.PC & 0xffff;
    if (kind === 'ret') {
      if (to === ((pc + this.#len) & 0xffff)) return;
    } else if (kind !== 'jp-ind' && to !== this.#target) return;
    const e = EDGE_OF[kind];
    if (e === 0 || e === 3) this.#bits[to] |= CALL_TARGET;
    else if (e !== 4) this.#bits[to] |= JUMP_TARGET;
    let edges = this.#callers.get(to);
    if (edges === undefined) {
      edges = new Map();
      this.#callers.set(to, edges);
    }
    const key = pc * 8 + e;
    const edge = edges.get(key);
    if (edge !== undefined) edge.count++;
    else edges.set(key, { from: pc, kind: EDGE_KINDS[e], count: 1 });
  }

  /**
   * Point `#bits` at the bitfield of the Model 4's map and page in force now, making it on first
   * use. Called before each mark, so a mark lands in the `(map, page)` of the access, interrupt
   * responses and a restored state included.
   */
  #syncBits() {
    const memory = this.#memory;
    const k = memory.map * 8 + memory.page;
    if (k === this.#covKey) return;
    this.#covKey = k;
    let b = this.#covByKey.get(k);
    if (b === undefined) this.#covByKey.set(k, (b = new Uint8Array(0x10000)));
    this.#bits = b;
  }

  /** The instrumented `readMemory`: fetches pass straight through. */
  #read = (/** @type {number} */ addr) => {
    const value = this.#plain.readMemory(addr);
    if (this.#inInstr) {
      const k = this.#reads++;
      if (k < this.#len && addr === ((this.#pc + k) & 0xffff)) return value;
    }
    addr &= 0xffff;
    if (this.#marking) {
      if (this.#banked) this.#syncBits();
      this.#bits[addr] |= READ;
    }
    if (this.#watchMask[addr] & 1) this.#hit('read', addr, value, value);
    if (this.#onMemRead !== null) this.#onMemRead(addr, value, this.#accessPc());
    return value;
  };

  /** The instrumented `writeMemory`. */
  #write = (/** @type {number} */ addr, /** @type {number} */ value) => {
    addr &= 0xffff;
    value &= 0xff;
    const watched = (this.#watchMask[addr] & 2) !== 0;
    const prev = watched || this.#onMemWrite !== null ? this.#plain.peek(addr) : 0;
    this.#plain.writeMemory(addr, value);
    if (this.#marking) {
      if (this.#banked) this.#syncBits();
      this.#bits[addr] |= WRITE;
    }
    if (watched) this.#hit('write', addr, value, prev);
    if (this.#onMemWrite !== null) this.#onMemWrite(addr, value, prev, this.#accessPc());
  };

  /** The instrumented `readPort`. */
  #readPort = (/** @type {number} */ port) => {
    const value = this.#plain.readPort(port);
    if (this.#onPort !== null) this.#onPort(port, value & 0xff, 'in', this.#accessPc());
    return value;
  };

  /** The instrumented `writePort`. */
  #writePort = (/** @type {number} */ port, /** @type {number} */ value) => {
    this.#plain.writePort(port, value);
    if (this.#onPort !== null) this.#onPort(port, value & 0xff, 'out', this.#accessPc());
  };

  /** The instruction making the current access: its start inside one, else the CPU's PC. */
  #accessPc() {
    return this.#inInstr ? this.#pc : this.#cpu.registers.PC;
  }

  /**
   * Log an access every matching watch sees, in id order.
   * @param {'read' | 'write'} kind
   * @param {number} addr
   * @param {number} value
   * @param {number} prev
   */
  #hit(kind, addr, value, prev) {
    const pc = this.#accessPc();
    const cycle = this.#cpu.cycles;
    for (const w of this.#watches.values()) {
      if (!(kind === 'read' ? w.read : w.write) || ((addr - w.addr) & 0xffff) >= w.len) continue;
      w.hits++;
      const h = Object.freeze({ id: w.id, kind, cycle, pc, addr, value, prev });
      if (this.#ring.length < RING) this.#ring.push(h);
      else {
        this.#ring[this.#ringHead] = h;
        this.#ringHead = (this.#ringHead + 1) % RING;
        this.hitsOverflowed = true;
      }
      if (w.stop && !this.#stopHits.includes(w.id)) this.#stopHits.push(w.id);
    }
  }

  #rebuildMask() {
    const mask = this.#watchMask;
    mask.fill(0);
    for (const w of this.#watches.values()) {
      const bits = (w.read ? 1 : 0) | (w.write ? 2 : 0);
      for (let k = 0; k < w.len; k++) mask[(w.addr + k) & 0xffff] |= bits;
    }
  }

  /**
   * Install the instrumented CPU accessors that something listens to, and the plain ones for
   * the rest. Coverage needs the instrumented reads and writes.
   */
  #instrument() {
    let reads = this.#onMemRead !== null || this.#covOn;
    let writes = this.#onMemWrite !== null || this.#covOn;
    for (const w of this.#watches.values()) {
      reads ||= w.read;
      writes ||= w.write;
    }
    const ports = this.#onPort !== null;
    const cpu = this.#cpu;
    const plain = this.#plain;
    cpu.readMemory = reads ? this.#read : plain.readMemory;
    cpu.writeMemory = writes ? this.#write : plain.writeMemory;
    cpu.readPort = ports ? this.#readPort : plain.readPort;
    cpu.writePort = ports ? this.#writePort : plain.writePort;
    this.#readsOn = reads;
    this.#marking = this.#covOn && !this.#inStandIn;
    this.tracksAccess = reads || writes;
    this.startsInstruction = this.tracksAccess || this.#traceOn;
    if (!this.startsInstruction) this.#inInstr = false;
  }

  #refresh() {
    this.#instrument();
    this.active = this.#covOn || this.#traceOn || this.#breaks.size > 0 || this.#watches.size > 0 || this.#onMemRead !== null || this.#onMemWrite !== null || this.#onPort !== null;
  }
}

/** A `(map, page)` key, map × 8 + page, as the label file writes it: `"2:1"`. */
const keyText = (/** @type {number} */ k) => `${k >> 3}:${k & 7}`;

/**
 * @param {Map<number, CallerEdge>} edges
 * @returns {CallerEdge[]} copies sorted by `from`, then `kind`
 */
function sortEdges(edges) {
  return [...edges.values()]
    .map((e) => ({ from: e.from, kind: e.kind, count: e.count }))
    .sort((a, b) => a.from - b.from || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
}

/**
 * Merge consecutive repetitions of one PC sequence. Greedy from the oldest entry: at each
 * position try periods 1..64 and take the one covering the most entries with at least 2
 * repeats (the shortest on a tie); otherwise the entry stands alone with `repeat: 1`.
 * @param {TraceEntry[]} list
 * @returns {{ entries: TraceEntry[], repeat: number }[]}
 */
function collapse(list) {
  const out = [];
  const n = list.length;
  let i = 0;
  while (i < n) {
    let bestP = 0;
    let bestR = 0;
    let bestCover = 0;
    for (let p = 1; p <= 64 && i + 2 * p <= n; p++) {
      let r = 1;
      for (;;) {
        const at = i + r * p;
        if (at + p > n) break;
        let same = true;
        for (let k = 0; k < p; k++) {
          if (list[at + k].pc !== list[i + k].pc) {
            same = false;
            break;
          }
        }
        if (!same) break;
        r++;
      }
      if (r >= 2 && r * p > bestCover) {
        bestP = p;
        bestR = r;
        bestCover = r * p;
      }
    }
    if (bestP === 0) {
      out.push({ entries: [list[i]], repeat: 1 });
      i++;
    } else {
      out.push({ entries: list.slice(i, i + bestP), repeat: bestR });
      i += bestCover;
    }
  }
  return out;
}
