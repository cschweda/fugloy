/**
 * Turns a parsed hint file into address-keyed annotations for one image by
 * pairing hint blocks with loaded runs by content identity (length and hash),
 * never by position. Nothing downstream knows the file format.
 */
import type { MemoryImage, Run } from '../memory.js';
import type { HintBlock, HintFile } from './format.js';
import { analysisSpace } from '../analysis/relocate.js';
import type { Relocation } from '../analysis/relocate.js';
import { blockIdentities } from './identity.js';
import type { IdentityNormalizer } from './identity.js';

export type OverrideKind = 'bytes' | 'words' | 'string' | 'code' | 'nocode';

export interface Override {
  addr: number;
  kind: OverrideKind;
  /** Bytes covered; 0 for a `code` hint without a length (a root only). */
  length: number;
  /** A `nocode` from a label file's coverage: bytes read and never executed. Every byte of it ends a path, not only the first. */
  fromLabels?: true;
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
  /** Block comments printed above an address, one entry per `note` line, in file order. */
  notes: Map<number, string[]>;
  /** Regions that execute elsewhere; every other address here is already a runtime address. */
  relocations: Relocation[];
  /** Entries known only because a label file saw them execute: roots, but not marked `entry` in the listing. */
  executed?: number[];
  /**
   * Roots only a label file gave (its executed instructions and code labels). Every other root is
   * stronger: a read-only run of the label file never ends a path at one (descent trims the run there).
   */
  labelRoots?: number[];
  /**
   * Loaded bytes a label file saw change at runtime (written while coverage was on, or since the
   * load), outside any relocation: what ran there was not the file's bytes. A path from a
   * `labelRoots` root ends before decoding one; paths from every other root ignore them.
   */
  changed?: { addr: number; length: number }[];
}

export interface Applied {
  annotations: Annotations;
  matched: { block: HintBlock; run: Run }[];
  unmatched: { block: HintBlock; hints: number }[];
  warnings: string[];
  /** `at` hints refused because they name a loaded address. */
  rejected: number;
  /** Hints that cannot apply at all (a relocation that would overwrite memory): the CLI exits 2. */
  errors: string[];
}

export const emptyAnnotations = (): Annotations => ({ entries: [], overrides: [], tables: [], names: new Map(), comments: new Map(), notes: new Map(), relocations: [] });

const hex4 = (n: number): string => n.toString(16).toUpperCase().padStart(4, '0');
const TERMINATORS = new Set([0x00, 0x0d, 0x03]);

/** `normalize` is the identity normalizer the hint file was written with (basIdentityNormalizer for a .BAS). */
export function applyHints(file: HintFile, image: MemoryImage, programHash?: string, normalize?: IdentityNormalizer): Applied {
  const warnings: string[] = [];
  if (file.program !== undefined && programHash !== undefined && file.program !== programHash) {
    warnings.push("program hash differs from the hint file's; the hints were written for another file, so blocks are matched by content");
  }
  const identities = blockIdentities(image, normalize);
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

  // Relocations first: every other hint names a file offset and lands at that byte's runtime address.
  const relocations: Relocation[] = [];
  for (const hint of file.hints) {
    const run = runOf.get(hint.block);
    if (hint.directive !== 'relocate' || run === undefined) continue;
    relocations.push({ fileAddr: (run.start + hint.offset) & 0xffff, length: hint.length, runAddr: hint.addr });
  }
  const { space, errors } = analysisSpace(image, relocations);
  const annotations = emptyAnnotations();
  /** The block:offset spelling of a loaded runtime address, for the warning (block 0 when no hint block matched it). */
  const loadedKey = (addr: number): string => {
    const i = runs.findIndex((r) => addr >= r.start && addr <= r.end);
    return `${Math.max(i, 0)}:$${hex4(i < 0 ? 0 : addr - runs[i]!.start)}`;
  };
  annotations.relocations = space.relocations;
  let rejected = 0;
  // Address-keyed hints: only for runtime addresses the program does not load.
  for (const hint of file.hints) {
    if (hint.at === undefined || (hint.directive !== 'name' && hint.directive !== 'comment')) continue;
    if (image.isLoaded(hint.at) || space.image.isLoaded(hint.at)) {
      warnings.push(`at $${hex4(hint.at)} names a loaded address; use block ${loadedKey(hint.at)} instead`);
      rejected++;
      continue;
    }
    if (hint.directive === 'name') annotations.names.set(hint.at, hint.name);
    else annotations.comments.set(hint.at, hint.text);
  }
  for (const hint of file.hints) {
    const run = runOf.get(hint.block);
    if (run === undefined || hint.directive === 'relocate' || hint.at !== undefined) continue;
    const fileAddr = (run.start + hint.offset) & 0xffff;
    // A hint inside a relocated source stays inside it; one before a source stops where the source starts.
    const moved = space.relocations.find((r) => fileAddr >= r.fileAddr && fileAddr < r.fileAddr + r.length);
    const next = moved === undefined ? space.relocations.filter((r) => r.fileAddr > fileAddr && r.fileAddr <= run.end).sort((a, b) => a.fileAddr - b.fileAddr)[0] : undefined;
    const last = moved !== undefined ? moved.fileAddr + moved.length - 1 : next !== undefined ? next.fileAddr - 1 : run.end;
    const room = last - fileAddr + 1;
    const limit = next === undefined ? 'runs past the end of the run' : `runs into the relocated source at $${hex4(next.fileAddr)}`;
    const addr = space.toRun(fileAddr) ?? fileAddr;
    const clip = (length: number, what: string): number => {
      if (length <= room) return length;
      warnings.push(`${what} at ${hint.block}:$${hex4(hint.offset)} ${limit}; clipped to $${hex4(room)} bytes`);
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
          for (let a = fileAddr; a <= last; a++) {
            if (TERMINATORS.has(image.bytes[a]!)) { length = a - fileAddr + 1; break; }
          }
        }
        annotations.overrides.push({ addr, kind: 'string', length: clip(length, 'string') });
        break;
      }
      case 'table': {
        const fit = Math.floor(room / hint.width);
        let count = hint.count;
        if (count > fit) {
          warnings.push(`table at ${hint.block}:$${hex4(hint.offset)} ${limit}; clipped to ${fit} ${fit === 1 ? 'entry' : 'entries'}`);
          count = fit;
        }
        if (count >= 1) annotations.tables.push({ addr, count, width: hint.width });
        break;
      }
      case 'name':
        annotations.names.set(addr, hint.name);
        break;
      case 'comment':
        annotations.comments.set(addr, hint.text);
        break;
      case 'note':
        annotations.notes.set(addr, [...(annotations.notes.get(addr) ?? []), hint.text]);
        break;
    }
  }
  return { annotations, matched, unmatched, warnings, rejected, errors };
}
