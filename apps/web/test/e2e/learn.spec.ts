// The Learn page (phase 6B Task 4), with no ROM, as CI runs it: the lesson's text is in the
// generated HTML; Run ▶ runs lesson 1 on the stub ROM and whites out the screen; Pause and Step move
// the registers; a broken program says why and shows its line (Review Focus 1); an edit survives a
// reload and Reset to the lesson brings the original back (Review Focus 3); leaving a lesson while it
// runs stops it (Review Focus 2, once there is a second lesson); keys typed in the editor never reach
// the TRS-80, and on lesson 3 the arrows plot from the screen but only move the editor's cursor in
// the editor, and keys on the screen never type into the editor (Review Focus 4); the Model I shows its own shape (Review Focus 5); Explain's sentence
// for a clicked line; Open in the workbench; axe is clean; and a narrow window stacks the columns.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const STUB_RUNNING = "Running on Fugløy's stub ROM (no ROM needed for this program).";
const MODEL1_ASPECT = ((4 / 3) * (384 / 10.6445e6)) / (512 / 10.1376e6);
const EDIT_KEY = 'fugloy:learn:edit:01-white-out';

/** /learn/, with the program's editor loaded. */
async function open(page: Page, path = '/learn/'): Promise<void> {
  await page.goto(path);
  await expect(page.locator('.cm-content')).toContainText('FILL', { timeout: 30_000 });
  await page.waitForFunction(() => window.__fugloyLearn !== undefined);
}

/** Run ▶, and the program running. */
async function runIt(page: Page): Promise<void> {
  await page.getByTestId('lesson-run').click();
  await expect.poll(() => page.evaluate(() => window.__fugloyLearn!.runnerState())).toBe('running');
}

/** The canvas's top-left, centre and bottom-right pixels, RGBA. */
const samples = (page: Page): Promise<number[][]> =>
  page.getByTestId('trs-canvas').evaluate((c: HTMLCanvasElement) => {
    const ctx = c.getContext('2d')!;
    return [
      [0, 0],
      [c.width >> 1, c.height >> 1],
      [c.width - 1, c.height - 1],
    ].map(([x, y]) => Array.from(ctx.getImageData(x!, y!, 1, 1).data));
  });

const registers = (page: Page): Promise<string[]> => page.getByTestId('reg-row').allInnerTexts();

/** Replaces the whole program with `text`, typed. */
async function replaceProgram(page: Page, text: string): Promise<void> {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await page.keyboard.type(text);
}

test("the generated /learn/ carries lesson 1's title and text before any script runs", async ({ request }) => {
  const res = await request.get('/learn/');
  expect(res.ok()).toBe(true);
  const html = await res.text();
  expect(html).toContain('White out the screen');
  expect(html).toContain('On a TRS-80 the screen is memory.');
  expect(html).toContain('data-testid="lesson-try"');
  expect(html).toContain('<title>White out the screen — Learn Z80 assembly · Fugløy</title>');
  // The lesson's own page is generated too.
  expect((await request.get('/learn/01-white-out/')).ok()).toBe(true);
});

test('Run ▶ runs lesson 1 on the stub ROM, the screen turns white, and the lesson is marked done', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('lesson-title')).toHaveText('White out the screen');
  await runIt(page);
  await expect(page.getByTestId('lesson-message')).toHaveText(STUB_RUNNING);
  await expect
    .poll(async () => (await samples(page)).every((px) => px[3] === 255 && px[0]! > 128 && px[1]! > 128 && px[2]! > 128))
    .toBe(true);
  await page.getByTestId('lesson-list-toggle').click();
  await expect(page.getByTestId('lesson-list')).toBeVisible();
  await expect(page.getByTestId('lesson-done-01-white-out')).toBeVisible();
});

test('Pause, then Step, changes a register row', async ({ page }) => {
  await open(page);
  await runIt(page);
  await page.getByTestId('lesson-pause').click();
  await expect.poll(() => page.evaluate(() => window.__fugloyLearn!.debugMode())).toBe('paused');
  await expect(page.getByTestId('lesson-pause')).toHaveText('Continue');
  const before = await registers(page);
  expect(before.length).toBeGreaterThan(0);
  await page.getByTestId('lesson-step').click();
  await expect.poll(() => registers(page)).not.toEqual(before);
});

test('a broken program says why and shows its line; a RET from the entry says what the stub ROM did (Review Focus 1)', async ({ page }) => {
  await open(page);
  // A line of nonsense after WAIT (line 17): line 18.
  await page.locator('.cm-line', { hasText: 'WAIT:   JR      WAIT' }).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('\tBAD');
  await page.getByTestId('lesson-run').click();
  const message = page.getByTestId('lesson-message');
  await expect(message).toContainText('so it did not run. The first is on line 18');
  await expect(message).not.toContainText('Source ✎');
  await expect(page.locator('.cm-activeLine')).toContainText('BAD');
  await expect(page.getByTestId('lesson-diag').first()).toContainText('Line 18');

  await replaceProgram(page, '\tORG\t7000H\n\tRET\n\tEND\n');
  await page.getByTestId('lesson-run').click();
  await expect(message).toContainText('returns (RET) to the ROM, but no ROM is loaded');
  expect(await page.evaluate(() => window.__fugloyLearn!.runnerState())).toBe('stopped');
});

test('an edit survives a reload, and Reset to the lesson brings the original back (Review Focus 3)', async ({ page }) => {
  await open(page);
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.type('; my own line\n');
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), EDIT_KEY)).toContain('; my own line');
  await page.reload();
  await expect(page.locator('.cm-content')).toContainText('; my own line', { timeout: 30_000 });
  await page.getByTestId('lesson-reset').click();
  await expect(page.locator('.cm-content')).not.toContainText('; my own line');
  await expect(page.locator('.cm-content')).toContainText('FILL');
  expect(await page.evaluate((k) => localStorage.getItem(k), EDIT_KEY)).toBeNull();
  await page.reload();
  await expect(page.locator('.cm-content')).toContainText('FILL', { timeout: 30_000 });
  await expect(page.locator('.cm-content')).not.toContainText('; my own line');
});

test('moving to the next lesson while one runs stops it and clears its registers (Review Focus 2)', async ({ page }) => {
  await open(page);
  const lessons = await page.getByTestId('lesson-list').locator('li').count();
  test.skip(lessons < 2, 'There is only one lesson so far; this runs once a second lesson exists (Task 5).');
  await runIt(page);
  await expect.poll(async () => (await registers(page)).length).toBeGreaterThan(0);
  const first = await page.getByTestId('lesson-title').innerText();
  await page.getByTestId('lesson-next').click();
  await expect(page.getByTestId('lesson-title')).not.toHaveText(first);
  await expect(page).toHaveURL(/\/learn\/\d\d-[a-z0-9-]+\/$/);
  await expect.poll(() => page.evaluate(() => window.__fugloyLearn?.runnerState() ?? 'none')).toBe('idle');
  await expect(page.getByTestId('registers')).toContainText('The registers show here while a program runs.');
  await expect(page.locator('.cm-line.fg-run-now')).toHaveCount(0);
  // Back to lesson 1: its program, and nothing running.
  await page.goBack();
  await expect(page.getByTestId('lesson-title')).toHaveText(first);
  await expect(page.locator('.cm-content')).toContainText('FILL', { timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => window.__fugloyLearn?.runnerState() ?? 'none')).toBe('idle');
});

test('keys typed in the editor never reach the TRS-80; keys on the screen do (Review Focus 4)', async ({ page }) => {
  await open(page);
  await runIt(page);
  const rows = (): Promise<number[]> => page.evaluate(() => window.__fugloyLearn!.keyboardRows());
  await page.locator('.cm-content').click();
  await page.keyboard.down('a');
  expect(await rows()).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  await page.keyboard.up('a');
  // The screen, focused, takes the same key (A is row 0, bit 1), so the hook reads the real matrix.
  await page.getByTestId('trs-screen').focus();
  await page.keyboard.down('a');
  await expect.poll(rows).toEqual([2, 0, 0, 0, 0, 0, 0, 0]);
  await page.keyboard.up('a');
  await expect.poll(rows).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
});

test('on lesson 3 the arrows plot from the screen; in the editor they move its cursor and plot nothing (Review Focus 4)', async ({ page }) => {
  await page.goto('/learn/03-etch-a-sketch/');
  await expect(page.locator('.cm-content')).toContainText('NOTRT', { timeout: 30_000 });
  await page.waitForFunction(() => window.__fugloyLearn !== undefined);
  await runIt(page);
  const rows = (): Promise<number[]> => page.evaluate(() => window.__fugloyLearn!.keyboardRows());
  /** The cells the pen has lit: video.text() shows a graphics byte as ".". */
  const lit = async (): Promise<number> => (await page.evaluate(() => window.__fugloyLearn!.screenText())).join('').split('.').length - 1;
  const program = (): Promise<string> => page.locator('.cm-content').innerText();
  await expect.poll(lit).toBe(1);

  // In the editor, a held arrow moves the cursor and never reaches the matrix.
  await page.locator('.cm-line', { hasText: 'START:' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(100);
  expect(await rows()).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  await page.keyboard.up('ArrowRight');
  expect(await lit()).toBe(1);
  await page.keyboard.press('Home');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
  expect(await page.evaluate(() => window.getSelection()!.toString())).toBe('STA');
  await page.keyboard.press('Home');

  // On the screen, the same arrow is row 6, bit 6 (40H, 64), and the pen draws.
  const before = await program();
  await page.getByTestId('trs-screen').focus();
  await page.keyboard.down('ArrowRight');
  await expect.poll(rows).toEqual([0, 0, 0, 0, 0, 0, 64, 0]);
  await expect.poll(lit).toBeGreaterThan(1);
  await page.keyboard.up('ArrowRight');
  await expect.poll(rows).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  // And keys typed on the screen never type into the editor.
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.type('xyz');
  await page.waitForTimeout(100);
  expect(await program()).toBe(before);
});

test('a lesson that allows the Model I offers it, and runs there at the Model I shape (Review Focus 5)', async ({ page }) => {
  await open(page);
  const pick = page.getByTestId('lesson-model');
  await expect(pick).toBeVisible();
  expect(await pick.locator('option').allInnerTexts()).toEqual(['Model III', 'Model I']);
  await pick.selectOption('1');
  await runIt(page);
  const shape = (): Promise<{ w: number; h: number; raster: number[] }> =>
    page.getByTestId('trs-screen').evaluate((b: HTMLElement) => ({ w: b.clientWidth, h: b.clientHeight, raster: [b.querySelector('canvas')!.width, b.querySelector('canvas')!.height] }));
  await expect.poll(async () => (await shape()).raster).toEqual([384, 192]);
  const s = await shape();
  expect(Math.abs(s.w / s.h - MODEL1_ASPECT)).toBeLessThan(0.01);
  expect(Math.abs(s.w / s.h - 0.952)).toBeLessThan(0.01);
});

test("a clicked line shows Explain's sentence after a Run, and the prompt before one", async ({ page }) => {
  await open(page);
  const explain = page.getByTestId('lesson-explain');
  await expect(explain).toHaveAttribute('aria-live', 'polite');
  await page.locator('.cm-line', { hasText: 'LD      HL,3C00H' }).click();
  await expect(explain).toHaveText('Run the program, then click a line to read what it does.');
  await runIt(page);
  await page.locator('.cm-line', { hasText: 'LD      HL,3C00H' }).click();
  await expect(explain).toContainText('$3C00');
  await page.locator('.cm-line', { hasText: 'ORG     7000H' }).click();
  await expect(explain).toContainText('has no instruction');
});

test('Open in the workbench copies the program into Source ✎', async ({ page }) => {
  await open(page);
  await page.getByTestId('lesson-open-workbench').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('source-tab')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('source-pick')).toContainText('01-white-out.z');
  await expect(page.getByTestId('source-tab').locator('.cm-content')).toContainText('FILL');
});

test('axe finds nothing on /learn/, running and idle', async ({ page }) => {
  await open(page);
  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
  const axe = async (): Promise<string[]> => (await new AxeBuilder({ page }).withTags(tags).analyze()).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
  expect(await axe()).toEqual([]);
  await page.getByTestId('lesson-list-toggle').click();
  await runIt(page);
  expect(await axe()).toEqual([]);
});

test('at 800 px wide the three columns stack: lesson, program, TRS-80', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await open(page);
  const boxes = await Promise.all(['.fg-learn-lesson', '[data-testid="lesson-program"]', '[data-testid="lesson-machine"]'].map((s) => page.locator(s).boundingBox()));
  const [lesson, program, machine] = boxes.map((b) => b!);
  expect(Math.abs(lesson!.x - program!.x)).toBeLessThan(1);
  expect(Math.abs(program!.x - machine!.x)).toBeLessThan(1);
  expect(program!.y).toBeGreaterThanOrEqual(lesson!.y + lesson!.height);
  expect(machine!.y).toBeGreaterThanOrEqual(program!.y + program!.height);
  // And at 1440 px, side by side.
  await page.setViewportSize({ width: 1440, height: 900 });
  const wide = await Promise.all(['.fg-learn-lesson', '[data-testid="lesson-program"]', '[data-testid="lesson-machine"]'].map((s) => page.locator(s).boundingBox()));
  expect(wide[1]!.x).toBeGreaterThan(wide[0]!.x + wide[0]!.width - 1);
  expect(wide[2]!.x).toBeGreaterThan(wide[1]!.x + wide[1]!.width - 1);
  expect(Math.abs(wide[0]!.y - wide[2]!.y)).toBeLessThan(1);
});
