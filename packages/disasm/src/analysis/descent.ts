/**
 * Pass 1: recursive descent from the entry points. Decodes linearly from each
 * root, follows every statically known jump, call, and RST target, queues both
 * arms of conditional branches, and ends a path at returns, indirect jumps,
 * unconditional jumps, HALT, and `nocode` hints. A label file's read-only run
 * ends paths too, but never at a root from any other source (the module
 * entry, a hint, `--entry`, a .BAS program's planted entries, a table): the
 * run is cut short there. Paths from roots only the label file gave run after
 * all others and end before a byte it saw change at runtime. Annotations are applied
 * first and win: typed regions are data to descent, declared tables seed it,
 * forced code regions decode before anything else. Unreached bytes stay
 * Unknown; targets outside loaded memory are external references (ROM); the
 * first decode of any byte wins and later paths that would overlap it stop
 * with a diagnostic.
 */
import { decode } from '@fugloy/z80';
import type { Instruction } from '@fugloy/z80';
import { emptyAnnotations } from '../hints/apply.js';
import type { Annotations } from '../hints/apply.js';
import type { MemoryImage } from '../memory.js';
import { ByteMap, Kind } from './map.js';

export type XrefKind = 'jump' | 'cjump' | 'call' | 'ccall' | 'rst';

export interface Xref {
  from: number;
  to: number;
  kind: XrefKind;
}

export type DiagnosticKind = 'overlap' | 'inside-instruction' | 'in-data' | 'truncated' | 'unloaded-root' | 'nocode';

export interface Diagnostic {
  kind: DiagnosticKind;
  addr: number;
  /** The instruction that referred to `addr`, when a transfer caused the diagnostic. */
  from?: number;
  message: string;
}

export interface Pass1 {
  map: ByteMap;
  /** Decoded instructions keyed by start address. */
  instructions: Map<number, Instruction>;
  roots: number[];
  xrefs: Xref[];
  /** Transfer targets outside loaded memory, sorted and unique. */
  externals: number[];
  /** Addresses of JP (HL), JP (IX), JP (IY). */
  indirectJumps: number[];
  diagnostics: Diagnostic[];
}

const $ = (n: number): string => `$${n.toString(16).toUpperCase().padStart(4, '0')}`;

/** Static target of a jump, call, or RST; null for indirect jumps and everything else. */
export function targetOf(ins: Instruction): number | null {
  if (ins.flow.kind !== 'jump' && ins.flow.kind !== 'call') return null;
  if (ins.flow.indirect) return null;
  for (const op of ins.operands) {
    if (op.kind === 'imm16') return op.value;
    if (op.kind === 'rel') return op.target;
    if (op.kind === 'rst') return op.addr;
  }
  return null;
}

/** True when execution cannot fall through to the next instruction. */
export function endsPath(ins: Instruction): boolean {
  const f = ins.flow;
  if (f.kind === 'halt') return true;
  if (f.kind === 'return') return !f.conditional;
  if (f.kind === 'jump') return f.indirect || !f.conditional;
  return false;
}

/** RST 08H, the ROM's syntax-check call, is followed by an inline parameter byte. */
export const isRst08 = (ins: Instruction): boolean => ins.mnemonic === 'RST' && ins.operands[0]?.kind === 'rst' && ins.operands[0].addr === 0x08;

/** Start address of the instruction that owns a Tail byte. */
function ownerOf(map: ByteMap, addr: number): number {
  let a = addr;
  for (let i = 0; i < 4; i++) {
    if (map.isStart(a)) return a;
    a = (a - 1) & 0xffff;
  }
  return addr;
}

interface WorkItem {
  addr: number;
  from?: number;
  /** On a path from a root only the label file gave: it ends before a byte the label file saw change. */
  weak?: boolean;
}

export function recursiveDescent(image: MemoryImage, rootsIn: number[], annotations: Annotations = emptyAnnotations()): Pass1 {
  const map = new ByteMap();
  const instructions = new Map<number, Instruction>();
  const xrefs: Xref[] = [];
  const externals = new Set<number>();
  const indirectJumps: number[] = [];
  const diagnostics: Diagnostic[] = [];
  /** Addresses where a path ends, with why: a `nocode` hint, or a byte a label file saw read and never executed. */
  const nocode = new Map<number, string>();
  const work: WorkItem[] = [];
  /** Paths from label-only roots wait until every other path is done, so a stronger path is never cut short where a weak one got first. */
  const weakWork: WorkItem[] = [];
  const diagnose = (kind: DiagnosticKind, addr: number, message: string, from?: number): void => {
    diagnostics.push(from === undefined ? { kind, addr, message } : { kind, addr, from, message });
  };
  /** True while the instruction being decoded is on a path from a label-only root. */
  let weakPath = false;
  const transfer = (from: number, to: number, kind: XrefKind): void => {
    xrefs.push({ from, to, kind });
    if (image.isLoaded(to)) {
      if (weakPath) weakWork.push({ addr: to, from, weak: true });
      else work.push({ addr: to, from });
    }
    else externals.add(to);
  };
  const changed = new Uint8Array(0x10000);
  for (const c of annotations.changed ?? []) changed.fill(1, c.addr, Math.min(c.addr + c.length, 0x10000));

  // Declared tables' entries: roots after the explicit ones.
  const tableTargets: { from: number; to: number }[] = [];
  for (const t of annotations.tables) {
    for (let i = 0; i < t.count; i++) {
      const at = (t.addr + i * t.width) & 0xffff;
      const lo = image.read(at);
      const hi = image.read(at + 1);
      if (lo === undefined || hi === undefined) break;
      tableTargets.push({ from: at, to: lo | (hi << 8) });
    }
  }
  // Roots from anything but the label file, table targets included: a label file's read-only run stops short of each.
  const labelOnly = new Set(annotations.labelRoots ?? []);
  const strong = new Set([...rootsIn.map((r) => r & 0xffff).filter((r) => !labelOnly.has(r)), ...tableTargets.map((t) => t.to)]);
  // 1. Overrides first: they win over anything descent would decide.
  for (const o of annotations.overrides) {
    if (o.kind === 'nocode' && o.fromLabels === true) {
      let length = o.length;
      for (const r of strong) if (r >= o.addr && r < o.addr + length) length = r - o.addr;
      for (let i = 0; i < length; i++) if (!nocode.has((o.addr + i) & 0xffff)) nocode.set((o.addr + i) & 0xffff, 'read, never executed, per the label file');
    } else if (o.kind === 'nocode') nocode.set(o.addr, 'nocode hint');
    else if (o.kind === 'bytes') map.mark(o.addr, o.length, Kind.Byte);
    else if (o.kind === 'words') map.mark(o.addr, o.length, Kind.Word);
    else if (o.kind === 'string') map.mark(o.addr, o.length, Kind.String);
  }
  // 2. Tables: typed as words.
  for (const t of annotations.tables) {
    for (let i = 0; i < t.count * t.width && image.isLoaded(t.addr + i); i++) map.mark((t.addr + i) & 0xffff, 1, Kind.Word);
  }
  // 3. Roots, in the caller's order, then table targets.
  const roots = [...new Set(rootsIn.map((r) => r & 0xffff))];
  for (const r of roots) {
    if (image.isLoaded(r)) {
      if (strong.has(r)) work.push({ addr: r });
      else weakWork.push({ addr: r, weak: true });
    }
    else diagnose('unloaded-root', r, `entry ${$(r)} is not in loaded memory`);
  }
  for (const { from, to } of tableTargets) transfer(from, to, 'jump');

  /** Decodes one instruction at `addr` and records it; null when the path cannot continue there. */
  const decodeOne = (addr: number, from?: number): { ins: Instruction; next: number } | null => {
    if (!image.isLoaded(addr) || map.isStart(addr)) return null;
    const why = nocode.get(addr);
    if (why !== undefined) {
      diagnose('nocode', addr, `path ends at ${$(addr)} (${why})`, from);
      return null;
    }
    const kind = map.kind(addr);
    if (kind === Kind.Tail) {
      diagnose('inside-instruction', addr, `target ${$(addr)} is inside the instruction at ${$(ownerOf(map, addr))}`, from);
      return null;
    }
    if (kind !== Kind.Unknown) {
      diagnose('in-data', addr, `target ${$(addr)} is typed as data`, from);
      return null;
    }
    const ins = decode((i) => image.read(addr + i), addr);
    if (ins.truncated === true) {
      map.markByte(addr, 1);
      diagnose('truncated', addr, `instruction at ${$(addr)} runs past loaded memory`);
      return null;
    }
    if (weakPath) {
      for (let k = 0; k < ins.length; k++) {
        if (changed[(addr + k) & 0xffff] === 1) {
          diagnose('nocode', addr, `path ends at ${$(addr)} (changed at runtime, per the label file: the file's bytes are not what ran)`, from);
          return null;
        }
      }
    }
    const typed = map.firstTyped(addr, ins.length);
    if (typed !== null) {
      diagnose('overlap', addr, `instruction at ${$(addr)} would overlap ${map.isCode(typed) ? 'code' : 'data'} at ${$(typed)}`);
      return null;
    }
    map.markCode(addr, ins.length);
    instructions.set(addr, ins);
    let next = (addr + ins.length) & 0xffff;
    const target = targetOf(ins);
    if (target !== null) {
      if (ins.flow.kind === 'call') transfer(addr, target, ins.operands[0]?.kind === 'rst' ? 'rst' : ins.flow.conditional ? 'ccall' : 'call');
      else transfer(addr, target, ins.flow.conditional ? 'cjump' : 'jump');
    }
    if (ins.flow.kind === 'jump' && ins.flow.indirect) indirectJumps.push(addr);
    if (isRst08(ins) && image.isLoaded(next)) {
      if (map.isCode(next)) diagnose('overlap', addr, `inline byte after RST 08H at ${$(addr)} is already code at ${$(next)}`);
      else {
        if (map.kind(next) === Kind.Unknown) map.markByte(next, 1);
        next = (next + 1) & 0xffff;
      }
    }
    return { ins, next };
  };

  // 4. Forced code regions decode linearly, flow ignored, before the worklist.
  for (const o of annotations.overrides) {
    if (o.kind !== 'code' || o.length === 0) continue;
    let a = o.addr;
    const end = o.addr + o.length;
    while (a < end) {
      if (map.kind(a & 0xffff) !== Kind.Unknown || !image.isLoaded(a)) { a++; continue; }
      const r = decodeOne(a & 0xffff);
      a = r === null ? a + 1 : (r.next < a ? end : r.next);
    }
  }

  // 5. The worklist.
  while (work.length > 0 || weakWork.length > 0) {
    const item = work.length > 0 ? work.shift()! : weakWork.shift()!;
    let addr = item.addr;
    let from = item.from;
    weakPath = item.weak === true;
    for (;;) {
      const r = decodeOne(addr, from);
      if (r === null) break;
      from = undefined;
      if (endsPath(r.ins)) break;
      addr = r.next;
    }
  }

  return { map, instructions, roots, xrefs, externals: [...externals].sort((a, b) => a - b), indirectJumps, diagnostics };
}
