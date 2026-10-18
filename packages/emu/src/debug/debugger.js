/**
 * The spec §7 debugger, over a Machine. Task by task it grows breakpoints, watchpoints, coverage,
 * and a trace; the Machine consults it at each instruction boundary only while `active` is true,
 * so a machine with nothing set pays one boolean check per instruction.
 */

/**
 * @typedef {{ id: number, addr: number, once: boolean, hits: number, when?: (m: any) => boolean }} BreakEntry
 */

export class Debugger {
  /** @type {boolean} True while anything needs per-instruction work. */
  active = false;
  /** @type {number | null} The id of the breakpoint that made the last `beforeInstruction` stop. */
  stopId = null;

  #machine;
  /** @type {Map<number, BreakEntry[]>} */
  #breaks = new Map();
  #nextId = 1;

  /** @param {any} machine */
  constructor(machine) {
    this.#machine = machine;
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
   * Internal: called after each executed instruction while `active`. Later tasks (watchpoints,
   * coverage, trace) fill it in.
   * @returns {number | null} the id of a watchpoint to stop on, or null
   */
  afterInstruction() {
    return null;
  }

  #refresh() {
    this.active = this.#breaks.size > 0;
  }
}
