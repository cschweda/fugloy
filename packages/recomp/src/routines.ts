/**
 * A program's basic blocks grouped into routines, from @fugloy/disasm's IR. A routine is the entry,
 * the target of a CALL or RST, or a continuation: the instruction after a POP that drops a return
 * address (M2; port() ends the POP's block there, and the port goes on there a routine up); its blocks are those reachable from its start by jumps and by
 * falling through (the address after a CALL included) without entering another routine's start.
 * A transfer into another routine's start leaves the routine (the port returns that routine to the
 * trampoline that runs it). A block two routines both reach belongs to both, each translating it.
 */
import type { BasicBlock, Ir } from '@fugloy/disasm';

export interface Routine {
  /** Where it starts: the entry, a CALL or RST target, or a continuation. */
  start: number;
  /** Its blocks in address order (a block before its start comes first; the routine still begins at its start). */
  blocks: BasicBlock[];
}

export interface Routines {
  /** In address order. */
  routines: Routine[];
  /** The routines' starts. */
  starts: ReadonlySet<number>;
}

/** Successors that stay inside a routine when they reach a block that is no other routine's start. */
const WITHIN = new Set(['jump', 'cjump', 'next']);
/** Successors that make their target a routine. */
const CALLS = new Set(['call', 'ccall', 'rst']);

/**
 * The routines of the program `ir` describes; `entry` and each of `continuations` must start one of its
 * blocks.
 */
export function routinesOf(ir: Ir, entry: number, continuations: Iterable<number> = []): Routines {
  const blocks = new Map(ir.blocks.map((b) => [b.start, b]));
  const starts = new Set<number>([entry, ...continuations]);
  for (const b of ir.blocks) for (const s of b.succ) if (CALLS.has(s.kind) && blocks.has(s.to)) starts.add(s.to);

  const routines = [...starts]
    .sort((x, y) => x - y)
    .map((start): Routine => {
      const seen = new Set<number>([start]);
      const todo = [start];
      while (todo.length > 0) {
        const block = blocks.get(todo.pop()!)!;
        for (const s of block.succ) {
          if (!WITHIN.has(s.kind) || !blocks.has(s.to) || seen.has(s.to) || starts.has(s.to)) continue;
          seen.add(s.to);
          todo.push(s.to);
        }
      }
      return { start, blocks: [...seen].sort((x, y) => x - y).map((a) => blocks.get(a)!) };
    });
  return { routines, starts };
}
