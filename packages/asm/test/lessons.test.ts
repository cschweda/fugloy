/**
 * The Learn page's lesson checks (phase 6B, spec Constraints): every lesson under
 * apps/web/content/learn/ assembles cleanly with @fugloy/asm for each model its check.json names,
 * zmac gives the same program, it turns no interrupts on (the stub ROM has no handler), and run
 * headless on Fugløy's stub ROM it reaches the screen its lesson describes, step by step.
 *
 * A lesson folder holds lesson.md, program.z, and check.json; adding one adds its checks here.
 *
 * Phase 6C: the Space Invaders chapters (apps/web/content/learn/invaders/NN-slug/) are checked the same
 * way, and each chapter's program differs from the one before it (chapter 1's from the blank page).
 * Only NN-slug folders are lessons or chapters, so invaders/ itself is neither.
 *
 * check.json's steps, run in order on the stub ROM:
 *   { "run": n }                  run n T-states (PC must stay out of the ROM's space)
 *   { "press": key } / { "release": key }   a key down or up on the keyboard matrix
 *   { "row": r, "text": s }       screen row r as text, trailing blanks trimmed
 *   { "cell": "3C00", "byte": "BF" }        one byte of memory
 *   { "pcIn": "LABEL" }           PC is on the line LABEL names (its bytes), as for a jump-to-self wait
 *   { "pcIn": "FROM", "to": "TO" }          PC is in the range from FROM's address up to, not including,
 *                                 TO's address (TO must come after FROM), so a check during a counted
 *                                 loop holds on any T-state of a pass rather than on one instruction's
 */
import { readdirSync, readFileSync } from 'node:fs';
import { Machine } from '@fugloy/emu';
import { describe, expect, it } from 'vitest';
import { expectSameImage, skipIfNoZmac } from '../../disasm/test/roundtrip/zmac.js';
import { parseLesson } from '../../../apps/web/app/utils/learn/lesson-format.js';
import { assemble, toCmd } from '../src/index.js';
import type { AsmResult } from '../src/index.js';
import { diagnosticsOf, runZmac } from './helpers.js';

type LessonModel = 1 | 3;

type Step =
  | { run: number }
  | { press: string }
  | { release: string }
  | { row: number; text: string }
  | { cell: string; byte: string }
  | { pcIn: string; to?: string };

interface Check {
  models: LessonModel[];
  steps: Step[];
}

const learn = new URL('../../../apps/web/content/learn/', import.meta.url);
/** The NN-slug folders under `sub` of content/learn, as paths from it. */
const itemsIn = (sub: string): string[] =>
  readdirSync(new URL(sub, learn), { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d\d-/.test(d.name))
    .map((d) => sub + d.name)
    .sort();
const lessonFolders = itemsIn('');
const chapterFolders = itemsIn('invaders/');
const folders = [...lessonFolders, ...chapterFolders];
const zit = skipIfNoZmac();

const HALT = 0x76;
/** Where each model's ROM space ends: the stub is padded with HALT to it, as the site pads it. */
const ROM_END: Readonly<Record<LessonModel, number>> = { 1: 0x3000, 3: 0x3800 };
const stubSource = readFileSync(new URL('../../../apps/web/app/utils/emulator/stub-rom.z', import.meta.url), 'utf8');

/** Fugløy's stub ROM for a model: stub-rom.z assembled and padded with HALT, as utils/emulator/stub-rom.ts builds it. */
function stubRom(model: LessonModel): Uint8Array {
  const r = assemble(stubSource, { model });
  if (!r.ok || r.image === null) throw new Error(`the stub ROM did not assemble: ${diagnosticsOf(r).join('; ')}`);
  const rom = new Uint8Array(ROM_END[model]).fill(HALT);
  for (const run of r.image.runs()) rom.set(r.image.bytes.subarray(run.start, run.start + run.length), run.start);
  return rom;
}

/**
 * A lesson's scripted run is tens of millions of T-states, and chapter 8's (its floor at row 13) about
 * 236 million. Lesson 7 takes about 6 s on a CI runner against 1.6 s locally, about 3.8 times as long;
 * chapter 8 takes about 9 s locally, so about 35 s on CI. 180 s leaves room for that under parallel load.
 */
const RUN_TIMEOUT_MS = 180_000;

const hex = (n: number, width: number): string => n.toString(16).toUpperCase().padStart(width, '0');

/** The check file, its shape checked so a typo fails with a sentence rather than a silent pass. */
function readCheck(slug: string): Check {
  const raw = JSON.parse(readFileSync(new URL(`${slug}/check.json`, learn), 'utf8')) as unknown;
  const bad = (why: string): never => {
    throw new Error(`${slug}/check.json: ${why}`);
  };
  if (typeof raw !== 'object' || raw === null) return bad('it is not an object');
  const { models, steps } = raw as { models?: unknown; steps?: unknown };
  const modelsOk = Array.isArray(models) && (JSON.stringify(models) === '[3]' || JSON.stringify(models) === '[3,1]');
  if (!modelsOk) bad('models must be [3] or [3, 1]');
  if (!Array.isArray(steps) || steps.length === 0) return bad('steps must be a non-empty array');
  steps.forEach((s: unknown, i) => {
    const keys = typeof s === 'object' && s !== null ? Object.keys(s).sort().join(',') : '';
    const step = s as Record<string, unknown>;
    const ok =
      (keys === 'run' && Number.isInteger(step['run']) && (step['run'] as number) > 0) ||
      ((keys === 'press' || keys === 'release') && typeof step[keys] === 'string') ||
      (keys === 'row,text' && Number.isInteger(step['row']) && (step['row'] as number) >= 0 && (step['row'] as number) <= 15 && typeof step['text'] === 'string') ||
      (keys === 'byte,cell' && /^[0-9A-F]{1,4}$/i.test(String(step['cell'])) && /^[0-9A-F]{1,2}$/i.test(String(step['byte']))) ||
      (keys === 'pcIn' && typeof step['pcIn'] === 'string') ||
      (keys === 'pcIn,to' && typeof step['pcIn'] === 'string' && typeof step['to'] === 'string' && step['to'] !== '');
    if (!ok) bad(`step ${i + 1} (${JSON.stringify(s)}) is not one of run, press, release, row and text, cell and byte, pcIn, or pcIn and to`);
  });
  return raw as Check;
}

/** The program's lines that assemble to EI, as `line: text`. */
const eiLines = (r: AsmResult): string[] =>
  r.listing.filter((l) => l.bytes.length === 1 && l.bytes[0] === 0xfb && /^\s*(\w+:)?\s*EI\b/i.test(l.text)).map((l) => `${l.line}: ${l.text}`);

/**
 * The run addresses a pcIn step names, from the first to the last (inclusive): the bytes of the line
 * labelled `label`, or with `to`, from `label`'s address up to, not including, `to`'s.
 */
function pcRange(r: AsmResult, label: string, to?: string): { start: number; end: number } {
  if (to === undefined) return labelRange(r, label);
  const from = labelRange(r, label).start;
  const sym = r.symbol(to);
  if (sym === undefined || sym.line === 0) throw new Error(`pcIn's "to" names ${to}, which the program does not define`);
  if (sym.value <= from) throw new Error(`pcIn's "to" names ${to}, at $${hex(sym.value, 4)}, which is not after ${label} at $${hex(from, 4)}`);
  return { start: from, end: sym.value - 1 };
}

/** The run addresses the line labelled `label` emitted bytes at, from its address to its last byte. */
function labelRange(r: AsmResult, label: string): { start: number; end: number } {
  const sym = r.symbol(label);
  if (sym === undefined || sym.line === 0) throw new Error(`pcIn names ${label}, which the program does not define`);
  const at = r.sourceMap.linesOf(sym.value).find((l) => l.line === sym.line);
  if (at === undefined) throw new Error(`pcIn names ${label}, whose line emits no code`);
  const listed = r.listing.find((l) => l.line === sym.line)!;
  return { start: sym.value, end: sym.value + listed.bytes.length - 1 };
}

/** Boots the stub, loads the program's .CMD, and runs the check's steps; each failure names the step. */
function runSteps(slug: string, model: LessonModel, r: AsmResult, check: Check): void {
  const m = new Machine({ model, roms: { level2: stubRom(model) } });
  expect(m.run({ until: 'halt', cycles: m.clockHz }).reason, 'the stub ROM starts and halts').toBe('halt');
  m.load.cmd(toCmd(r));
  check.steps.forEach((step, i) => {
    const where = `${slug} on the Model ${model === 3 ? 'III' : 'I'}, step ${i + 1} ${JSON.stringify(step)}`;
    if ('run' in step) {
      m.run({ cycles: step.run });
      const pc = m.cpu.regs.pc;
      expect(pc, `${where}: PC is $${hex(pc, 4)}, in the ROM's space: the program fell into the stub`).toBeGreaterThanOrEqual(0x3800);
    } else if ('press' in step) m.keyboard.press(step.press);
    else if ('release' in step) m.keyboard.release(step.release);
    else if ('row' in step) expect(m.video.text()[step.row]!.trimEnd(), where).toBe(step.text);
    else if ('cell' in step) expect(hex(m.mem.read(parseInt(step.cell, 16), 1)[0]!, 2), where).toBe(step.byte.toUpperCase().padStart(2, '0'));
    else {
      const { start, end } = pcRange(r, step.pcIn, step.to);
      const pc = m.cpu.regs.pc;
      const named = step.to === undefined ? step.pcIn : `${step.pcIn} up to ${step.to}`;
      expect(pc >= start && pc <= end, `${where}: PC is $${hex(pc, 4)}, not in ${named} ($${hex(start, 4)}-$${hex(end, 4)})`).toBe(true);
    }
  });
}

describe('the lessons', () => {
  it('finds lesson 1 among them, and chapter 1 of the invaders course', () => {
    expect(lessonFolders).toContain('01-white-out');
    expect(chapterFolders[0]).toBe('invaders/01-blank-loop');
    expect(folders).not.toContain('invaders');
  });
});

describe("check.json's pcIn", () => {
  const r = assemble('\tORG\t7000H\nFIRST:\tNOP\n\tNOP\nPARK:\tJR\tPARK\n\tEND\tFIRST\n', { model: 3 });
  it('names one line alone, or a range up to, not including, its "to"', () => {
    expect(pcRange(r, 'PARK')).toEqual({ start: 0x7002, end: 0x7003 });
    expect(pcRange(r, 'FIRST', 'PARK')).toEqual({ start: 0x7000, end: 0x7001 });
  });
  it('says why a "to" is not a label after the start', () => {
    expect(() => pcRange(r, 'FIRST', 'NOPE')).toThrow('pcIn\'s "to" names NOPE, which the program does not define');
    expect(() => pcRange(r, 'PARK', 'FIRST')).toThrow('pcIn\'s "to" names FIRST, at $7000, which is not after PARK at $7002');
  });
});

describe('the invaders chapters', () => {
  /** A program's lines with trailing blanks trimmed, as the page's change marks compare them. */
  const linesOf = (text: string): string => text.split(/\r\n|\r|\n/).map((l) => l.trimEnd()).join('\n');
  chapterFolders.forEach((folder, i) => {
    it(`${folder} differs from ${i === 0 ? 'the blank page' : chapterFolders[i - 1]}`, () => {
      const program = readFileSync(new URL(`${folder}/program.z`, learn), 'utf8');
      const before = i === 0 ? '' : readFileSync(new URL(`${chapterFolders[i - 1]}/program.z`, learn), 'utf8');
      expect(linesOf(program).trim()).not.toBe('');
      expect(linesOf(program)).not.toBe(linesOf(before));
    });
  });
});

for (const slug of folders) {
  describe(`${slug.startsWith('invaders/') ? 'chapter' : 'lesson'} ${slug}`, () => {
    const md = readFileSync(new URL(`${slug}/lesson.md`, learn), 'utf8');
    const program = readFileSync(new URL(`${slug}/program.z`, learn), 'utf8');
    const check = readCheck(slug);

    it('names in its pcIn steps only labels the program defines, each "to" after its start', () => {
      for (const model of check.models) {
        const r = assemble(program, { model });
        for (const step of check.steps) if ('pcIn' in step) expect(() => pcRange(r, step.pcIn, step.to), `${slug}/check.json ${JSON.stringify(step)}`).not.toThrow();
      }
    });

    it("has the models its check.json runs it on in its front matter, the lesson's own first", () => {
      expect(parseLesson(slug.replace(/^invaders\//, ''), md, program).models).toEqual(check.models);
    });

    for (const model of check.models) {
      const name = `the Model ${model === 3 ? 'III' : 'I'}`;

      it(`assembles for ${name} with no diagnostic and no EI`, () => {
        const r = assemble(program, { model });
        expect(diagnosticsOf(r)).toEqual([]);
        expect(r.ok).toBe(true);
        expect(r.entry, 'the program names its entry on END').not.toBeNull();
        expect(eiLines(r), 'no lesson turns interrupts on: the stub ROM has no handler').toEqual([]);
      });

      zit(`assembles with zmac to the same image, runs and entry as for ${name}`, () => {
        const r = assemble(program, { model });
        const z = runZmac(program);
        expect(z.clean, z.output).toBe(true);
        expectSameImage(r.image!, z.image!);
        expect(r.image!.runs()).toEqual(z.image!.runs());
        expect(r.entry).toBe(z.entry);
      });

      it(
        `runs on the stub ROM on ${name} to the screen its lesson describes`,
        () => {
          runSteps(slug, model, assemble(program, { model }), check);
        },
        RUN_TIMEOUT_MS,
      );
    }
  });
}
