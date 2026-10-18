/**
 * LDIR mover proposals (spec §3, §5.7). Most real load modules start with a
 * stub that loads the game high, copies it down with LD HL,src / LD DE,dst /
 * LD BC,len / LDIR, and jumps into the copy. Each root's path is followed
 * through decoded instructions (fallthrough and unconditional jumps) with HL,
 * DE, and BC tracked as constants. At an LDIR with all three known, the move
 * becomes one `relocate` line per loaded piece of its source, leaving out
 * bytes already decoded as code where they load (the stub itself) and bytes
 * whose destination would cover memory that stays loaded, such as the stub's
 * first bytes when the copy runs over them. The first jump after the LDIR
 * into the copy becomes an `entry` line, and so does a constant the stub
 * pushes into the copy (`PUSH HL` before a jump to a `RET`). A copy nothing
 * jumps into is data (a screen, a buffer, variables) and is not proposed,
 * nor is a fill (`LD DE,src+1`); the proposals for one file never overlap,
 * so they can be applied together. Nothing is applied here.
 */
import { hex4 } from '@fugloy/z80';
import type { Instruction, Operand } from '@fugloy/z80';
import { endsPath, targetOf } from './descent.js';
import type { Pass1 } from './descent.js';
import { pair, stepRegs, unknownRegs } from './regs.js';
import type { Relocation } from './relocate.js';
import type { BlockIdentity } from '../hints/identity.js';
import type { MemoryImage } from '../memory.js';

export interface MoverProposal {
  kind: 'move';
  /** Address of the LDIR. */
  ldir: number;
  /** The move as the registers set it up. */
  src: number;
  dst: number;
  length: number;
  /** One `relocate` line per piece of the source that can move, then the `entry` line when the stub jumps into the copy. */
  hints: string[];
}

/** A path is followed this many instructions at most. */
const MAX_STEPS = 512;

const pairOf = (o: Operand | undefined): 'BC' | 'DE' | 'HL' | null => {
  if (o?.kind === 'reg16') return o.reg === 'BC' || o.reg === 'DE' || o.reg === 'HL' ? o.reg : null;
  if (o?.kind !== 'reg') return null;
  return o.reg === 'B' || o.reg === 'C' ? 'BC' : o.reg === 'D' || o.reg === 'E' ? 'DE' : o.reg === 'H' || o.reg === 'L' ? 'HL' : null;
};

interface Move {
  ldir: number;
  src: number;
  dst: number;
  length: number;
  jump?: number;
  pushed?: number;
}

export function proposeMovers(image: MemoryImage, pass1: Pass1, identities: BlockIdentity[], relocations: readonly Relocation[] = []): MoverProposal[] {
  const moves: Move[] = [];
  const seen = new Set<number>();
  for (const root of pass1.roots) {
    const regs = unknownRegs();
    const visited = new Set<number>();
    const open: Move[] = [];
    let addr: number | null = root;
    for (let steps = 0; addr !== null && steps < MAX_STEPS; steps++) {
      const ins = pass1.instructions.get(addr);
      if (ins === undefined || visited.has(addr)) break;
      visited.add(addr);
      if (ins.mnemonic === 'LDIR') {
        const [hl, de, bc] = [pair(regs, 'HL'), pair(regs, 'DE'), pair(regs, 'BC')];
        if (hl !== null && de !== null && bc !== null && !seen.has(addr)) {
          seen.add(addr);
          const move: Move = { ldir: addr, src: hl, dst: de, length: bc === 0 ? 0x10000 : bc };
          open.push(move);
          moves.push(move);
        }
        stepRegs(ins, regs);
      } else {
        if (ins.mnemonic === 'PUSH') {
          const p = pairOf(ins.operands[0]);
          const value = p === null ? null : pair(regs, p);
          if (value !== null) for (const m of open) if (m.pushed === undefined && value >= m.dst && value < m.dst + m.length) m.pushed = value;
        }
        stepRegs(ins, regs);
      }
      const target = targetOf(ins);
      const unconditional = ins.flow.kind === 'jump' && !ins.flow.conditional && !ins.flow.indirect;
      if (unconditional && target !== null) {
        for (const m of open) if (m.jump === undefined && target >= m.dst && target < m.dst + m.length) m.jump = target;
      }
      addr = endsPath(ins) ? (unconditional ? target : null) : (addr + ins.length) & 0xffff;
    }
  }
  // Bytes already moved by a hint (at their file and their runtime addresses), or claimed by an earlier
  // proposal, are not available to another. So a second-stage copy out of relocated memory gets no
  // proposal: its source has no one file offset a relocate line could name.
  const taken = new Uint8Array(0x10000);
  for (const r of relocations) {
    taken.fill(1, r.fileAddr, r.fileAddr + r.length);
    taken.fill(1, r.runAddr, r.runAddr + r.length);
  }
  return moves.flatMap((m) => {
    const p = proposal(m, image, pass1, identities, taken);
    return p === null ? [] : [p];
  });
}

function proposal(m: Move, image: MemoryImage, pass1: Pass1, identities: BlockIdentity[], taken: Uint8Array): MoverProposal | null {
  const n = m.length;
  if (m.src + n > 0x10000 || m.dst + n > 0x10000) return null;
  if (m.dst > m.src && m.dst < m.src + n) return null; // an LDIR onto its own source's tail fills; it does not move
  if (m.jump === undefined && m.pushed === undefined) return null; // nothing runs in the copy: a data copy
  const blockOf = (a: number): BlockIdentity | undefined => identities.find((b) => a >= b.start && a < b.start + b.length);
  // leaves[i]: source byte i leaves its file address with the move. A byte whose destination is held by memory that
  // stays loaded cannot move, and then stays loaded itself, so the check repeats until nothing changes.
  const leaves = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = m.src + i;
    leaves[i] = image.isLoaded(a) && !taken[a] && !pass1.map.isCode(a) ? 1 : 0;
  }
  const staysAt = (d: number): boolean => image.isLoaded(d) && !(d >= m.src && d < m.src + n && leaves[d - m.src] === 1);
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < n; i++) {
      const d = m.dst + i;
      if (leaves[i] === 1 && (staysAt(d) || taken[d] === 1)) {
        leaves[i] = 0;
        changed = true;
      }
    }
  }
  const entries: string[] = [];
  for (const target of new Set([m.jump, m.pushed])) {
    if (target === undefined || leaves[target - m.dst] !== 1) continue;
    const file = m.src + (target - m.dst);
    const block = blockOf(file)!;
    entries.push(`block ${block.index}:$${hex4(file - block.start)} entry`);
  }
  if (entries.length === 0) return null;
  const hints: string[] = [];
  for (let i = 0; i < n; ) {
    if (leaves[i] !== 1) {
      i++;
      continue;
    }
    const block = blockOf(m.src + i)!;
    let j = i;
    while (j + 1 < n && leaves[j + 1] === 1 && m.src + j + 1 < block.start + block.length) j++;
    hints.push(`block ${block.index}:$${hex4(m.src + i - block.start)} relocate $${hex4(m.dst + i)} $${hex4(j - i + 1)}`);
    taken.fill(1, m.src + i, m.src + j + 1);
    taken.fill(1, m.dst + i, m.dst + j + 1);
    i = j + 1;
  }
  return { kind: 'move', ldir: m.ldir, src: m.src, dst: m.dst, length: n, hints: [...hints, ...entries] };
}
