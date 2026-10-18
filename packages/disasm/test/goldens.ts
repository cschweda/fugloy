/**
 * The listing goldens under __snapshots__/rows/: every synthetic fixture, every
 * program under examples/, and the committed hint files, opened as the CLI opens
 * them (`openProgram` with Model III and its default DOS). Captured before the
 * row refactor, so the text listings stay byte-identical across it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rebaseBas } from '../src/bas-rebase.js';
import type { BasProgram } from '../src/bas.js';
import type { RenderOptions } from '../src/listing.js';
import type { Analysis } from '../src/pipeline.js';
import { openProgram, withHintText } from '../src/session.js';
import type { Session } from '../src/session.js';
import { selectSymbols } from '../src/symbols/select.js';
import type { SymbolSelection } from '../src/symbols/select.js';

export const GOLDEN_DIR = fileURLToPath(new URL('./__snapshots__/rows/', import.meta.url));
const root = fileURLToPath(new URL('../../../', import.meta.url));
const selection: SymbolSelection = { machine: 3, dos: 'trsdos' };

/** One golden: a pass 1 listing of `analysis`, or a BASIC listing of `prog`. */
export type GoldenCase =
  | { name: string; kind: 'pass1'; analysis: Analysis; opts: RenderOptions; session?: Session }
  | { name: string; kind: 'bas'; prog: BasProgram; opts: RenderOptions; session?: Session };

const read = (rel: string): Uint8Array => new Uint8Array(readFileSync(`${root}${rel}`));
const files = (dir: string, keep: (f: string) => boolean): string[] =>
  readdirSync(`${root}${dir}`).filter(keep).sort().map((f) => `${dir}/${f}`);
const slug = (rel: string): string => rel.replace(/^fixtures\//, '').replace(/\//g, '-');

/** A pass 1 case, and for a .BAS also its BASIC listing; `session` set on the one the CLI would print. */
function casesFor(name: string, s: Session): GoldenCase[] {
  const mod = s.module;
  const source = s.name;
  const out: GoldenCase[] = [{ name: `${name}.pass1`, kind: 'pass1', analysis: s.analysis, opts: { source }, ...(s.plainBasic ? {} : { session: s }) }];
  if (mod.format === 'bas') {
    const tables = s.selection === undefined ? {} : { tables: selectSymbols(s.selection) };
    out.push({ name: `${name}.basic`, kind: 'bas', prog: mod, opts: { source, ...tables }, ...(s.plainBasic ? { session: s } : {}) });
  }
  return out;
}

export function goldenCases(): GoldenCase[] {
  const out: GoldenCase[] = [];
  const programs = [
    ...files('fixtures/synthetic/cmd', (f) => f.endsWith('.cmd')),
    ...files('fixtures/synthetic/bas', (f) => f.endsWith('.bas')),
    ...readdirSync(`${root}examples`).sort().flatMap((d) => files(`examples/${d}`, (f) => !f.endsWith('.md') && !f.endsWith('.hints') && !f.endsWith('.labels.json'))),
  ];
  for (const rel of programs) {
    const name = rel.split('/').at(-1)!;
    out.push(...casesFor(slug(rel), openProgram(read(rel), { name, selection })));
    // Without tables: the library path the workbench takes before a machine is chosen.
    if (rel.startsWith('fixtures/')) out.push(...casesFor(`${slug(rel)}.notables`, openProgram(read(rel), { name })));
  }
  const hinted: [string, string][] = [
    ['fixtures/synthetic/cmd/hint-paths.cmd', 'fixtures/synthetic/hints/hint-paths.hints'],
    ['fixtures/synthetic/cmd/relocated-code.cmd', 'fixtures/synthetic/hints/relocated-code.hints'],
    ['examples/sea-dragon/seadrg01.cmd', 'examples/sea-dragon/seadrg01.hints'],
  ];
  for (const [rel, hints] of hinted) {
    const name = rel.split('/').at(-1)!;
    const hintName = hints.split('/').at(-1)!;
    const s = withHintText(openProgram(read(rel), { name, selection }), readFileSync(`${root}${hints}`, 'utf8'), hintName);
    out.push(...casesFor(`${slug(rel)}+hints`, s));
  }
  // A rebased .BAS (`--rebase 5000`): the header says where it was saved from.
  for (const rel of ['fixtures/synthetic/bas/hidden-code.bas', 'fixtures/synthetic/bas/prog-7000.bas']) {
    const name = rel.split('/').at(-1)!;
    const first = openProgram(read(rel), { name, selection });
    if (first.module.format !== 'bas') throw new Error(`${rel} is not BASIC`);
    out.push(...casesFor(`${slug(rel)}+rebase-5000`, openProgram(rebaseBas(read(rel), 0x5000), { name, selection, rebasedFrom: first.module.base })));
  }
  return out;
}

export const goldenPath = (c: GoldenCase): string => `${GOLDEN_DIR}${c.name}.txt`;
