/**
 * @fugloy/recomp, M1 Task 5: every Learn lesson and Space Invaders chapter, ported and refereed. For each
 * lesson and chapter folder under apps/web/content/learn/ (found as packages/asm/test/lessons.test.ts
 * finds them: the NN-slug folders, and those under invaders/) and each model its check.json names, the
 * program is assembled with @fugloy/asm, ported with its own labels as the names, and run by the referee
 * (referee.ts) beside @fugloy/emu on Fugløy's stub ROM through the check's steps: every block start,
 * every frame's video RAM and the end's 64K must agree, and every step must hold on both machines.
 *
 * It needs neither zmac nor a user's ROM, so it runs wherever the suite does (CI included).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { toCmd } from '@fugloy/asm';
import { describe, expect, it } from 'vitest';
import { allNamesOf, assembled } from './helpers.js';
import type { Model } from './helpers.js';
import { referee } from './referee.js';
import type { Step } from './referee.js';

const learn = new URL('../../../apps/web/content/learn/', import.meta.url);
/** The NN-slug folders under `sub` of content/learn, as paths from it (lessons.test.ts's rule). */
const itemsIn = (sub: string): string[] =>
  readdirSync(new URL(sub, learn), { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d\d-/.test(d.name))
    .map((d) => sub + d.name)
    .sort();
const lessonFolders = itemsIn('');
const chapterFolders = itemsIn('invaders/');
const folders = [...lessonFolders, ...chapterFolders];

/** lessons.test.ts's RUN_TIMEOUT_MS: chapter 8's run, the longest, is about 12.5 s here under the referee. */
const RUN_TIMEOUT_MS = 180_000;

/** A clock's frame: 1/60 s of it, as the referee compares video RAM (emu's clockHz). */
const FRAME: Readonly<Record<Model, number>> = { 1: 1_774_080 / 60, 3: 2_027_520 / 60 };

interface Check {
  models: Model[];
  steps: Step[];
}

/** The check file; lessons.test.ts checks its shape, and the referee refuses a step it does not know. */
const readCheck = (slug: string): Check => JSON.parse(readFileSync(new URL(`${slug}/check.json`, learn), 'utf8')) as Check;

describe('the Learn programs', () => {
  it('are all here: seven lessons and twelve chapters, each on the models its check.json names', () => {
    expect(lessonFolders).toHaveLength(7);
    expect(chapterFolders).toHaveLength(12);
    expect(folders.map((f) => readCheck(f).models.length).reduce((a, b) => a + b, 0)).toBe(38);
  });
});

for (const slug of folders) {
  describe(`${slug.startsWith('invaders/') ? 'chapter' : 'lesson'} ${slug}`, () => {
    const source = readFileSync(new URL(`${slug}/program.z`, learn), 'utf8');
    const check = readCheck(slug);
    /** The T-states the check's run steps add up to, counted from the program's entry. */
    const length = check.steps.reduce((n, s) => n + ('run' in s ? s.run : 0), 0);

    for (const model of check.models) {
      it(
        `its port runs as emu runs it on the Model ${model === 3 ? 'III' : 'I'}, block for block, through its check`,
        async () => {
          const r = assembled(source, model);
          const res = await referee({ cmd: toCmd(r), model, names: allNamesOf(r), steps: check.steps });
          if (!res.ok) expect.fail(`${slug} on the Model ${model === 3 ? 'III' : 'I'}: ${res.field}: ${res.report}`);
          // The whole check was run (no Learn program returns to the stub), every block start compared,
          // and video RAM at every frame on the way.
          expect(res.cycles).toBeGreaterThanOrEqual(length);
          expect(res.blocks).toBeGreaterThan(0);
          expect(res.frames).toBeGreaterThanOrEqual(Math.floor(length / FRAME[model]));
        },
        RUN_TIMEOUT_MS,
      );
    }
  });
}
