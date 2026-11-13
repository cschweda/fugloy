/**
 * A port trace (M2): what an emulator session saw a program do that the recompiler cannot work out from
 * its bytes: the code bytes it rewrites, code it runs that the disassembly did not find, the return
 * addresses it drops, and the ROM bytes it reads as data. The census (tools/census.ts, which needs
 * @fugloy/emu) writes one; port() reads it. The format: docs/port-trace-format.md. Pure: no DOM, no Node.
 */

/** The trace format's version: a reader refuses any other. */
export const TRACE_VERSION = 1;

/** A code byte the program wrote after its entry: the instructions that wrote it and every value they wrote, each sorted. */
export interface TracePatch {
  addr: number;
  writers: number[];
  values: number[];
}

export interface PortTrace {
  'fugloy-trace': 1;
  /** The program the sessions ran: its file name and the SHA-256 of its bytes (64 lowercase hex digits). */
  program: { name: string; sha256: string };
  model: 1 | 3;
  /** The ROM the sessions ran on: `stub`, Fugløy's game stub ROM; `user`, the user's ROM. */
  rom: 'stub' | 'user';
  /** Each session by name, with its length in T-states from the program's entry, in the order they ran. */
  sessions: { name: string; cycles: number }[];
  /** By address. */
  patches: TracePatch[];
  /** Ranges (first and last address, inclusive) that executed but are not code in the hinted IR, by address. */
  entered: [number, number][];
  /** Each `POP` that took a CALL's return address off the stack, with how many times it did, by address. */
  drops: { at: number; count: number }[];
  /** Each ROM address the program's own instructions read as data, with the byte read, by address. */
  romReads: { addr: number; value: number }[];
}

const hex4 = (n: number): string => `$${n.toString(16).toUpperCase().padStart(4, '0')}`;

/** The trace's text, as the census writes it: the keys in the format's order, one array element a line. */
export function formatTrace(t: PortTrace): string {
  const list = (items: readonly unknown[]): string =>
    items.length === 0 ? '[]' : `[\n${items.map((i) => `    ${JSON.stringify(i)}`).join(',\n')}\n  ]`;
  return [
    '{',
    `  "fugloy-trace": ${t['fugloy-trace']},`,
    `  "program": ${JSON.stringify({ name: t.program.name, sha256: t.program.sha256 })},`,
    `  "model": ${t.model},`,
    `  "rom": ${JSON.stringify(t.rom)},`,
    `  "sessions": ${list(t.sessions.map((s) => ({ name: s.name, cycles: s.cycles })))},`,
    `  "patches": ${list(t.patches.map((p) => ({ addr: p.addr, writers: p.writers, values: p.values })))},`,
    `  "entered": ${list(t.entered)},`,
    `  "drops": ${list(t.drops.map((d) => ({ at: d.at, count: d.count })))},`,
    `  "romReads": ${list(t.romReads.map((r) => ({ addr: r.addr, value: r.value })))}`,
    '}',
    '',
  ].join('\n');
}

// ---- reading one

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const isAddr = (v: unknown): v is number => isInt(v, 0, 0xffff);
const isByte = (v: unknown): v is number => isInt(v, 0, 0xff);

/** A sentence for a malformed trace. */
const bad = (what: string): Error => new Error(`the trace is not a port trace: ${what}`);

/** The list at `key`, each element checked by `ok`, strictly ascending by `key` of each (no duplicates). */
function sortedList<T>(o: Record<string, unknown>, key: string, ok: (v: unknown) => v is T, by: (v: T) => number, shape: string): T[] {
  const v = o[key];
  if (!Array.isArray(v)) throw bad(`"${key}" is not a list`);
  v.forEach((e, k) => {
    if (!ok(e)) throw bad(`"${key}" item ${k + 1} is not ${shape}`);
    if (k > 0 && by(v[k - 1] as T) >= by(e)) throw bad(`"${key}" is not sorted by address with no address twice (item ${k + 1}, ${hex4(by(e))})`);
  });
  return v as T[];
}

/** A list of numbers each `ok`, non-empty and strictly ascending. */
const ascending = (v: unknown, ok: (x: unknown) => boolean): v is number[] =>
  Array.isArray(v) && v.length > 0 && v.every((x, k) => ok(x) && (k === 0 || (v[k - 1] as number) < (x as number)));

/**
 * The trace in `text`, for the program whose SHA-256 is `programSha256`; throws a sentence for text that
 * is not a trace, a trace of another format version, or one taken of another program.
 */
export function parseTrace(text: string, programSha256: string): PortTrace {
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch (e) {
    throw bad(`it is not JSON (${(e as Error).message})`);
  }
  if (!isObject(o)) throw bad('it is not a JSON object');
  const version = o['fugloy-trace'];
  if (version !== TRACE_VERSION) {
    throw new Error(version === undefined ? 'the trace is not a port trace: it has no "fugloy-trace" version' : `the trace is of format version ${JSON.stringify(version)}; this reader takes version ${TRACE_VERSION} only`);
  }
  const program = o.program;
  if (!isObject(program) || typeof program.name !== 'string' || program.name === '' || typeof program.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(program.sha256)) {
    throw bad('"program" is not a name and a SHA-256 of 64 lowercase hex digits');
  }
  if (program.sha256 !== programSha256) {
    throw new Error(`the trace was taken of another program (${program.name}, SHA-256 ${program.sha256}), not this one (SHA-256 ${programSha256}); take a census of this program`);
  }
  if (o.model !== 1 && o.model !== 3) throw bad('"model" is not 1 or 3');
  if (o.rom !== 'stub' && o.rom !== 'user') throw bad('"rom" is not "stub" or "user"');
  const sessions = o.sessions;
  if (!Array.isArray(sessions) || !sessions.every((s) => isObject(s) && typeof s.name === 'string' && s.name !== '' && isInt(s.cycles, 0, Number.MAX_SAFE_INTEGER))) {
    throw bad('"sessions" is not a list of names and T-state counts');
  }
  const patches = sortedList(o, 'patches', (p): p is TracePatch => isObject(p) && isAddr(p.addr) && ascending(p.writers, isAddr) && ascending(p.values, isByte), (p) => p.addr, 'an address with its writers and values, each a sorted list');
  const entered = sortedList(o, 'entered', (r): r is [number, number] => Array.isArray(r) && r.length === 2 && isAddr(r[0]) && isAddr(r[1]) && r[0] <= r[1], (r) => r[0], 'a first and last address');
  entered.forEach((r, k) => {
    if (k > 0 && entered[k - 1]![1] >= r[0]) throw bad(`"entered" ranges overlap at ${hex4(r[0])}`);
  });
  const drops = sortedList(o, 'drops', (d): d is { at: number; count: number } => isObject(d) && isAddr(d.at) && isInt(d.count, 1, Number.MAX_SAFE_INTEGER), (d) => d.at, 'an address and a count');
  const romReads = sortedList(o, 'romReads', (r): r is { addr: number; value: number } => isObject(r) && isAddr(r.addr) && isByte(r.value), (r) => r.addr, 'an address and a byte');
  return {
    'fugloy-trace': TRACE_VERSION,
    program: { name: program.name, sha256: program.sha256 },
    model: o.model,
    rom: o.rom,
    sessions: sessions.map((s: Record<string, unknown>) => ({ name: s.name as string, cycles: s.cycles as number })),
    patches: patches.map((p) => ({ addr: p.addr, writers: [...p.writers], values: [...p.values] })),
    entered: entered.map((r) => [r[0], r[1]]),
    drops: drops.map((d) => ({ at: d.at, count: d.count })),
    romReads: romReads.map((r) => ({ addr: r.addr, value: r.value })),
  };
}
