/** What the Explain tab's engine returns: sentences made of text and link pieces, previews and details. No HTML. */
import type { TableEntry } from '../symbols/types.js';

/** A piece of a sentence. `addr` links the listing (an address the program loads); `entry` links the Symbol tab. */
export type Piece = { text: string; addr?: number; entry?: TableEntry };
export type Sentence = Piece[];

/** What is at an address the line uses: up to 4 listing lines from there, its label and comment, or its table entry. */
export interface Preview {
  addr: number;
  title: string;
  lines: string[];
  entry?: TableEntry;
  comment?: string;
}

/** The quieter strip: size, T-states (both when conditional), the flags it changes (SZHPNC order), and whether Zilog documents it. */
export interface Details {
  bytes: number;
  cycles: number;
  cyclesNotTaken?: number;
  flags: string;
  documented: boolean;
}

/** The data region a data row belongs to (filled in by the data-region explainer). */
export interface DataRegion {
  start: number;
  end: number;
  name: string;
  users: { addr: number; text: string }[];
  pointers: { variable: number; name: string; storedAt: number; readers: number[] }[];
  readers: { loop: number; step: 1 | -1; splits: { at: number; text: string }[] }[];
  sentences: Sentence[];
}

export interface Explanation {
  kind: 'code' | 'data' | 'label' | 'other' | 'basic';
  addr: number | null;
  /** The row as the listing prints it. */
  line: string;
  /** The plain-English lead. */
  sentences: Sentence[];
  pattern?: { name: string; from: number; to: number; sentences: Sentence[] };
  previews: Preview[];
  details?: Details;
  /**
   * A label row: its callers and jumpers (only those proven to lead here),
   * whether it is an entry point, the instructions that hold its address as a
   * number (`pointers`: it may be reached through them), and the calls and
   * jumps that start out leading here but whose bytes the program rewrites.
   */
  label?: { name: string; callers: number[]; jumpers: number[]; entry: boolean; pointers: number[]; rewritten: number[] };
  region?: DataRegion;
}

export const sentenceText = (s: Sentence): string => s.map((p) => p.text).join('');
