/**
 * Turns a label and coverage file into annotations for one image, and merges
 * them under a hint file's (phase 3 Rulings 9, 10, 11). Label-file addresses
 * are runtime addresses: they came from the running machine, so the image to
 * pass is the analysis space (the file image with every relocate hint applied).
 *
 * A runtime address holds the file's byte only if nothing changed it: the
 * file's `write` field marks bytes written while coverage was on or changed
 * since the load. An executed instruction or a code label whose bytes were
 * written says nothing true about the file's bytes there (a program that
 * copied itself, or rewrote its own code), so it applies only inside a region
 * a relocate hint moved; elsewhere it is skipped, with one summary warning.
 * Read-only → data is a heuristic: a read run that was also written, executed,
 * or decoded as an operand is never applied as `nocode`.
 */
import { hex4 } from '@fugloy/z80';
import type { Relocation } from '../analysis/relocate.js';
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

/**
 * `image` is the analysis space and `relocations` the relocate hints that made it: inside a
 * relocation's runtime region, executed and labelled code applies even where it was written
 * (the hint says the file's bytes run there).
 */
export function labelAnnotations(
  file: LabelFile,
  image: MemoryImage,
  programHash: string,
  relocations: readonly Relocation[] = [],
): { annotations: Annotations; summary: LabelsSummary; refused: string | null } {
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
  const coverage = file.coverage['0:0'];
  const exec = coverage === undefined ? null : decodeRle(coverage.exec)!;
  const operand = coverage === undefined ? null : decodeRle(coverage.operand)!;
  const read = coverage === undefined ? null : decodeRle(coverage.read)!;
  const write = coverage === undefined ? null : decodeRle(coverage.write)!;
  const relocated = (a: number): boolean => relocations.some((r) => a >= r.runAddr && a < r.runAddr + r.length);
  /** Executed or labelled code at `addr` that the file's bytes may not hold: its instruction's bytes were written, outside any relocation. */
  const changed = (addr: number): boolean => {
    if (write === null || relocated(addr)) return false;
    if (write[addr] === 1) return true;
    // The instruction's other bytes: the operand bytes that follow an executed start (at most three).
    for (let k = 1; k < 4 && addr + k <= 0xffff && operand![addr + k] === 1 && exec![addr + k] === 0; k++) if (write[addr + k] === 1) return true;
    return false;
  };
  /** Addresses whose executed or labelled code was skipped because it changed at runtime. */
  const skipped = new Set<number>();
  for (const label of file.labels) {
    const { addr, name } = label;
    if ((label.map ?? 0) !== 0 || (label.page ?? 0) !== 0) {
      warnings.push(`label ${name} at ${$(addr)} is for map ${label.map ?? 0}, page ${label.page ?? 0}; only map 0, page 0 applies to this machine; skipped`);
      continue;
    }
    if (!image.isLoaded(addr)) {
      warnings.push(`label ${name} at ${$(addr)} is outside loaded memory; skipped`);
      continue;
    }
    // A data label stays: data is what a program writes. Code whose bytes changed is not the file's code.
    if (label.kind === 'code' && changed(addr)) { skipped.add(addr); continue; }
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
    // The note (a person's remark) first, then the evidence; a hint comment still wins (mergeAnnotations).
    const comment = [label.note, label.evidence === undefined ? undefined : `observed: ${label.evidence}`].filter((c) => c !== undefined && c !== '').join('; ');
    if (comment !== '') annotations.comments.set(addr, comment);
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
  if (exec !== null && operand !== null && read !== null && write !== null) {
    const changedRuns: { addr: number; length: number }[] = [];
    let changedStart = -1;
    for (let a = 0; a <= 0x10000; a++) {
      const on = a <= 0xffff && write[a] === 1 && image.isLoaded(a) && !relocated(a);
      if (on && changedStart < 0) changedStart = a;
      else if (!on && changedStart >= 0) { changedRuns.push({ addr: changedStart, length: a - changedStart }); changedStart = -1; }
    }
    if (changedRuns.length > 0) annotations.changed = changedRuns;
    let runStart = -1;
    const endRun = (end: number): void => {
      if (runStart < 0) return;
      annotations.overrides.push({ addr: runStart, kind: 'nocode', length: end - runStart, fromLabels: true });
      dataRuns++;
      runStart = -1;
    };
    for (let a = 0; a <= 0xffff; a++) {
      if (!image.isLoaded(a)) { endRun(a); continue; }
      if (exec[a] === 1) {
        if (changed(a)) skipped.add(a);
        else roots.add(a);
      }
      // Read and never run, written, or fetched as an operand: probably data (a heuristic; see docs/label-format.md).
      if (read[a] === 1 && exec[a] === 0 && operand[a] === 0 && write[a] === 0) { if (runStart < 0) runStart = a; }
      else endRun(a);
    }
    endRun(0x10000);
  }
  if (skipped.size > 0) {
    const n = skipped.size;
    warnings.push(`${n} executed or labelled address${n === 1 ? '' : 'es'} changed at runtime (written while coverage was on, or since the load); their coverage is not applied to the file's bytes (a relocate hint says where moved code runs)`);
  }
  annotations.entries = [...roots].sort((a, b) => a - b);
  annotations.labelRoots = annotations.entries.slice();
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
    ...(labels.changed === undefined ? {} : { changed: labels.changed }),
    labelRoots: (labels.labelRoots ?? []).filter((a) => !hints.entries.includes(a) && !hints.overrides.some((o) => o.kind === 'code' && o.addr === a)),
    overrides: [...hints.overrides, ...labels.overrides.filter((o) => !hints.overrides.some((h) => overlaps(h, o)))],
    names,
    comments,
  };
}
