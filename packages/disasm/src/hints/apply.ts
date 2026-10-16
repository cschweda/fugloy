/**
 * Turns a parsed hint file into address-keyed annotations for one image by
 * pairing hint blocks with loaded runs by content identity (length and hash),
 * never by position. Nothing downstream knows the file format.
 */
import type { MemoryImage, Run } from '../memory.js';
import type { HintBlock, HintFile } from './format.js';
import { blockIdentities } from './identity.js';

export type OverrideKind = 'bytes' | 'words' | 'string' | 'code' | 'nocode';

export interface Override {
  addr: number;
  kind: OverrideKind;
  /** Bytes covered; 0 for a `code` hint without a length (a root only). */
  length: number;
}

export interface TableHint {
  addr: number;
  count: number;
  width: number;
}

export interface Annotations {
  entries: number[];
  overrides: Override[];
  tables: TableHint[];
  names: Map<number, string>;
  comments: Map<number, string>;
}

export interface Applied {
  annotations: Annotations;
  matched: { block: HintBlock; run: Run }[];
  unmatched: { block: HintBlock; hints: number }[];
  warnings: string[];
}

export const emptyAnnotations = (): Annotations => ({ entries: [], overrides: [], tables: [], names: new Map(), comments: new Map() });

const hex4 = (n: number): string => n.toString(16).toUpperCase().padStart(4, '0');
const TERMINATORS = new Set([0x00, 0x0d, 0x03]);

export function applyHints(file: HintFile, image: MemoryImage, programHash?: string): Applied {
  const warnings: string[] = [];
  if (file.program !== undefined && programHash !== undefined && file.program !== programHash) {
    warnings.push("program hash differs from the hint file's; the hints were written for another file, so blocks are matched by content");
  }
  const identities = blockIdentities(image);
  const runs = image.runs();
  const taken = new Set<number>();
  const matched: Applied['matched'] = [];
  const unmatched: Applied['unmatched'] = [];
  const runOf = new Map<number, Run>();
  for (const block of [...file.blocks].sort((a, b) => a.index - b.index)) {
    const id = identities.find((i) => !taken.has(i.index) && i.length === block.length && i.hash === block.hash);
    if (id === undefined) {
      const hints = file.hints.filter((h) => h.block === block.index).length;
      unmatched.push({ block, hints });
      warnings.push(`hint block ${block.index} (length $${hex4(block.length)}, hash ${block.hash}) has no matching run; ${hints} hint${hints === 1 ? '' : 's'} skipped`);
      continue;
    }
    taken.add(id.index);
    const run = runs[id.index]!;
    matched.push({ block, run });
    runOf.set(block.index, run);
  }

  const annotations = emptyAnnotations();
  for (const hint of file.hints) {
    const run = runOf.get(hint.block);
    if (run === undefined) continue;
    const addr = (run.start + hint.offset) & 0xffff;
    const room = run.end - addr + 1;
    const clip = (length: number, what: string): number => {
      if (length <= room) return length;
      warnings.push(`${what} at ${hint.block}:$${hex4(hint.offset)} runs past the end of the run; clipped to $${hex4(room)} bytes`);
      return room;
    };
    switch (hint.directive) {
      case 'entry':
        annotations.entries.push(addr);
        break;
      case 'nocode':
        annotations.overrides.push({ addr, kind: 'nocode', length: 1 });
        break;
      case 'code':
        annotations.overrides.push({ addr, kind: 'code', length: hint.length === undefined ? 0 : clip(hint.length, 'code') });
        break;
      case 'bytes':
      case 'words':
        annotations.overrides.push({ addr, kind: hint.directive, length: clip(hint.length, hint.directive) });
        break;
      case 'string': {
        let length = hint.length;
        if (length === undefined) {
          length = room;
          for (let a = addr; a <= run.end; a++) {
            if (TERMINATORS.has(image.bytes[a]!)) { length = a - addr + 1; break; }
          }
        }
        annotations.overrides.push({ addr, kind: 'string', length: clip(length, 'string') });
        break;
      }
      case 'table':
        annotations.tables.push({ addr, count: hint.count, width: hint.width });
        break;
      case 'name':
        annotations.names.set(addr, hint.name);
        break;
      case 'comment':
        annotations.comments.set(addr, hint.text);
        break;
    }
  }
  return { annotations, matched, unmatched, warnings };
}
