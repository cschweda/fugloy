/**
 * Pass 1: recursive descent from the entry points. Decodes linearly from each
 * root, follows every statically known jump, call, and RST target, queues both
 * arms of conditional branches, and ends a path at returns, indirect jumps,
 * unconditional jumps, and HALT. Unreached bytes stay Unknown; targets outside
 * loaded memory are external references (ROM); the first decode of any byte
 * wins and later paths that would overlap it stop with a diagnostic.
 */
import { decode } from '@fugloy/z80';
import type { Instruction } from '@fugloy/z80';
import type { MemoryImage } from '../memory.js';
import { ByteMap, Kind } from './map.js';

export type XrefKind = 'jump' | 'cjump' | 'call' | 'ccall' | 'rst';

export interface Xref {
  from: number;
  to: number;
  kind: XrefKind;
}

export type DiagnosticKind = 'overlap' | 'inside-instruction' | 'in-data' | 'truncated' | 'unloaded-root';

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

function firstCode(map: ByteMap, addr: number, length: number): number {
  for (let i = 0; i < length; i++) if (map.isCode(addr + i)) return (addr + i) & 0xffff;
  return addr & 0xffff;
}

interface WorkItem {
  addr: number;
  from?: number;
}

export function recursiveDescent(image: MemoryImage, rootsIn: number[]): Pass1 {
  const map = new ByteMap();
  const instructions = new Map<number, Instruction>();
  const xrefs: Xref[] = [];
  const externals = new Set<number>();
  const indirectJumps: number[] = [];
  const diagnostics: Diagnostic[] = [];
  const roots = [...new Set(rootsIn.map((r) => r & 0xffff))];
  const work: WorkItem[] = [];
  const diagnose = (kind: DiagnosticKind, addr: number, message: string, from?: number): void => {
    diagnostics.push(from === undefined ? { kind, addr, message } : { kind, addr, from, message });
  };

  for (const r of roots) {
    if (image.isLoaded(r)) work.push({ addr: r });
    else diagnose('unloaded-root', r, `entry ${$(r)} is not in loaded memory`);
  }

  const transfer = (from: number, to: number, kind: XrefKind): void => {
    xrefs.push({ from, to, kind });
    if (image.isLoaded(to)) work.push({ addr: to, from });
    else externals.add(to);
  };

  while (work.length > 0) {
    const item = work.shift()!;
    let addr = item.addr;
    if (map.isStart(addr)) continue;
    const kind = map.kind(addr);
    if (kind === Kind.Tail) {
      diagnose('inside-instruction', addr, `target ${$(addr)} is inside the instruction at ${$(ownerOf(map, addr))}`, item.from);
      continue;
    }
    if (kind === Kind.Byte) {
      diagnose('in-data', addr, `target ${$(addr)} is typed as data`, item.from);
      continue;
    }
    for (;;) {
      if (!image.isLoaded(addr) || map.isStart(addr)) break;
      const ins = decode((i) => image.read(addr + i), addr);
      if (ins.truncated === true) {
        map.markByte(addr, 1);
        diagnose('truncated', addr, `instruction at ${$(addr)} runs past loaded memory`);
        break;
      }
      if (map.overlapsCode(addr, ins.length)) {
        diagnose('overlap', addr, `instruction at ${$(addr)} would overlap code at ${$(firstCode(map, addr, ins.length))}`);
        break;
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
        map.markByte(next, 1);
        next = (next + 1) & 0xffff;
      }
      if (endsPath(ins)) break;
      addr = next;
    }
  }

  return { map, instructions, roots, xrefs, externals: [...externals].sort((a, b) => a - b), indirectJumps, diagnostics };
}
