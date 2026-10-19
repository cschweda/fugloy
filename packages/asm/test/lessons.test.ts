/**
 * The Learn page's lesson checks (phase 6B, spec Constraints): every lesson under
 * apps/web/content/learn/ assembles cleanly with @fugloy/asm for each model its check.json names,
 * zmac gives the same program, it turns no interrupts on (the stub ROM has no handler), and run
 * headless on Fugløy's stub ROM it reaches the screen its lesson describes, step by step.
 *
 * A lesson folder holds lesson.md, program.z, and check.json; adding one adds its checks here.
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
  | { pcIn: string };

interface Check {
  models: LessonModel[];
  steps: Step[];
}

const learn = new URL('../../../apps/web/content/learn/', import.meta.url);
const folders = readdirSync(learn, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
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
      (keys === 'pcIn' && typeof step['pcIn'] === 'string');
    if (!ok) bad(`step ${i + 1} (${JSON.stringify(s)}) is not one of run, press, release, row and text, cell and byte, or pcIn`);
  });
  return raw as Check;
}

/** The program's lines that assemble to EI, as `line: text`. */
const eiLines = (r: AsmResult): string[] =>
  r.listing.filter((l) => l.bytes.length === 1 && l.bytes[0] === 0xfb && /^\s*(\w+:)?\s*EI\b/i.test(l.text)).map((l) => `${l.line}: ${l.text}`);

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
      const { start, end } = labelRange(r, step.pcIn);
      const pc = m.cpu.regs.pc;
      expect(pc >= start && pc <= end, `${where}: PC is $${hex(pc, 4)}, not in ${step.pcIn} ($${hex(start, 4)}-$${hex(end, 4)})`).toBe(true);
    }
  });
}

describe('the lessons', () => {
  it('finds lesson 1 among them', () => {
    expect(folders).toContain('01-white-out');
  });
});

for (const slug of folders) {
  describe(`lesson ${slug}`, () => {
    const md = readFileSync(new URL(`${slug}/lesson.md`, learn), 'utf8');
    const program = readFileSync(new URL(`${slug}/program.z`, learn), 'utf8');
    const check = readCheck(slug);

    it("has the models its check.json runs it on in its front matter, the lesson's own first", () => {
      expect(parseLesson(slug, md, program).models).toEqual(check.models);
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

      it(`runs on the stub ROM on ${name} to the screen its lesson describes`, () => {
        runSteps(slug, model, assemble(program, { model }), check);
      });
    }
  });
}
