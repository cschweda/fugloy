// Another build of the same game: find saved hint files whose blocks pair with
// the open program's, so the workbench can offer to carry them over.
import { applyHints, parseHints } from '@fugloy/disasm';
import type { Session } from '@fugloy/disasm';

export interface CarryCandidate {
  hash: string;
  name: string;
  text: string;
  matched: number;
  blocks: number;
}

/** The saved hint file (not the program's own) with the most blocks matching this program; null when none match. */
export function bestCarryOver(s: Session, saved: readonly { hash: string; name: string; text: string }[]): CarryCandidate | null {
  let best: CarryCandidate | null = null;
  for (const h of saved) {
    if (h.hash === s.hash) continue;
    const parsed = parseHints(h.text);
    if (parsed.errors.length > 0) continue;
    const applied = applyHints(parsed.file, s.module.image, s.hash, s.normalize);
    if (applied.matched.length === 0 || applied.errors.length > 0) continue;
    if (best === null || applied.matched.length > best.matched) {
      best = { hash: h.hash, name: h.name, text: h.text, matched: applied.matched.length, blocks: parsed.file.blocks.length };
    }
  }
  return best;
}
