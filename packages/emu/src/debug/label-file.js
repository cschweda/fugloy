/**
 * The label and coverage file (spec §8), the JSON contract shared by @fugloy/emu, @fugloy/mcp, and
 * @fugloy/disasm: writing it from a debugger session, reading (validating) it, and merging two.
 *
 * Coverage fields are `rle-hex` (phase 3 Ruling 7): comma-separated run lengths in uppercase hex,
 * alternating zero-runs and one-runs and starting with a zero-run (which may be `0`), summing to
 * 65,536. A field with no bit set is `"10000"`. Nothing here reads a clock: a session's `started`
 * is whatever the caller passes.
 */
/** The format version this code writes and reads. */
export const LABEL_FILE_VERSION = 1;

/**
 * The six coverage fields, in file order, with their bit in the debugger's `COVERAGE` (written as
 * numbers because debugger.js imports this module; a test checks they agree).
 */
export const COVERAGE_FIELDS = /** @type {const} */ ([
  ['exec', 1], // EXEC
  ['operand', 2], // OPERAND
  ['read', 4], // READ
  ['write', 8], // WRITE
  ['jump', 16], // JUMP_TARGET
  ['call', 32], // CALL_TARGET
]);

const TOP_KEYS = ['fugloy', 'program', 'load', 'entry', 'labels', 'coverage', 'callers', 'sessions'];
const SOURCES = ['loader', 'observed', 'user', 'disasm'];
/** Label precedence: a higher rank wins at one address. */
const RANK = { loader: 0, disasm: 1, observed: 2, user: 3 };
const KINDS = ['call', 'jp', 'jr', 'rst', 'ret-to'];
const SPACE = 0x10000;
/** C0 controls and DEL: a CR or LF in a name, evidence, or note would start a new line in a listing or zmac source. */
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * @typedef {{ addr: number, name: string, kind: 'code' | 'data', size?: number, source: 'loader' | 'observed' | 'user' | 'disasm', evidence?: string, note?: string, map?: number, page?: number }} Label
 * @typedef {{ from: number, kind: 'call' | 'jp' | 'jr' | 'rst' | 'ret-to', count: number }} CallerEdge
 * @typedef {{ encoding: 'rle-hex', exec: string, operand: string, read: string, write: string, jump: string, call: string }} CoverageObject
 * @typedef {{ cycles: number, started?: string, input?: string }} Session
 * @typedef {{ fugloy: 1, program: { name: string, sha256?: string, model: 1 | 3 | 4 },
 *   load: { addr: number, len: number, source: string, map?: number, page?: number }[], entry: number | null,
 *   labels: Label[], coverage: Record<string, CoverageObject>, callers: Record<string, CallerEdge[]>,
 *   sessions: Session[], [key: string]: unknown }} LabelFile
 */

/**
 * Encode one coverage field: the addresses whose byte has any bit of `mask` set.
 * @param {Uint8Array} bits 65,536 coverage bytes
 * @param {number} mask
 * @returns {string} rle-hex
 */
export function encodeRle(bits, mask) {
  if (bits.length !== SPACE) throw new Error(`encodeRle: bits must hold 65536 bytes, not ${bits.length}`);
  const runs = [];
  let state = 0;
  let run = 0;
  for (let a = 0; a < SPACE; a++) {
    const v = (bits[a] & mask) !== 0 ? 1 : 0;
    if (v === state) run++;
    else {
      runs.push(run);
      state = v;
      run = 1;
    }
  }
  runs.push(run);
  return runs.map((n) => n.toString(16).toUpperCase()).join(',');
}

/**
 * Decode one rle-hex coverage field.
 * @param {string} text
 * @returns {Uint8Array} 65,536 bytes, each 0 or 1
 */
export function decodeRle(text) {
  if (typeof text !== 'string') throw new Error('rle-hex: a coverage field must be a string');
  const parts = text.split(',');
  const runs = [];
  let sum = 0;
  for (let i = 0; i < parts.length; i++) {
    if (!/^[0-9A-Fa-f]{1,5}$/.test(parts[i])) throw new Error(`rle-hex: run ${i} ("${parts[i]}") is not hex`);
    const n = parseInt(parts[i], 16);
    runs.push(n);
    sum += n;
  }
  if (sum !== SPACE) throw new Error(`rle-hex: the runs sum to ${sum}, not 65536`);
  const out = new Uint8Array(SPACE);
  let at = 0;
  for (let i = 0; i < runs.length; i++) {
    if (i % 2 === 1) out.fill(1, at, at + runs[i]);
    at += runs[i];
  }
  return out;
}

/**
 * Write the §8 object from a debugger session.
 * @param {{ name?: string, started?: string, input?: string,
 *   loaded: { manifest: any, sha256: string } | null, userLabels: Label[], bits: Uint8Array,
 *   callerMap: Map<number, CallerEdge[]>, cycles: number, model?: 1 | 3 }} session
 *   `model` is the machine's (default 3, the Model III), recorded as `program.model`
 * @returns {LabelFile}
 */
export function writeLabelFile({ name, started, input, loaded, userLabels, bits, callerMap, cycles, model = 3 }) {
  if (name !== undefined && (typeof name !== 'string' || name === '')) throw new Error(`labelFile: name must be a non-empty string, not ${String(name)}`);
  if (started !== undefined && typeof started !== 'string') throw new Error(`labelFile: started must be a string (the core reads no clock; pass the time yourself), not ${String(started)}`);
  if (input !== undefined && typeof input !== 'string') throw new Error(`labelFile: input must be a string, not ${String(input)}`);
  const manifest = loaded?.manifest;
  const programName = name ?? manifest?.name;
  if (programName === undefined || programName === '') {
    throw new Error(loaded === null ? 'labelFile needs a name: nothing was loaded through m.load' : `labelFile needs a name: the loaded ${manifest.format} manifest carries none`);
  }

  /** @type {LabelFile['program']} */
  const program = loaded === null ? { name: programName, model } : { name: programName, sha256: loaded.sha256, model };
  /** @type {LabelFile['load']} */
  const load = [];
  if (manifest !== undefined) {
    manifest.blocks.forEach((/** @type {any} */ b, /** @type {number} */ i) => {
      if (!b.predicted) load.push({ addr: b.addr, len: b.len, source: `${manifest.format}-block-${i}` });
    });
  }
  const entry = manifest?.entry ?? null;

  /** @type {Map<number, Label>} */
  const labels = new Map();
  if (entry !== null) labels.set(entry, { addr: entry, name: 'ENTRY', kind: 'code', source: 'loader' });
  // Observed labels (Ruling 9): call and RST targets inside the loaded blocks.
  const inLoad = (/** @type {number} */ a) => load.some((b) => ((a - b.addr) & 0xffff) < b.len);
  for (const [target, edges] of [...callerMap].sort((x, y) => x[0] - y[0])) {
    let count = 0;
    const sites = new Set();
    for (const e of edges) {
      if (e.kind !== 'call' && e.kind !== 'rst') continue;
      count += e.count;
      sites.add(e.from);
    }
    if (count === 0 || !inLoad(target)) continue;
    const hex = target.toString(16).toUpperCase().padStart(4, '0');
    labels.set(target, { addr: target, name: `SUB_${hex}`, kind: 'code', source: 'observed', evidence: `called ${count}× from ${sites.size} site${sites.size === 1 ? '' : 's'}` });
  }
  for (const l of userLabels) labels.set(l.addr, { ...l });

  /** @type {CoverageObject} */
  const cov = /** @type {any} */ ({ encoding: 'rle-hex' });
  for (const [field, mask] of COVERAGE_FIELDS) /** @type {any} */ (cov)[field] = encodeRle(bits, mask);

  /** @type {Record<string, CallerEdge[]>} */
  const callers = {};
  for (const [target, edges] of [...callerMap].sort((x, y) => x[0] - y[0])) callers[String(target)] = edges.map((e) => ({ from: e.from, kind: e.kind, count: e.count }));

  /** @type {Session} */
  const session = { cycles };
  if (started !== undefined) session.started = started;
  if (input !== undefined) session.input = input;

  return {
    fugloy: LABEL_FILE_VERSION,
    program,
    load,
    entry,
    labels: [...labels.values()].sort((a, b) => a.addr - b.addr),
    coverage: { '0:0': cov },
    callers,
    sessions: [session],
  };
}

const isObject = (/** @type {unknown} */ v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isAddr = (/** @type {unknown} */ v) => Number.isInteger(v) && /** @type {number} */ (v) >= 0 && /** @type {number} */ (v) <= 0xffff;
const isNat = (/** @type {unknown} */ v) => Number.isSafeInteger(v) && /** @type {number} */ (v) >= 0;
const hex4 = (/** @type {number} */ a) => `$${a.toString(16).toUpperCase().padStart(4, '0')}`;

/**
 * Validate a label file against every rule of §8.
 * @param {unknown} value the parsed JSON, or its text
 * @returns {{ file: LabelFile | null, errors: string[] }} `file` is the value itself (unknown top-level keys kept) when there are no errors, else null
 */
export function parseLabelFile(value) {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch (e) {
      return { file: null, errors: [`the label file is not JSON: ${/** @type {Error} */ (e).message}`] };
    }
  }
  if (!isObject(value)) return { file: null, errors: ['the label file must be a JSON object'] };
  const f = /** @type {any} */ (value);
  /** @type {string[]} */
  const errors = [];
  const err = (/** @type {string} */ s) => errors.push(s);

  if (f.fugloy === undefined) return { file: null, errors: ['fugloy: missing'] };
  if (f.fugloy !== LABEL_FILE_VERSION) return { file: null, errors: [`fugloy: version ${JSON.stringify(f.fugloy)} is not supported (this reader knows ${LABEL_FILE_VERSION})`] };
  for (const k of TOP_KEYS) if (f[k] === undefined) err(`${k}: missing`);

  /** Optional map and page, on load entries and labels. */
  const mapPage = (/** @type {any} */ o, /** @type {string} */ at) => {
    for (const k of ['map', 'page']) if (o[k] !== undefined && !isNat(o[k])) err(`${at}.${k}: must be a non-negative integer`);
  };

  const p = f.program;
  if (p !== undefined) {
    if (!isObject(p)) err('program: must be an object');
    else {
      if (typeof p.name !== 'string' || p.name === '') err('program.name: must be a non-empty string');
      if (p.sha256 !== undefined && (typeof p.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(p.sha256))) err('program.sha256: must be 64 lowercase hex digits');
      if (![1, 3, 4].includes(p.model)) err('program.model: must be 1, 3, or 4');
    }
  }

  if (f.load !== undefined) {
    if (!Array.isArray(f.load)) err('load: must be an array');
    else
      f.load.forEach((/** @type {any} */ b, /** @type {number} */ i) => {
        const at = `load[${i}]`;
        if (!isObject(b)) return err(`${at}: must be an object`);
        if (!isAddr(b.addr)) err(`${at}.addr: must be an address 0..65535`);
        if (!Number.isInteger(b.len) || b.len < 1 || b.len > SPACE) err(`${at}.len: must be an integer 1..65536`);
        if (typeof b.source !== 'string') err(`${at}.source: must be a string`);
        mapPage(b, at);
      });
  }

  if (f.entry !== undefined && f.entry !== null && !isAddr(f.entry)) err('entry: must be an address 0..65535 or null');

  if (f.labels !== undefined) {
    if (!Array.isArray(f.labels)) err('labels: must be an array');
    else {
      const seen = new Set();
      f.labels.forEach((/** @type {any} */ l, /** @type {number} */ i) => {
        const at = `labels[${i}]`;
        if (!isObject(l)) return err(`${at}: must be an object`);
        if (!isAddr(l.addr)) err(`${at}.addr: must be an address 0..65535`);
        if (typeof l.name !== 'string' || l.name === '') err(`${at}.name: must be a non-empty string`);
        else if (CONTROL.test(l.name)) err(`${at}.name: must not contain a control character`);
        if (l.kind !== 'code' && l.kind !== 'data') err(`${at}.kind: must be code or data`);
        if (!SOURCES.includes(l.source)) err(`${at}.source: must be loader, observed, user, or disasm`);
        if (l.size !== undefined && (!Number.isInteger(l.size) || l.size < 1 || l.size > SPACE)) err(`${at}.size: must be an integer 1..65536`);
        if (l.evidence !== undefined && typeof l.evidence !== 'string') err(`${at}.evidence: must be a string`);
        else if (l.evidence !== undefined && CONTROL.test(l.evidence)) err(`${at}.evidence: must not contain a control character`);
        else if (l.source === 'observed' && (l.evidence === undefined || l.evidence === '')) err(`${at}.evidence: an observed label must carry its evidence`);
        if (l.note !== undefined && typeof l.note !== 'string') err(`${at}.note: must be a string`);
        else if (l.note !== undefined && CONTROL.test(l.note)) err(`${at}.note: must not contain a control character`);
        mapPage(l, at);
        if (isAddr(l.addr)) {
          const key = labelKey(l);
          if (seen.has(key)) err(`${at}: a second label at ${hex4(l.addr)}${l.map || l.page ? ` (map ${l.map ?? 0}, page ${l.page ?? 0})` : ''}`);
          seen.add(key);
        }
      });
    }
  }

  if (f.coverage !== undefined) {
    if (!isObject(f.coverage)) err('coverage: must be an object');
    else
      for (const [key, c] of Object.entries(f.coverage)) {
        const at = `coverage[${JSON.stringify(key)}]`;
        if (!/^\d+:\d+$/.test(key)) {
          err(`${at}: the key must be "<map>:<page>", as "0:0"`);
          continue;
        }
        if (!isObject(c)) {
          err(`${at}: must be an object`);
          continue;
        }
        if (c.encoding !== 'rle-hex') err(`${at}.encoding: must be "rle-hex"`);
        for (const [field] of COVERAGE_FIELDS) {
          if (c[field] === undefined) err(`${at}.${field}: missing`);
          else {
            try {
              decodeRle(c[field]);
            } catch (e) {
              err(`${at}.${field}: ${/** @type {Error} */ (e).message.replace(/^rle-hex: /, '')}`);
            }
          }
        }
      }
  }

  if (f.callers !== undefined) {
    if (!isObject(f.callers)) err('callers: must be an object');
    else
      for (const [key, edges] of Object.entries(f.callers)) {
        const at = `callers[${JSON.stringify(key)}]`;
        if (!/^(0|[1-9][0-9]{0,4})$/.test(key) || Number(key) > 0xffff) {
          err(`${at}: the key must be a decimal address 0..65535`);
          continue;
        }
        if (!Array.isArray(edges)) {
          err(`${at}: must be an array`);
          continue;
        }
        edges.forEach((/** @type {any} */ e, /** @type {number} */ i) => {
          const eat = `${at}[${i}]`;
          if (!isObject(e)) return err(`${eat}: must be an object`);
          if (!isAddr(e.from)) err(`${eat}.from: must be an address 0..65535`);
          if (!KINDS.includes(e.kind)) err(`${eat}.kind: must be call, jp, jr, rst, or ret-to`);
          if (!Number.isSafeInteger(e.count) || e.count < 1) err(`${eat}.count: must be a positive integer`);
        });
      }
  }

  if (f.sessions !== undefined) {
    if (!Array.isArray(f.sessions)) err('sessions: must be an array');
    else
      f.sessions.forEach((/** @type {any} */ s, /** @type {number} */ i) => {
        const at = `sessions[${i}]`;
        if (!isObject(s)) return err(`${at}: must be an object`);
        if (!isNat(s.cycles)) err(`${at}.cycles: must be a non-negative integer`);
        for (const k of ['started', 'input']) if (s[k] !== undefined && typeof s[k] !== 'string') err(`${at}.${k}: must be a string`);
      });
  }

  return errors.length === 0 ? { file: f, errors } : { file: null, errors };
}

/** @param {{ addr: number, map?: number, page?: number }} l */
function labelKey(l) {
  return `${l.map ?? 0}:${l.page ?? 0}:${l.addr}`;
}

/**
 * Merge two label files by the §8 rule: coverage unioned per key; labels by address with `user`
 * over `observed` over `disasm` over `loader` (`b` wins a tie); `load` unioned without duplicates;
 * `entry` is `a`'s unless null; callers unioned with counts summed per `(from, kind)`; sessions
 * appended, `a`'s first. Unknown top-level keys are kept, `a`'s winning.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {LabelFile}
 */
export function mergeLabelFiles(a, b) {
  const fa = checked(a, 'a');
  const fb = checked(b, 'b');
  const sa = fa.program.sha256;
  const sb = fb.program.sha256;
  if (sa !== undefined && sb !== undefined && sa !== sb) throw new Error(`mergeLabelFiles: the files are for different programs (sha256 ${sa} and ${sb})`);

  const { name, sha256: _s, model, ...programRest } = fa.program;
  const sha256 = sa ?? sb;
  const program = /** @type {LabelFile['program']} */ (sha256 === undefined ? { name, model, ...programRest } : { name, sha256, model, ...programRest });

  const load = [];
  const loadSeen = new Set();
  for (const l of [...fa.load, ...fb.load]) {
    const key = JSON.stringify([l.addr, l.len, l.source, l.map ?? 0, l.page ?? 0]);
    if (loadSeen.has(key)) continue;
    loadSeen.add(key);
    load.push({ ...l });
  }

  /** @type {Map<string, Label>} */
  const labels = new Map();
  for (const l of [...fa.labels, ...fb.labels]) {
    const key = labelKey(l);
    const old = labels.get(key);
    if (old === undefined || RANK[l.source] >= RANK[old.source]) labels.set(key, { ...l });
  }

  /** @type {Record<string, CoverageObject>} */
  const coverage = {};
  for (const [key, c] of [...Object.entries(fa.coverage), ...Object.entries(fb.coverage)]) {
    const old = coverage[key];
    if (old === undefined) {
      coverage[key] = /** @type {CoverageObject} */ (Object.fromEntries([['encoding', 'rle-hex'], ...COVERAGE_FIELDS.map(([field]) => [field, /** @type {any} */ (c)[field]])]));
      continue;
    }
    for (const [field] of COVERAGE_FIELDS) {
      const x = decodeRle(/** @type {any} */ (old)[field]);
      const y = decodeRle(/** @type {any} */ (c)[field]);
      for (let i = 0; i < SPACE; i++) x[i] |= y[i];
      /** @type {any} */ (old)[field] = encodeRle(x, 1);
    }
  }

  /** @type {Map<number, Map<string, CallerEdge>>} */
  const edges = new Map();
  for (const [key, list] of [...Object.entries(fa.callers), ...Object.entries(fb.callers)]) {
    const target = Number(key);
    let m = edges.get(target);
    if (m === undefined) edges.set(target, (m = new Map()));
    for (const e of list) {
      const k = `${e.from}:${e.kind}`;
      const old = m.get(k);
      if (old === undefined) m.set(k, { from: e.from, kind: e.kind, count: e.count });
      else old.count += e.count;
    }
  }
  /** @type {Record<string, CallerEdge[]>} */
  const callers = {};
  for (const target of [...edges.keys()].sort((x, y) => x - y)) {
    callers[String(target)] = [.../** @type {Map<string, CallerEdge>} */ (edges.get(target)).values()].sort((x, y) => x.from - y.from || (x.kind < y.kind ? -1 : x.kind > y.kind ? 1 : 0));
  }

  /** @type {LabelFile} */
  const out = {
    fugloy: LABEL_FILE_VERSION,
    program,
    load,
    entry: fa.entry ?? fb.entry,
    labels: [...labels.values()].sort((x, y) => x.addr - y.addr || (x.map ?? 0) - (y.map ?? 0) || (x.page ?? 0) - (y.page ?? 0)),
    coverage,
    callers,
    sessions: [...fa.sessions, ...fb.sessions].map((s) => ({ ...s })),
  };
  for (const f of [fb, fa]) for (const [k, v] of Object.entries(f)) if (!TOP_KEYS.includes(k)) out[k] = v;
  // Keep a's unknown keys ahead of b's in the output order.
  return reorder(out, fa, fb);
}

/** @param {unknown} v @param {string} which @returns {LabelFile} */
function checked(v, which) {
  const { file, errors } = parseLabelFile(v);
  if (file === null) throw new Error(`mergeLabelFiles: ${which} is not a valid label file: ${errors.join('; ')}`);
  return file;
}

/** @param {LabelFile} out @param {LabelFile} fa @param {LabelFile} fb @returns {LabelFile} */
function reorder(out, fa, fb) {
  const keys = [...TOP_KEYS];
  for (const f of [fa, fb]) for (const k of Object.keys(f)) if (!keys.includes(k)) keys.push(k);
  return /** @type {LabelFile} */ (Object.fromEntries(keys.map((k) => [k, out[k]])));
}
