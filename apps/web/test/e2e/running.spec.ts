// The running line in a browser (phase 5C): a breakpoint set with a gutter click stops the Run on
// its line; the disassembled listing of the same program lights the paused row through its <style>
// (a band, a bar, and ▶), the registers show, F10 moves one line and F5 continues; F9 in the
// listing sets a breakpoint on the cursor row's line; the screen-text list matches the screen; and
// axe is clean over the whole workbench (Source ✎ with its gutter, Run ▶, the listing), paused and
// running, with Screen text open, a data line's hollow breakpoint, and the changed-source note.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const ready = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.waitForFunction(() => window.__fugloyTest !== undefined, undefined, { timeout: 30_000 });
};

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const axe = async (page: Page): Promise<string[]> => {
  const r = await new AxeBuilder({ page }).include('[data-testid="workbench"]').withTags(TAGS).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
};

// Line 2 LD A,1 at $7000; 3 INC A at $7002; 4 DEC A at $7003; 5 JR LOOP at $7004.
const PROGRAM = '\tORG\t7000H\nSTART:\tLD\tA,1\nLOOP:\tINC\tA\n\tDEC\tA\n\tJR\tLOOP\n\tEND\tSTART\n';
const row = (page: Page, addr: number) => page.locator(`.fg-listing .fg-row-code[data-addr="${addr}"]`);
/** A row's lit look: its band (a background image), its left bar, and the marker in its line-number column. */
const look = (page: Page, addr: number) =>
  row(page, addr).evaluate((el) => ({
    band: getComputedStyle(el).backgroundImage,
    bar: getComputedStyle(el).boxShadow,
    marker: getComputedStyle(el.querySelector('.fg-col-line')!, '::before').content,
  }));

test('the listing follows the run: a gutter breakpoint stops it, the row is lit, F10 steps, F5 continues; axe clean paused and running', async ({ page }) => {
  await ready(page);
  await page.getByTestId('write-program').click();
  const content = page.locator('.cm-content');
  await expect(content).toContainText('ORG');
  await content.click();
  await page.keyboard.press('ControlOrMeta+a');
  // Clear first and let the editor settle: keys typed into its first edit's reactions can land out of place on a slow runner.
  await page.keyboard.press('Backspace');
  await expect(content).toHaveText('');
  await page.keyboard.type(PROGRAM);

  // A breakpoint on line 4 with a click in the breakpoint gutter beside it.
  const line = await page.locator('.cm-line').nth(3).boundingBox();
  const gutter = await page.locator('.fg-bp-gutter').boundingBox();
  await page.mouse.click(gutter!.x + gutter!.width / 2, line!.y + line!.height / 2);
  await expect(page.getByTestId('breakpoint-text')).toHaveText('Line 4: DEC A');

  await page.getByTestId('run-run').click();
  await expect.poll(() => page.evaluate(() => window.__fugloyTest!.debugMode())).toBe('paused');
  await expect(page.getByTestId('run-message')).toHaveText('Paused at line 4, DEC A, at a breakpoint.');
  await expect(page.getByTestId('registers')).toContainText('Half-carry');

  // The program's own listing follows: its paused row carries the band, the bar, and ▶.
  await page.getByRole('tab', { name: 'Listing' }).click();
  await expect(row(page, 0x7003)).toBeVisible();
  // Paused on DEC A, with the faint trail of how it got there (LD A,1, then INC A).
  expect(await page.evaluate(() => window.__fugloyTest!.listingMarks())).toEqual({
    marks: [
      { addr: 0x7000, class: 'fg-run-trail-2' },
      { addr: 0x7002, class: 'fg-run-trail-1' },
      { addr: 0x7003, class: 'fg-run-paused' },
    ],
    breaks: [0x7003],
  });
  const paused = await look(page, 0x7003);
  expect(paused.band).toContain('linear-gradient');
  expect(paused.bar).toContain('inset');
  expect(paused.marker).toBe('"▶"');
  expect((await look(page, 0x7002)).band).toContain('linear-gradient');
  expect((await look(page, 0x7002)).marker).toBe('none');
  // JR LOOP has not run yet: unlit.
  expect((await look(page, 0x7004)).band).toBe('none');
  expect(await axe(page)).toEqual([]);

  // F10 moves one line, in Source's words and in the listing.
  await page.getByTestId('run-step-over').focus();
  await page.keyboard.press('F10');
  await expect(page.getByTestId('run-message')).toHaveText(/^Line 5, JR LOOP\./);
  await expect.poll(async () => (await look(page, 0x7004)).marker).toBe('"▶"');
  // The breakpoint stays as a dot once the program has moved off it.
  expect((await look(page, 0x7003)).marker).toBe('"●"');

  // F9 in the listing sets a breakpoint on the cursor row's line.
  await row(page, 0x7002).click();
  await page.keyboard.press('F9');
  await expect(page.getByTestId('breakpoint-text')).toHaveText(['Line 3: LOOP: INC A', 'Line 4: DEC A']);
  await expect.poll(async () => (await look(page, 0x7002)).marker).toBe('"●"');
  await page.keyboard.press('F9');
  await expect(page.getByTestId('breakpoint-text')).toHaveText(['Line 4: DEC A']);

  // F5 continues; it stops at the breakpoint again on the next pass of the loop.
  await page.keyboard.press('F5');
  await expect(page.getByTestId('run-message')).toHaveText('Paused at line 4, DEC A, at a breakpoint.');

  // The screen-text list matches the screen (a row click opened Explain: back to Run ▶).
  await page.getByRole('tab', { name: 'Run ▶' }).click();
  await page.getByTestId('screen-text-summary').click();
  await expect(page.getByTestId('screen-text-row')).toHaveCount(16);
  const shown = await page.getByTestId('screen-text-row').allTextContents();
  const screen = await page.evaluate(() => window.__fugloyTest!.screenText());
  expect(shown).toEqual(screen.map((r) => r.trimEnd() || 'blank'));

  // Without the breakpoint the program runs on; the listing is lit while running, and axe is clean.
  await page.getByTestId('breakpoint-remove').click();
  await page.keyboard.press('F5');
  await expect.poll(() => page.evaluate(() => window.__fugloyTest!.debugMode())).toBe('running');
  await expect.poll(async () => (await page.evaluate(() => window.__fugloyTest!.listingMarks()))?.marks.length ?? 0).toBeGreaterThan(0);
  expect(await axe(page)).toEqual([]);
  // The frame-cost hook counts frames while running (Task 5 measures with it).
  expect((await page.evaluate(() => window.__fugloyTest!.frameCost(300))).frames).toBeGreaterThan(0);

  // Stop: the listing's marks go, and the hook refuses to report a cost it never measured.
  await page.getByTestId('run-stop').click();
  await expect.poll(() => page.evaluate(() => document.getElementById('fg-running-line'))).toBeNull();
  await expect(page.evaluate(() => window.__fugloyTest!.frameCost(200))).rejects.toThrow(/counted no frames/);
});

test('a program opened from a file that is not the running one shows no marks, and F9 there says why', async ({ page }) => {
  await ready(page);
  // A program at $8000 from a file: LD B,2 / JR $-2.
  await page.evaluate(() => window.__fugloyTest!.load([0x01, 0x06, 0x00, 0x80, 0x06, 0x02, 0x18, 0xfc, 0x02, 0x02, 0x00, 0x80], 'other.cmd'));
  await page.getByRole('tab', { name: 'Source ✎' }).click();
  const content = page.locator('.cm-content');
  await expect(content).toBeVisible();
  await content.click();
  await page.keyboard.press('ControlOrMeta+a');
  // Clear first and let the editor settle: keys typed into its first edit's reactions can land out of place on a slow runner.
  await page.keyboard.press('Backspace');
  await expect(content).toHaveText('');
  await page.keyboard.type(PROGRAM);
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect.poll(() => page.evaluate(() => window.__fugloyTest!.debugMode())).toBe('running');
  await page.getByRole('tab', { name: 'Listing' }).click();
  await expect(page.getByTestId('file-name')).toHaveText('other.cmd');
  expect(await page.evaluate(() => window.__fugloyTest!.listingMarks())).toBeNull();
  expect(await page.evaluate(() => document.getElementById('fg-running-line'))).toBeNull();
  await row(page, 0x8000).click();
  await page.keyboard.press('F9');
  await expect(page.getByTestId('run-message')).toHaveText('This listing is not the program that is running. Set breakpoints in Source ✎.');
});

// The running line's cost per frame (Review Focus 1). A tight loop runs for 3 s with Source ✎ shown,
// so every frame reads the trace, maps it to lines and, when the set changes, dispatches to the
// editor. FUGLOY_PERF=1 holds it to a mean under 1 ms and a p95 under 2 ms, with no long task
// (over 50 ms) while it runs, as 5B's Run had none; without it the numbers are printed only.
const PERF = process.env.FUGLOY_PERF === '1';

test('a tight loop running for 3 s costs the running line under 1 ms a frame', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __longTasks: number[] };
    w.__longTasks = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__longTasks.push(e.duration);
    }).observe({ type: 'longtask', buffered: true });
  });
  await ready(page);
  await page.getByTestId('write-program').click();
  const content = page.locator('.cm-content');
  await expect(content).toContainText('ORG');
  await content.click();
  await page.keyboard.press('ControlOrMeta+a');
  // Clear first and let the editor settle: keys typed into its first edit's reactions can land out of place on a slow runner.
  await page.keyboard.press('Backspace');
  await expect(content).toHaveText('');
  await page.keyboard.type(PROGRAM);
  await page.getByTestId('run-run').click();
  await expect.poll(() => page.evaluate(() => window.__fugloyTest!.debugMode())).toBe('running');
  // Let the Run settle (its first frames load the kit's last parts), then measure from a clean slate.
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    (window as unknown as { __longTasks: number[] }).__longTasks = [];
  });
  const cost = await page.evaluate(() => window.__fugloyTest!.frameCost(3000));
  const longTasks = await page.evaluate(() => [...(window as unknown as { __longTasks: number[] }).__longTasks]);
  const report = `running line, tight loop for 3 s: ${cost.frames} frames, mean ${cost.mean.toFixed(3)} ms, p95 ${cost.p95.toFixed(3)} ms, max ${cost.max.toFixed(3)} ms; long tasks: ${longTasks.length}${longTasks.length > 0 ? ` (max ${Math.max(...longTasks).toFixed(1)} ms)` : ''}`;
  console.log(report);
  test.info().annotations.push({ type: 'perf', description: report });
  // About 60 frames a second; a background tab or a stall would show far fewer.
  expect(cost.frames).toBeGreaterThan(60);
  // The marks are live: Source ✎ shows the running line.
  await expect(page.locator('.cm-line.fg-run-now')).toHaveCount(1);
  if (PERF) {
    expect(cost.mean).toBeLessThan(1);
    expect(cost.p95).toBeLessThan(2);
    expect(longTasks.filter((d) => d > 50)).toEqual([]);
  }
  await page.getByTestId('run-stop').click();
});

test('axe is clean over Source ✎ while paused: the gutter ▶, a data line\'s hollow breakpoint, Screen text open, and the changed-source note', async ({ page }) => {
  await ready(page);
  await page.getByTestId('write-program').click();
  const content = page.locator('.cm-content');
  await expect(content).toContainText('ORG');
  await content.click();
  await page.keyboard.press('ControlOrMeta+a');
  // Clear first and let the editor settle: keys typed into its first edit's reactions can land out of place on a slow runner.
  await page.keyboard.press('Backspace');
  await expect(content).toHaveText('');
  // Line 4 DEC A takes a breakpoint; line 6 is data, so its breakpoint is hollow.
  await page.keyboard.type('\tORG\t7000H\nSTART:\tLD\tA,1\nLOOP:\tINC\tA\n\tDEC\tA\n\tJR\tLOOP\n\tDB\t0\n\tEND\tSTART\n');
  await page.locator('.cm-line').nth(3).click();
  await page.keyboard.press('F9');
  await page.locator('.cm-line').nth(5).click();
  await page.keyboard.press('F9');
  await expect(page.getByTestId('breakpoint-text')).toHaveCount(2);

  await page.getByTestId('run-run').click();
  await expect.poll(() => page.evaluate(() => window.__fugloyTest!.debugMode())).toBe('paused');
  await expect(page.getByTestId('run-message')).toHaveText('Paused at line 4, DEC A, at a breakpoint.');
  await expect(page.locator('#left-panel-source')).toBeVisible();
  await expect(page.locator('.cm-line.fg-run-paused')).toContainText('DEC');
  await expect(page.locator('.fg-bp-off')).toHaveCount(1);
  await page.getByTestId('screen-text-summary').click();
  await expect(page.getByTestId('screen-text-row')).toHaveCount(16);
  expect(await axe(page)).toEqual([]);

  // An edit while paused: the marks go and the note says why.
  await page.locator('.cm-line').nth(5).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' ; data');
  await expect(page.getByTestId('source-run-changed')).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.getByTestId('run-stop').click();
});
