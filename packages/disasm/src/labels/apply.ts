/**
 * Turns a label and coverage file into annotations for one image, and merges
 * them under a hint file's (phase 3 Rulings 9, 10, 11). Label-file addresses
 * are runtime addresses: they came from the running machine, so the image to
 * pass is the analysis space (the file image with every relocate hint applied).
 */
import { hex4 } from '@fugloy/z80';
import { emptyAnnotations } from '../hints/apply.js';
import type { Annotations, Override } from '../hints/apply.js';
import { isValidName, nameProblem, SYNTH_NAME } from '../hints/format.js';
import type { MemoryImage } from '../memory.js';
import { decodeRle } from './format.js';
import type { LabelFile } from './format.js';

/** How a label file applied, for headers and the IR. */
export interface LabelsSummary {
  source?: string;
  /** Names applied. */
  names: number;
  /** Distinct roots: code labels and executed instruction starts inside loaded memory. */
  roots: number;
  /** Read-only runs applied as `nocode`. */
  dataRuns: number;
  warnings: string[];
}

const $ = (n: number): string => `$${hex4(n)}`;
const overlaps = (a: Override, b: Override): boolean => a.addr < b.addr + Math.max(b.length, 1) && b.addr < a.addr + Math.max(a.length, 1);

export function labelAnnotations(file: LabelFile, image: MemoryImage, programHash: string): { annotations: Annotations; summary: LabelsSummary; refused: string | null } {
  const annotations = emptyAnnotations();
  const sha = file.program.sha256;
  // Ruling 10: a file keyed by address states nothing true about another program.
  if (sha !== undefined && sha !== programHash) {
    return {
      annotations,
      summary: { names: 0, roots: 0, dataRuns: 0, warnings: [] },
      refused: `the label file was written for another program (its sha256 is ${sha}, this program's is ${programHash}); nothing applied`,
    };
  }
  const warnings: string[] = [];
  const roots = new Set<number>();
  const labelled = new Set<number>();
  const used = new Map<string, number>();
  for (const label of file.labels) {
    const { addr, name } = label;
    if (!image.isLoaded(addr)) {
      warnings.push(`label ${name} at ${$(addr)} is outside loaded memory; skipped`);
      continue;
    }
    if (label.kind === 'code') { roots.add(addr); labelled.add(addr); }
    // Ruling 9: a name of the generated shape means "no name given".
    if (!SYNTH_NAME.test(name)) {
      const taken = used.get(name.toUpperCase());
      if (!isValidName(name)) warnings.push(`label at ${$(addr)}: ${nameProblem(name)}; the name is skipped`);
      else if (taken !== undefined) warnings.push(`label at ${$(addr)}: name "${name}" is already used at ${$(taken)}; the name is skipped`);
      else {
        used.set(name.toUpperCase(), addr);
        annotations.names.set(addr, name);
      }
    }
    if (label.evidence !== undefined) annotations.comments.set(addr, `observed: ${label.evidence}`);
    if (label.kind === 'data' && label.size !== undefined) {
      let length = 0;
      while (length < label.size && addr + length <= 0xffff && image.isLoaded(addr + length)) length++;
      if (length < label.size) warnings.push(`data label ${name} at ${$(addr)} runs past loaded memory; clipped to ${length} byte${length === 1 ? '' : 's'}`);
      annotations.overrides.push({ addr, kind: 'bytes', length });
    }
  }

  let dataRuns = 0;
  for (const key of Object.keys(file.coverage)) {
    if (key === '0:0') continue;
    const [map, page] = key.split(':');
    warnings.push(`coverage for map ${map}, page ${page} is ignored; only "0:0" applies to this machine`);
  }
  const coverage = file.coverage['0:0'];
  if (coverage !== undefined) {
    const exec = decodeRle(coverage.exec)!;
    const operand = decodeRle(coverage.operand)!;
    const read = decodeRle(coverage.read)!;
    let runStart = -1;
    const endRun = (end: number): void => {
      if (runStart < 0) return;
      annotations.overrides.push({ addr: runStart, kind: 'nocode', length: end - runStart, fromLabels: true });
      dataRuns++;
      runStart = -1;
    };
    for (let a = 0; a <= 0xffff; a++) {
      if (!image.isLoaded(a)) { endRun(a); continue; }
      if (exec[a] === 1) roots.add(a);
      if (read[a] === 1 && exec[a] === 0 && operand[a] === 0) { if (runStart < 0) runStart = a; }
      else endRun(a);
    }
    endRun(0x10000);
  }
  annotations.entries = [...roots].sort((a, b) => a - b);
  annotations.executed = annotations.entries.filter((a) => !labelled.has(a));
  return { annotations, summary: { names: annotations.names.size, roots: roots.size, dataRuns, warnings }, refused: null };
}

/**
 * Ruling 11: the hint file wins. Its names and comments stand; a label name it
 * already uses at another address is dropped (zmac would see it twice); a label
 * override that overlaps one of its overrides is dropped; entries are unioned.
 * Tables, notes, and relocations come from the hint file only.
 */
export function mergeAnnotations(hints: Annotations, labels: Annotations): Annotations {
  const names = new Map(hints.names);
  const hintNames = new Set([...hints.names.values()].map((n) => n.toUpperCase()));
  for (const [addr, name] of labels.names) if (!names.has(addr) && !hintNames.has(name.toUpperCase())) names.set(addr, name);
  const comments = new Map(hints.comments);
  for (const [addr, text] of labels.comments) if (!comments.has(addr)) comments.set(addr, text);
  return {
    ...hints,
    entries: [...new Set([...hints.entries, ...labels.entries])],
    executed: (labels.executed ?? []).filter((a) => !hints.entries.includes(a) && !hints.overrides.some((o) => o.kind === 'code' && o.addr === a)),
    overrides: [...hints.overrides, ...labels.overrides.filter((o) => !hints.overrides.some((h) => overlaps(h, o)))],
    names,
    comments,
  };
}
