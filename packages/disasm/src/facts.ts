/**
 * What the Program tab's spec sheet says about an open program: which machine
 * it needs and the evidence, how it loads, the hardware, ROM and DOS it uses,
 * and how much of it is code. Computed here, not in the page, so the CLI could
 * print it and tests can pin it. Pure.
 */
import { hex4 } from '@fugloy/z80';
import type { Instruction } from '@fugloy/z80';
import { inTableOrder } from './analysis/externals.js';
import { Kind } from './analysis/map.js';
import { dataReference, operandUse, operandValue } from './analysis/symbols.js';
import { externalNotes, noteEntries } from './emit/operands.js';
import type { Analysis } from './pipeline.js';
import { selectSymbols } from './symbols/select.js';
import type { SymbolSet } from './symbols/select.js';
import { ROM_COMPARISON } from './symbols/tables.generated.js';
import type { TableEntry } from './symbols/types.js';

export type MachineFit = 'model1' | 'model3' | 'both' | 'unknown' | 'conflict';

export interface MachineEvidence {
  machine: 1 | 3 | 'both';
  /** The port number, ROM address, or the first address of the hardware entry. One piece of evidence per table entry. */
  key: number;
  kind: 'port' | 'rom' | 'memory';
  name: string;
  /** Both machines have it, but the code at it differs between the two ROMs. */
  differs?: true;
  /** A plain sentence, such as `Writes port $EC (MODEPORT), which only the Model III has.` */
  text: string;
}

export interface ProgramFacts {
  format: 'cmd' | 'bas' | 'raw';
  /** The .CMD `05` name. */
  name?: string;
  records?: number;
  /** The runs the file loads, as written. */
  loads: { start: number; end: number }[];
  size: number;
  entry: number | null;
  entryHow: 'transfer' | 'lowest' | 'base' | 'hint' | 'mined' | 'none';
  relocations: { file: number; run: number; length: number }[];
  memoryNeeded: 16 | 32 | 48;
  machine: { fit: MachineFit; evidence: MachineEvidence[] };
  hardware: TableEntry[];
  romCalls: TableEntry[];
  dosCalls: TableEntry[];
  code: { bytes: number; of: number; percent: number; routines: number };
}

const $ = (n: number): string => `$${hex4(n & 0xffff)}`;
const port$ = (n: number): string => `$${n.toString(16).toUpperCase().padStart(2, '0')}`;


const VERB_ORDER = ['Reads', 'Writes', 'Refers to', 'Calls', 'Jumps to'];
/** `Reads and writes`: the verbs seen, in a fixed order, the first capitalized. */
function joinVerbs(verbs: ReadonlySet<string>): string {
  const list = VERB_ORDER.filter((v) => verbs.has(v)).map((v, i) => (i === 0 ? v : v.toLowerCase()));
  return list.length < 3 ? list.join(' and ') : `${list.slice(0, -1).join(', ')}, and ${list.at(-1)}`;
}

/** Machine-specific evidence first, then what differs between the ROMs, then what is shared. */
const rank = (e: { machine: 1 | 3 | 'both'; differs?: true }): number => (e.machine !== 'both' ? 0 : e.differs === true ? 1 : 2);

/** Every reference to something outside the program, looked up in both machines' tables. */
function evidenceOf(a: Analysis): MachineEvidence[] {
  const m1: SymbolSet = selectSymbols({ machine: 1, dos: 'none' });
  const m3: SymbolSet = selectSymbols({ machine: 3, dos: 'none' });
  const loaded = (addr: number): boolean => a.space.image.isLoaded(addr);
  const found = new Map<string, Omit<MachineEvidence, 'text'> & { verbs: Set<string>; say: (v: string) => string }>();
  const note = (kind: MachineEvidence['kind'], machine: 1 | 3 | 'both', key: number, name: string, verb: string, text: (v: string) => string, differs = false): void => {
    const id = `${kind}:${key}`;
    const have = found.get(id);
    if (have !== undefined) {
      have.verbs.add(verb);
      return;
    }
    found.set(id, { machine, key, kind, name, ...(differs ? { differs: true as const } : {}), say: text, verbs: new Set([verb]) });
  };
  const rom = (addr: number, verb: string): void => {
    if (loaded(addr)) return;
    const cls = ROM_COMPARISON[hex4(addr)];
    if (cls === undefined) return;
    const name = (m3.code(addr) ?? m1.code(addr))?.name ?? '';
    const label = `${$(addr)}${name === '' ? '' : ` (${name})`}`;
    if (cls === 'model1-only') note('rom', 1, addr, name, verb, (v) => `${v} ${label}, which only the Model I ROM has.`);
    else if (cls === 'model3-only') note('rom', 3, addr, name, verb, (v) => `${v} ${label}, which only the Model III ROM has.`);
    else if (cls === 'shared') note('rom', 'both', addr, name, verb, (v) => `${v} ${label}, which is the same on both machines.`);
    else note('rom', 'both', addr, name, verb, (v) => `${v} ${label}, which exists on both machines but with different code.`, true);
  };
  const instructions: Iterable<Instruction> = a.pass1.instructions.values();
  for (const ins of instructions) {
    for (const [i, op] of ins.operands.entries()) {
      if (op.kind === 'rst') {
        rom(op.addr, 'Calls');
        continue;
      }
      const use = operandUse(ins, op);
      const value = operandValue(op);
      if (use === undefined || value === undefined) continue;
      if (use === 'port') {
        const p1 = m1.port(value);
        const p3 = m3.port(value);
        if (p1 === undefined && p3 === undefined) continue;
        const name = (p3 ?? p1)!.name;
        const verb = ins.mnemonic === 'OUT' ? 'Writes' : 'Reads';
        const machine = p1 !== undefined && p3 !== undefined ? 'both' : p1 !== undefined ? 1 : 3;
        note('port', machine, value, name, verb, (v) => `${v} port ${port$(value)} (${name}), which ${machine === 'both' ? 'both machines have' : `only the Model ${machine === 1 ? 'I' : 'III'} has`}.`);
      } else if (use === 'code') {
        rom(value, ins.flow.kind === 'call' ? 'Calls' : 'Jumps to');
      } else if (!loaded(value)) {
        const d1 = m1.data(value);
        const d3 = m3.data(value);
        const h1 = d1 !== undefined && d1.entry.table.startsWith('hardware');
        const h3 = d3 !== undefined && d3.entry.table.startsWith('hardware');
        if (!h1 && !h3) continue;
        const entry = (h3 ? d3! : d1!).entry;
        const name = entry.name;
        const span = entry.length > 1 ? `${$(entry.key)}–${$(entry.key + entry.length - 1)}` : $(entry.key);
        const machine = h1 && h3 ? 'both' : h1 ? 1 : 3;
        const verb = ins.mnemonic === 'LD' && i === 0 ? 'Writes' : dataReference(ins) === value && op.kind === 'imm16' ? 'Refers to' : 'Reads';
        note('memory', machine, entry.key, name, verb, (v) => `${v} ${name} (${span}), which ${machine === 'both' ? 'both machines have' : `only the Model ${machine === 1 ? 'I' : 'III'} has`}.`);
      }
    }
  }
  return [...found.values()]
    .sort((x, y) => rank(x) - rank(y) || x.kind.localeCompare(y.kind) || x.key - y.key)
    .map(({ verbs, say, ...e }) => ({ ...e, text: say(joinVerbs(verbs)) }));
}

function fitOf(evidence: readonly MachineEvidence[]): MachineFit {
  if (evidence.length === 0) return 'unknown';
  const one = evidence.some((e) => e.machine === 1);
  const three = evidence.some((e) => e.machine === 3);
  return one && three ? 'conflict' : one ? 'model1' : three ? 'model3' : 'both';
}

export function programFacts(a: Analysis): ProgramFacts {
  const mod = a.module;
  const runs = mod.image.runs();
  const size = runs.reduce((n, r) => n + r.length, 0);
  const spaceRuns = a.space.image.runs();
  const top = Math.max(runs.at(-1)?.end ?? 0, spaceRuns.at(-1)?.end ?? 0);

  let entry: number | null = a.entry;
  let entryHow: ProgramFacts['entryHow'] = 'none';
  if (mod.format === 'cmd') entryHow = mod.entry === null ? 'none' : mod.entrySource === 'transfer' ? 'transfer' : 'lowest';
  else if (mod.format === 'raw') entryHow = 'base';
  if (entry === null) {
    const mined = a.entries.find((e) => e.addr !== null);
    if (mined !== undefined) {
      entry = mined.addr;
      entryHow = 'mined';
    } else if (a.annotations.entries.length > 0) {
      entry = a.annotations.entries[0]!;
      entryHow = 'hint';
    }
  }

  let code = 0;
  for (const run of spaceRuns) {
    for (let addr = run.start; addr <= run.end; addr++) {
      const k = a.pass1.map.kind(addr);
      if (k === Kind.Code || k === Kind.Tail) code++;
    }
  }

  const used = inTableOrder([...a.tablesUsed, ...noteEntries(externalNotes(a.pass1.instructions, a.externals, a.symbols))]);
  const evidence = evidenceOf(a);
  const routines = new Set<number>([...a.symbols.list().filter((s) => s.kind === 'sub').map((s) => s.addr), ...a.roots]);

  const facts: ProgramFacts = {
    format: mod.format,
    loads: runs.map((r) => ({ start: r.start, end: r.end })),
    size,
    entry,
    entryHow,
    relocations: a.space.relocations.map((r) => ({ file: r.fileAddr, run: r.runAddr, length: r.length })),
    memoryNeeded: top <= 0x7fff ? 16 : top <= 0xbfff ? 32 : 48,
    machine: { fit: fitOf(evidence), evidence },
    hardware: used.filter((e) => e.table.startsWith('hardware-')),
    romCalls: used.filter((e) => e.table.startsWith('rom-')),
    dosCalls: used.filter((e) => e.table.startsWith('dos-') || e.table.startsWith('svc-')),
    code: { bytes: code, of: size, percent: size === 0 ? 0 : Math.round((code / size) * 100), routines: routines.size },
  };
  if (mod.format === 'cmd') {
    facts.records = mod.records.length;
    if (mod.name !== undefined) facts.name = mod.name;
  }
  return facts;
}
