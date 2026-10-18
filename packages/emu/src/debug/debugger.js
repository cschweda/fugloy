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
 * @typedef {((addr: number, value: number) => void) | null} ReadHook
 * @typedef {((addr: number, value: number, prev: number) => void) | null} WriteHook
 * @typedef {((port: number, value: number, dir: 'in' | 'out') => void) | null} PortHook
 * @typedef {{ from: number, kind: 'call' | 'jp' | 'jr' | 'rst' | 'ret-to', count: number }} CallerEdge
 */

export class Debugger {
  /** @type {boolean} True while anything needs per-instruction work. */
  active = false;
  /** @type {number | null} The id of the breakpoint that made the last `beforeInstruction` stop. */
  stopId = null;
  /** @type {boolean} True while memory accesses are instrumented, so the Machine calls `startInstruction` before each instruction. */
  tracksAccess = false;
  /** @type {boolean} True when the hit log dropped its oldest hits to stay at 65,536. */
  hitsOverflowed = false;
  /**
   * @type {{ onMemRead: ReadHook, onMemWrite: WriteHook, onPort: PortHook }}
   * Called on every data read (fetches excluded), every memory write (with the byte it replaced),
   * and every port access. Setting one to a function or null re-instruments the CPU.
   */
  hooks;
  /**
   * @type {{ enable(): void, disable(): void, clear(): void, readonly enabled: boolean, readonly bits: Uint8Array }}
   * Per-byte coverage and the callers map, behind one switch (phase 3 Ruling 6). `bits` is live;
   * `disable` keeps what was recorded and `clear` empties both.
   */
  coverage;

  #machine;
  /** @type {any} The Z80CPU whose accessors are swapped. */
  #cpu;
  /** @type {{ readMemory: (a: number) => number, writeMemory: (a: number, v: number) => void, readPort: (p: number) => number, writePort: (p: number, v: number) => void }} The CPU's own accessors, restored when nothing listens. */
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
  /** @type {number | null} The lowest id of a stop watch hit since the last `afterInstruction`. */
  #stopHit = null;

  /** True while coverage is enabled. */
  #covOn = false;
  /** True while coverage records: enabled, and not inside the keyboard hook's stand-in RET. */
  #marking = false;
  /** True during the keyboard hook's stand-in RET. */
  #inStandIn = false;
  #bits = new Uint8Array(0x10000);
  /** @type {Map<number, Map<number, CallerEdge>>} target → (from * 8 + kind index) → edge */
  #callers = new Map();
  /** @type {string | null} The current instruction's `instructionInfo` kind (null unless coverage looked it up). */
  #kind = null;
  /** @type {number | null} The current instruction's static target. */
  #target = null;

  /** @type {Hit[]} The hit log, a ring once full: `#ringHead` is the oldest entry. */
  #ring = [];
  #ringHead = 0;

  /** @param {any} machine */
  constructor(machine) {
    this.#machine = machine;
    const cpu = machine.system.cpu;
    this.#cpu = cpu;
    this.#plain = { readMemory: cpu.readMemory, writeMemory: cpu.writeMemory, readPort: cpu.readPort, writePort: cpu.writePort };
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
        dbg.#bits.fill(0);
        dbg.#callers.clear();
      },
      get enabled() {
        return dbg.#covOn;
      },
      get bits() {
        return dbg.#bits;
      },
    };
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
    if (!this.#readsOn) {
      this.#len = 0;
      return;
    }
    // The look-ahead assumes reads have no side effects: true on the Model III; the Model I's $37E0
    // interrupt latch (phase 6) clears on read and will need a side-effect-free peek.
    const info = instructionInfo(this.#plain.readMemory, pc);
    const len = info.len;
    this.#len = len;
    if (this.#covOn) {
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
    if (this.#inInstr && this.#covOn && this.#kind !== null) this.#transfer();
    this.#inInstr = false;
    const id = this.#stopHit;
    this.#stopHit = null;
    return id;
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

  /** The instrumented `readMemory`: fetches pass straight through. */
  #read = (/** @type {number} */ addr) => {
    const value = this.#plain.readMemory(addr);
    if (this.#inInstr) {
      const k = this.#reads++;
      if (k < this.#len && addr === ((this.#pc + k) & 0xffff)) return value;
    }
    addr &= 0xffff;
    if (this.#marking) this.#bits[addr] |= READ;
    if (this.#watchMask[addr] & 1) this.#hit('read', addr, value, value);
    if (this.#onMemRead !== null) this.#onMemRead(addr, value);
    return value;
  };

  /** The instrumented `writeMemory`. */
  #write = (/** @type {number} */ addr, /** @type {number} */ value) => {
    addr &= 0xffff;
    value &= 0xff;
    const watched = (this.#watchMask[addr] & 2) !== 0;
    const prev = watched || this.#onMemWrite !== null ? this.#plain.readMemory(addr) : 0;
    this.#plain.writeMemory(addr, value);
    if (this.#marking) this.#bits[addr] |= WRITE;
    if (watched) this.#hit('write', addr, value, prev);
    if (this.#onMemWrite !== null) this.#onMemWrite(addr, value, prev);
  };

  /** The instrumented `readPort`. */
  #readPort = (/** @type {number} */ port) => {
    const value = this.#plain.readPort(port);
    if (this.#onPort !== null) this.#onPort(port, value & 0xff, 'in');
    return value;
  };

  /** The instrumented `writePort`. */
  #writePort = (/** @type {number} */ port, /** @type {number} */ value) => {
    this.#plain.writePort(port, value);
    if (this.#onPort !== null) this.#onPort(port, value & 0xff, 'out');
  };

  /**
   * Log an access every matching watch sees, in id order.
   * @param {'read' | 'write'} kind
   * @param {number} addr
   * @param {number} value
   * @param {number} prev
   */
  #hit(kind, addr, value, prev) {
    const cpu = this.#cpu;
    const pc = this.#inInstr ? this.#pc : cpu.registers.PC;
    const cycle = cpu.cycles;
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
      if (w.stop && (this.#stopHit === null || w.id < this.#stopHit)) this.#stopHit = w.id;
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
    if (!this.tracksAccess) this.#inInstr = false;
  }

  #refresh() {
    this.#instrument();
    this.active = this.#covOn || this.#breaks.size > 0 || this.#watches.size > 0 || this.#onMemRead !== null || this.#onMemWrite !== null || this.#onPort !== null;
  }
}

/**
 * @param {Map<number, CallerEdge>} edges
 * @returns {CallerEdge[]} copies sorted by `from`, then `kind`
 */
function sortEdges(edges) {
  return [...edges.values()]
    .map((e) => ({ from: e.from, kind: e.kind, count: e.count }))
    .sort((a, b) => a.from - b.from || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
}
