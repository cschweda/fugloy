// Another build of the same game: find saved (or committed) hint files whose blocks pair with
// the open program's, so the workbench can offer to carry them over.
import { applyHints, parseHints } from '@fugloy/disasm';
import type { Session } from '@fugloy/disasm';

export interface CarryCandidate {
  hash: string;
  name: string;
  text: string;
  matched: number;
  blocks: number;
  /** Hint blocks of the file that no block of this program matches. */
  unmatched: number;
  /** Lines that do not parse, and hints that cannot apply: shown, never hidden. */
  problems: string[];
}

/** The hint file (not the program's own) with the most blocks matching this program; null when none match. The first of equals wins. */
export function bestCarryOver(s: Session, saved: readonly { hash: string; name: string; text: string }[]): CarryCandidate | null {
  let best: CarryCandidate | null = null;
  for (const h of saved) {
    if (h.hash === s.hash) continue;
    const parsed = parseHints(h.text);
    const applied = applyHints(parsed.file, s.module.image, s.hash, s.normalize);
    if (applied.matched.length === 0) continue;
    if (best === null || applied.matched.length > best.matched) {
      best = {
        hash: h.hash,
        name: h.name,
        text: h.text,
        matched: applied.matched.length,
        blocks: parsed.file.blocks.length,
        unmatched: applied.unmatched.length,
        problems: [...parsed.errors.map((e) => `line ${e.line}: ${e.message}`), ...applied.errors],
      };
    }
  }
  return best;
}
