/**
 * A routine's blocks as structured code: loops, and the blocks in an order where every transfer is a
 * `continue` to a loop's head, a `break` out of a loop or a labelled block to the code after it, or the
 * target's own code written in place. A pure function over the routine's control flow (no text);
 * emit.ts writes the result.
 *
 * The algorithm (after Ramsey, "Beyond Relooper", 2022): the blocks in reverse postorder from the
 * routine's start, their dominators (Cooper, Harvey and Kennedy's iteration), and the dominator tree.
 * A transfer backward in that order must go to a block that dominates its source (a loop's head),
 * else the flow is irreducible and the routine is not structured. A loop is a back edge's natural
 * loop; its head is written as a loop, and the blocks it leaves to (its exits: a block outside it
 * whose immediate dominator is inside) are written after it, each with the outermost loop it leaves.
 * Any other block is written where its immediate dominator's code reaches it: in place, when only
 * one transfer reaches it, or after a labelled block wrapping its dominator's code, when two or more
 * do (a merge, as where an if/else's arms meet). No block's code is written twice.
 */

/** A routine's control flow: its start, and each of its blocks with the transfers its code makes. */
export interface Flow {
  start: number;
  /**
   * Each block of the routine, by its start: the blocks of the routine it transfers to, one entry per
   * transfer its code makes, in the order the code makes them (a conditional jump to the next block is
   * two). Transfers out of the routine (a CALL, a RET, a jump into another routine, a throw) are not in it.
   */
  succ: ReadonlyMap<number, readonly number[]>;
}

/** Code: pieces run one after another. */
export type Code = readonly Piece[];

export type Piece =
  /** The block at `addr`: its statements, its transfers as `Structured.exits` says. */
  | { kind: 'block'; addr: number }
  /** A loop whose body begins with the block `header`; `continue` goes round, `break` leaves it to the piece after it. */
  | { kind: 'loop'; header: number; body: Code }
  /** A labelled block: breaking it goes to the piece after it, which is the code of `follow`. */
  | { kind: 'labelled'; follow: number; body: Code };

/** How a transfer from one block to another is written. */
export type Exit =
  /** The target's code, written where the transfer is: the one transfer that reaches it. */
  | { kind: 'inline'; code: Code }
  /** `continue` the loop whose head is the target. */
  | { kind: 'continue'; header: number }
  /** `break` the loop headed by `header`: the target is the code written straight after it. */
  | { kind: 'break-loop'; header: number }
  /** `break` the labelled block that `follow`'s code comes after. */
  | { kind: 'break'; follow: number };

export type Structured =
  | {
      ok: true;
      code: Code;
      /** For each block written, by its start, how each of its transfers is written, by the target. */
      exits: ReadonlyMap<number, ReadonlyMap<number, Exit>>;
      /** The blocks no transfer from the start reaches, in address order: not written. */
      unreachable: number[];
    }
  | { ok: false; why: string };

const addr = (n: number): string => `$${n.toString(16).toUpperCase().padStart(4, '0')}`;

export function structure(flow: Flow): Structured {
  const { start, succ } = flow;
  if (!succ.has(start)) return { ok: false, why: `the routine's start, ${addr(start)}, is not one of its blocks` };
  for (const [from, tos] of succ) {
    for (const to of tos) if (!succ.has(to)) return { ok: false, why: `${addr(from)} transfers to ${addr(to)}, which is not one of the routine's blocks` };
  }
  const next = (n: number): readonly number[] => succ.get(n)!;

  // ---- reverse postorder from the start (an iterative depth-first search, successors in order)
  const post: number[] = [];
  const seen = new Set<number>([start]);
  const stack: { n: number; k: number }[] = [{ n: start, k: 0 }];
  while (stack.length > 0) {
    const top = stack[stack.length - 1]!;
    const tos = next(top.n);
    if (top.k < tos.length) {
      const to = tos[top.k++]!;
      if (!seen.has(to)) {
        seen.add(to);
        stack.push({ n: to, k: 0 });
      }
    } else {
      post.push(top.n);
      stack.pop();
    }
  }
  const order = post.reverse();
  const rpo = new Map(order.map((n, k) => [n, k]));
  const unreachable = [...succ.keys()].filter((n) => !rpo.has(n)).sort((x, y) => x - y);

  const preds = new Map<number, number[]>(order.map((n) => [n, []]));
  for (const n of order) for (const to of next(n)) preds.get(to)!.push(n);

  // ---- dominators (Cooper, Harvey and Kennedy)
  const idom = new Map<number, number>([[start, start]]);
  const intersect = (a: number, b: number): number => {
    while (a !== b) {
      while (rpo.get(a)! > rpo.get(b)!) a = idom.get(a)!;
      while (rpo.get(b)! > rpo.get(a)!) b = idom.get(b)!;
    }
    return a;
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (const n of order) {
      if (n === start) continue;
      let d: number | undefined;
      for (const p of preds.get(n)!) if (idom.has(p)) d = d === undefined ? p : intersect(p, d);
      if (d !== undefined && idom.get(n) !== d) {
        idom.set(n, d);
        changed = true;
      }
    }
  }
  const dominates = (a: number, b: number): boolean => {
    for (let n = b; ; n = idom.get(n)!) {
      if (n === a) return true;
      if (n === start) return false;
    }
  };

  // ---- back edges, which must each go to a block that dominates its source
  const backward = (from: number, to: number): boolean => rpo.get(to)! <= rpo.get(from)!;
  const latches = new Map<number, number[]>();
  for (const n of order) {
    for (const to of next(n)) {
      if (!backward(n, to)) continue;
      if (!dominates(to, n)) return { ok: false, why: `the jump from ${addr(n)} to ${addr(to)} enters a loop other than at its head` };
      latches.set(to, [...(latches.get(to) ?? []), n]);
    }
  }

  // ---- natural loops: each head's body, and the loops each block is in, innermost first
  const body = new Map<number, Set<number>>();
  for (const [head, from] of latches) {
    const inside = new Set<number>([head]);
    const todo = [...from];
    while (todo.length > 0) {
      const n = todo.pop()!;
      if (inside.has(n)) continue;
      inside.add(n);
      todo.push(...preds.get(n)!);
    }
    body.set(head, inside);
  }
  const loopsOf = new Map<number, number[]>(order.map((n) => [n, [...body.keys()].filter((h) => body.get(h)!.has(n)).sort((a, b) => body.get(a)!.size - body.get(b)!.size)]));

  // ---- the dominator tree, children in reverse postorder
  const children = new Map<number, number[]>(order.map((n) => [n, []]));
  for (const n of order) if (n !== start) children.get(idom.get(n)!)!.push(n);

  // ---- each loop's exits: a block outside a loop that its immediate dominator is in, written after the
  // outermost loop it leaves (the loops its dominator is in nest; those without it come first)
  const exitOf = new Map<number, number>();
  const follows = new Map<number, number[]>();
  for (const n of order) {
    if (n === start) continue;
    const around = loopsOf.get(idom.get(n)!)!;
    let left: number | undefined;
    for (const h of around) {
      if (body.get(h)!.has(n)) break;
      left = h;
    }
    if (left === undefined) continue;
    exitOf.set(n, left);
    follows.set(left, [...(follows.get(left) ?? []), n]);
  }

  // ---- how many forward transfers reach each block
  const forwardIn = new Map<number, number>();
  for (const n of order) for (const to of next(n)) if (!backward(n, to)) forwardIn.set(to, (forwardIn.get(to) ?? 0) + 1);

  const exits = new Map<number, Map<number, Exit>>();

  /** The code of `x` and of the blocks it dominates, but its loop's exits. */
  const tree = (x: number): Piece[] => {
    // A merge is written after its dominator's code; so is a loop's exit, after its loop
    const merges = children.get(x)!.filter((c) => !exitOf.has(c) && forwardIn.get(c)! >= 2);
    if (!body.has(x)) return within(x, merges);
    const after = follows.get(x) ?? [];
    let code: Piece[] = [{ kind: 'loop', header: x, body: within(x, merges) }];
    after.forEach((f, k) => {
      code = k === 0 ? [...code, ...tree(f)] : [{ kind: 'labelled', follow: f, body: code }, ...tree(f)];
    });
    return code;
  };

  /** `x`'s block with the merges among its children after it, the last outermost. */
  const within = (x: number, merges: readonly number[]): Piece[] => {
    if (merges.length === 0) {
      const how = new Map<number, Exit>();
      exits.set(x, how);
      for (const to of next(x)) if (!how.has(to)) how.set(to, branch(x, to));
      return [{ kind: 'block', addr: x }];
    }
    const last = merges[merges.length - 1]!;
    return [{ kind: 'labelled', follow: last, body: within(x, merges.slice(0, -1)) }, ...tree(last)];
  };

  const branch = (from: number, to: number): Exit => {
    if (backward(from, to)) return { kind: 'continue', header: to };
    const loop = exitOf.get(to);
    if (loop !== undefined) return follows.get(loop)![0] === to ? { kind: 'break-loop', header: loop } : { kind: 'break', follow: to };
    if (forwardIn.get(to)! >= 2) return { kind: 'break', follow: to };
    return { kind: 'inline', code: tree(to) };
  };

  const code = tree(start);
  // Every block reached is written once: a check on the algorithm, not on the program
  const written: number[] = [];
  const walk = (c: Code): void => {
    for (const p of c) {
      if (p.kind === 'block') {
        written.push(p.addr);
        for (const e of exits.get(p.addr)!.values()) if (e.kind === 'inline') walk(e.code);
      } else walk(p.body);
    }
  };
  walk(code);
  if (written.length !== order.length || new Set(written).size !== order.length) {
    return { ok: false, why: 'the structure would write a block other than once' };
  }
  return { ok: true, code, exits, unreachable };
}
