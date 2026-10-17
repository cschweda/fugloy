/** What the Program tab's spec sheet prints, as plain functions: the memory map's segments and the wording of the loading facts. */
import { hex4 } from '@fugloy/z80';
import type { MachineEvidence, MoverProposal, ProgramFacts, TableProposal } from '@fugloy/disasm';

export type SegmentKind = 'rom' | 'video' | 'free' | 'program' | 'moved';

export interface Segment {
  kind: SegmentKind;
  start: number;
  /** Bytes; the segments tile $0000-$FFFF. */
  length: number;
}

export const SEGMENT_NAME: Readonly<Record<SegmentKind, string>> = {
  rom: 'ROM',
  video: 'keyboard and video',
  free: 'free',
  program: 'program',
  moved: 'where it is copied to',
};

const ROM_END = 0x37ff;
const VIDEO_END = 0x3fff;

/** The 64K address space as runs of one kind: ROM, keyboard and video, the program as loaded, and where relocations copy it to. */
export function memorySegments(loads: readonly { start: number; end: number }[], relocations: readonly { run: number; length: number }[]): Segment[] {
  const kinds: SegmentKind[] = Array.from({ length: 0x10000 }, (_, a): SegmentKind => (a <= ROM_END ? 'rom' : a <= VIDEO_END ? 'video' : 'free'));
  for (const r of relocations) for (let a = r.run; a < r.run + r.length && a < 0x10000; a++) kinds[a] = 'moved';
  for (const l of loads) for (let a = l.start; a <= l.end && a < 0x10000; a++) kinds[a] = 'program';
  const out: Segment[] = [];
  for (let a = 0; a < 0x10000; a++) {
    const last = out.at(-1);
    if (last !== undefined && last.kind === kinds[a]) last.length++;
    else out.push({ kind: kinds[a]!, start: a, length: 1 });
  }
  return out;
}

export const addr$ = (n: number): string => `$${hex4(n & 0xffff)}`;
export const range$ = (start: number, end: number): string => `${addr$(start)}–${addr$(end)}`;
export const bytes$ = (n: number): string => `${n.toLocaleString('en-US')} bytes`;

export const FORMAT_NAME: Readonly<Record<ProgramFacts['format'], string>> = { cmd: '.CMD load module', bas: 'BASIC program', raw: 'raw binary' };

export const ENTRY_HOW: Readonly<Record<ProgramFacts['entryHow'], string>> = {
  transfer: 'transfer address',
  lowest: 'no transfer address; the lowest load address',
  base: 'start of the raw binary',
  hint: 'declared in the hint file',
  mined: 'found in the code',
  none: '',
};

/**
 * The Machine section's lines: what only one machine has, and what differs between
 * the ROMs, in full; everything shared folds into one summary (`facts` keeps the order).
 */
export function splitEvidence(evidence: readonly MachineEvidence[]): { lines: MachineEvidence[]; shared: MachineEvidence[]; summary: string } {
  const lines = evidence.filter((e) => e.machine !== 'both' || e.differs === true);
  const shared = evidence.filter((e) => e.machine === 'both' && e.differs !== true);
  const names = shared.map((e) => (e.name === '' ? addr$(e.key) : e.name));
  const summary = shared.length === 0 ? '' : `Also uses ${shared.length} ${shared.length === 1 ? 'thing' : 'things'} both machines have: ${names.join(', ')}`;
  return { lines, shared, summary };
}

export const proposalText = (p: TableProposal | MoverProposal): string =>
  p.kind === 'table'
    ? `${addr$(p.addr)}: ${p.count} words that all point into code look like a table.`
    : `LDIR at ${addr$(p.ldir)} copies ${addr$(p.src)}–${addr$(p.src + p.length - 1)} to ${addr$(p.dst)}–${addr$(p.dst + p.length - 1)}.`;

/** The hint lines Apply adds. */
export const proposalLines = (p: TableProposal | MoverProposal): string[] => (p.kind === 'table' ? [p.hint] : [...p.hints]);
