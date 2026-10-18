/**
 * The label and coverage file (docs/label-format.md, §8 of the emulator spec):
 * the JSON the emulator writes about a program it ran. Read here from the
 * format document alone, never from the emulator's code. `parseLabelFile`
 * checks the whole file and returns it typed, or every problem it found.
 */
import { hex4 } from '@fugloy/z80';

export type LabelSource = 'loader' | 'observed' | 'user' | 'disasm';

export interface Label {
  addr: number;
  name: string;
  kind: 'code' | 'data';
  size?: number;
  source: LabelSource;
  evidence?: string;
}

/** One coverage object: each bit field rle-hex encoded over the 64K address space. */
export interface Coverage {
  encoding: 'rle-hex';
  exec: string;
  operand: string;
  read: string;
  write: string;
  jump: string;
  call: string;
}

export interface CallerEdge {
  from: number;
  kind: 'call' | 'jp' | 'jr' | 'rst' | 'ret-to';
  count: number;
}

export interface LabelFile {
  fugloy: 1;
  program: { name: string; sha256?: string; model: 1 | 3 | 4 };
  load: { addr: number; len: number; source: string }[];
  entry: number | null;
  labels: Label[];
  /** Keyed `"<map>:<page>"`; Model I and III use `"0:0"` only. */
  coverage: Record<string, Coverage>;
  /** Keyed by the target address in decimal. */
  callers: Record<string, CallerEdge[]>;
  sessions: { cycles: number; started?: string; input?: string }[];
  /** Keys this reader does not know are kept. */
  [key: string]: unknown;
}

const KEYS = ['fugloy', 'program', 'load', 'entry', 'labels', 'coverage', 'callers', 'sessions'] as const;
export const COVERAGE_FIELDS = ['exec', 'operand', 'read', 'write', 'jump', 'call'] as const;
const SOURCES: readonly string[] = ['loader', 'observed', 'user', 'disasm'];
const EDGE_KINDS: readonly string[] = ['call', 'jp', 'jr', 'rst', 'ret-to'];
const RUN = /^[0-9A-Fa-f]{1,5}$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isAddr = (v: unknown): v is number => isInt(v, 0, 0xffff);

/** Why an rle-hex field is malformed, or null when it is well formed. */
function rleProblem(text: unknown): string | null {
  if (typeof text !== 'string') return 'is not a string';
  let sum = 0;
  const runs = text.split(',');
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!;
    if (run === '') return `run ${i + 1} is empty`;
    if (!RUN.test(run)) return `run ${i + 1} "${run}" is not one to five hex digits`;
    sum += parseInt(run, 16);
  }
  if (sum !== 0x10000) return `the runs sum to $${sum.toString(16).toUpperCase().padStart(4, '0')}, not $10000`;
  return null;
}

/** One byte per address, 1 where the bit is set; null when the field is malformed. */
export function decodeRle(text: string): Uint8Array | null {
  if (rleProblem(text) !== null) return null;
  const bits = new Uint8Array(0x10000);
  let at = 0;
  text.split(',').forEach((run, i) => {
    const n = parseInt(run, 16);
    if (i % 2 === 1) bits.fill(1, at, at + n);
    at += n;
  });
  return bits;
}

export function parseLabelFile(text: string): { file: LabelFile | null; errors: string[] } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { file: null, errors: [`not JSON: ${(e as Error).message}`] };
  }
  if (!isObject(json)) return { file: null, errors: ['the label file is not a JSON object'] };
  // Another version may mean anything by its other keys, so nothing else is checked.
  if (json['fugloy'] !== 1) return { file: null, errors: [`fugloy is format version ${JSON.stringify(json['fugloy'] ?? null)}; this reader knows version 1`] };
  const errors: string[] = [];
  for (const key of KEYS) if (!(key in json)) errors.push(`the key "${key}" is missing`);

  const program = json['program'];
  if ('program' in json) {
    if (!isObject(program)) errors.push('program must be an object');
    else {
      if (typeof program['name'] !== 'string' || program['name'] === '') errors.push('program.name must be a non-empty string');
      if (program['sha256'] !== undefined && (typeof program['sha256'] !== 'string' || !/^[0-9a-f]{64}$/.test(program['sha256']))) {
        errors.push('program.sha256 must be 64 lowercase hex digits');
      }
      if (program['model'] !== 1 && program['model'] !== 3 && program['model'] !== 4) errors.push('program.model must be 1, 3, or 4');
    }
  }

  const load = json['load'];
  if ('load' in json) {
    if (!Array.isArray(load)) errors.push('load must be a list');
    else {
      load.forEach((b: unknown, i) => {
        if (!isObject(b) || !isAddr(b['addr']) || !isInt(b['len'], 1, 0x10000) || typeof b['source'] !== 'string') {
          errors.push(`load[${i}] must be { addr, len, source } with addr 0 to 65535 and len 1 to 65536`);
        }
      });
    }
  }

  if ('entry' in json && json['entry'] !== null && !isAddr(json['entry'])) errors.push('entry must be an address 0 to 65535, or null');

  const labels = json['labels'];
  if ('labels' in json) {
    if (!Array.isArray(labels)) errors.push('labels must be a list');
    else {
      const seen = new Set<number>();
      labels.forEach((l: unknown, i) => {
        const at = `labels[${i}]`;
        if (!isObject(l)) { errors.push(`${at} must be an object`); return; }
        if (!isAddr(l['addr'])) errors.push(`${at}.addr must be an address 0 to 65535`);
        else if (seen.has(l['addr'])) errors.push(`${at}: $${hex4(l['addr'])} already has a label`);
        else seen.add(l['addr']);
        if (typeof l['name'] !== 'string' || l['name'] === '') errors.push(`${at}.name must be a non-empty string`);
        if (l['kind'] !== 'code' && l['kind'] !== 'data') errors.push(`${at}.kind must be "code" or "data"`);
        if (l['size'] !== undefined && !isInt(l['size'], 1, 0x10000)) errors.push(`${at}.size must be 1 to 65536`);
        if (typeof l['source'] !== 'string' || !SOURCES.includes(l['source'])) errors.push(`${at}.source must be one of ${SOURCES.join(', ')}`);
        if (l['evidence'] !== undefined && typeof l['evidence'] !== 'string') errors.push(`${at}.evidence must be a string`);
        if (l['source'] === 'observed' && typeof l['evidence'] !== 'string') errors.push(`${at} is observed and has no evidence`);
      });
    }
  }

  const coverage = json['coverage'];
  if ('coverage' in json) {
    if (!isObject(coverage)) errors.push('coverage must be an object');
    else {
      for (const [key, c] of Object.entries(coverage)) {
        const at = `coverage[${JSON.stringify(key)}]`;
        if (!/^\d+:\d+$/.test(key)) errors.push(`${at}: the key must be "<map>:<page>"`);
        if (!isObject(c)) { errors.push(`${at} must be an object`); continue; }
        if (c['encoding'] !== 'rle-hex') errors.push(`${at}.encoding must be "rle-hex"`);
        for (const field of COVERAGE_FIELDS) {
          const problem = rleProblem(c[field]);
          if (problem !== null) errors.push(`${at}.${field}: ${c[field] === undefined ? 'is missing' : problem}`);
        }
      }
    }
  }

  const callers = json['callers'];
  if ('callers' in json) {
    if (!isObject(callers)) errors.push('callers must be an object');
    else {
      for (const [key, edges] of Object.entries(callers)) {
        const at = `callers[${JSON.stringify(key)}]`;
        if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) > 0xffff) errors.push(`${at}: the key must be a decimal address 0 to 65535`);
        if (!Array.isArray(edges)) { errors.push(`${at} must be a list`); continue; }
        edges.forEach((e: unknown, i) => {
          if (!isObject(e) || !isAddr(e['from']) || typeof e['kind'] !== 'string' || !EDGE_KINDS.includes(e['kind']) || !isInt(e['count'], 1, Number.MAX_SAFE_INTEGER)) {
            errors.push(`${at}[${i}] must be { from, kind, count } with kind one of ${EDGE_KINDS.join(', ')} and count at least 1`);
          }
        });
      }
    }
  }

  const sessions = json['sessions'];
  if ('sessions' in json) {
    if (!Array.isArray(sessions)) errors.push('sessions must be a list');
    else {
      sessions.forEach((s: unknown, i) => {
        if (!isObject(s) || !isInt(s['cycles'], 0, Number.MAX_SAFE_INTEGER)) errors.push(`sessions[${i}] must be an object with a cycle count`);
        else if ((s['started'] !== undefined && typeof s['started'] !== 'string') || (s['input'] !== undefined && typeof s['input'] !== 'string')) {
          errors.push(`sessions[${i}]: started and input must be strings`);
        }
      });
    }
  }

  return errors.length > 0 ? { file: null, errors } : { file: json as LabelFile, errors: [] };
}
