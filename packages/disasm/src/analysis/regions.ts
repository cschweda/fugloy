/** Views over the byte-kind map: contiguous regions and basic blocks with successors. */
import type { MemoryImage } from '../memory.js';
import { endsPath, isRst08, targetOf } from './descent.js';
import type { Pass1, XrefKind } from './descent.js';
import { Kind } from './map.js';
import type { ByteMap } from './map.js';

export type RegionKind = 'code' | 'bytes' | 'unknown';

export interface Region {
  kind: RegionKind;
  start: number;
  /** Inclusive. */
  end: number;
}

export interface Successor {
  to: number;
  kind: XrefKind | 'next' | 'external';
}

export interface BasicBlock {
  start: number;
  /** Inclusive last byte of the block's last instruction. */
  end: number;
  succ: Successor[];
}

const classOf = (k: Kind): RegionKind => (k === Kind.Code || k === Kind.Tail ? 'code' : k === Kind.Unknown ? 'unknown' : 'bytes');

/** Maximal same-kind ranges within each loaded run, in address order. */
export function regions(image: MemoryImage, map: ByteMap): Region[] {
  const out: Region[] = [];
  for (const run of image.runs()) {
    let start = run.start;
    let kind = classOf(map.kind(run.start));
    for (let a = run.start + 1; a <= run.end + 1; a++) {
      const k = a <= run.end ? classOf(map.kind(a)) : null;
      if (k === kind) continue;
      out.push({ kind, start, end: a - 1 });
      if (k !== null) {
        start = a;
        kind = k;
      }
    }
  }
  return out;
}

/** Address execution falls through to after `ins` at `addr`, stepping over the RST 08H inline byte. */
function fallThrough(pass1: Pass1, addr: number, ins: Pass1['instructions'] extends Map<number, infer I> ? I : never): number {
  let next = (addr + ins.length) & 0xffff;
  if (isRst08(ins) && pass1.map.kind(next) === Kind.Byte) next = (next + 1) & 0xffff;
  return next;
}

/**
 * Basic blocks over the decoded instructions. A block starts at a root, a
 * transfer target, or the instruction after any transfer; it ends at a
 * transfer (jump, call, return, halt), before the next block start, or where
 * the instruction stream is interrupted.
 */
export function basicBlocks(pass1: Pass1): BasicBlock[] {
  const { instructions } = pass1;
  const externals = new Set(pass1.externals);
  const addrs = [...instructions.keys()].sort((a, b) => a - b);
  const leaders = new Set<number>();
  for (const r of pass1.roots) if (instructions.has(r)) leaders.add(r);
  for (const x of pass1.xrefs) if (instructions.has(x.to)) leaders.add(x.to);
  for (const [a, ins] of instructions) {
    if (ins.flow.kind !== 'next') {
      const n = fallThrough(pass1, a, ins);
      if (instructions.has(n)) leaders.add(n);
    }
  }
  const blocks: BasicBlock[] = [];
  let current: BasicBlock | null = null;
  for (let i = 0; i < addrs.length; i++) {
    const a = addrs[i]!;
    const ins = instructions.get(a)!;
    if (current === null || leaders.has(a)) {
      current = { start: a, end: a, succ: [] };
      blocks.push(current);
    }
    current.end = (a + ins.length - 1) & 0xffff;
    const next = fallThrough(pass1, a, ins);
    const transfers = ins.flow.kind !== 'next';
    const continues = instructions.has(next) && addrs[i + 1] === next && !leaders.has(next);
    if (transfers || !continues) {
      const succ: Successor[] = [];
      const target = targetOf(ins);
      if (target !== null) {
        const kind: XrefKind =
          ins.flow.kind === 'call'
            ? ins.operands[0]?.kind === 'rst' ? 'rst' : ins.flow.conditional ? 'ccall' : 'call'
            : ins.flow.conditional ? 'cjump' : 'jump';
        // A loaded target that is not an instruction start keeps its real kind; the diagnostics say why.
        succ.push({ to: target, kind: externals.has(target) ? 'external' : kind });
      }
      if (!endsPath(ins) && instructions.has(next)) succ.push({ to: next, kind: 'next' });
      current.succ = succ;
      current = null;
    }
  }
  return blocks;
}
