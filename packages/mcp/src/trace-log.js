/**
 * The session's instruction trace (the rule is in docs/fugloy-mcp-spec.md §5, `trace`). Tracing
 * costs about four times the emulation, so the emulator's ring is on only during a `run` with
 * `trace: true` or a `step` (Ruling 3). Each of those enables a fresh ring and, when it ends,
 * hands what it recorded here; this log keeps the newest `depth` instructions across all of
 * them, so a step never erases what an earlier traced run recorded. Only `load` and `reset`
 * empty it. Each stretch keeps the cycle counts it began and ended at, so `trace` can say where
 * untraced execution came between two stretches.
 */

/**
 * @typedef {{ pc: number, bytes: number[], cycles: number, regs?: any }} TraceEntry
 * @typedef {{ from: number, to: number, entries: TraceEntry[] }} Stretch
 */

export class TraceLog {
  /** @type {Stretch[]} oldest first */
  stretches = [];
  /** @type {TraceEntry[]} what the latest `add` recorded (a step shows these) */
  latest = [];

  /** @param {number} depth the most instructions kept */
  constructor(depth) {
    this.depth = depth;
  }

  /** Instructions kept. */
  get size() {
    return this.stretches.reduce((n, s) => n + s.entries.length, 0);
  }

  /**
   * Keep a stretch that ran from cycle `from` to `to`, dropping the oldest instructions past `depth`.
   * @param {number} from
   * @param {number} to
   * @param {TraceEntry[]} entries oldest first
   */
  add(from, to, entries) {
    this.latest = entries;
    if (entries.length > 0) this.stretches.push({ from, to, entries: entries.slice(-this.depth) });
    let extra = this.size - this.depth;
    while (extra > 0) {
      const first = /** @type {Stretch} */ (this.stretches[0]);
      if (first.entries.length <= extra) {
        extra -= first.entries.length;
        this.stretches.shift();
      } else {
        first.entries = first.entries.slice(extra);
        extra = 0;
      }
    }
  }

  clear() {
    this.stretches = [];
    this.latest = [];
  }

  /**
   * The newest `n` instructions, oldest first, split where untraced execution came between them.
   * @param {number} n
   * @returns {{ entries: TraceEntry[], untraced: number }[]} `untraced` is the T-states that ran unrecorded before this group (0 for the first)
   */
  last(n) {
    /** @type {{ entries: TraceEntry[], untraced: number }[]} */
    const out = [];
    let left = n;
    for (let k = this.stretches.length - 1; k >= 0 && left > 0; k--) {
      const s = /** @type {Stretch} */ (this.stretches[k]);
      const entries = s.entries.slice(-left);
      left -= entries.length;
      const before = this.stretches[k - 1];
      // A gap is shown only between two groups both shown, and stretches with none read as one.
      const untraced = before !== undefined && left > 0 ? Math.max(0, s.from - before.to) : 0;
      const next = out[0];
      if (next !== undefined && next.untraced === 0) next.entries = [...entries, ...next.entries];
      else out.unshift({ entries, untraced: 0 });
      /** @type {{ entries: TraceEntry[], untraced: number }} */ (out[0]).untraced = untraced;
    }
    return out;
  }
}
