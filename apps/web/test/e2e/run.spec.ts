// Run ▶ in a browser against the generated site, with no ROM: the user's own case (open the
// site, Write a program, press Run, and the screen is blank), Ctrl/⌘+Enter from the editor,
// errors sent to Source ✎, a quiet listing refresh, no request past the site's own origin, and
// axe clean on the Run tab.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const ORIGIN = 'http://localhost:4173';
const BG = [0x10, 0x12, 0x10, 0xff];

const ready = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.waitForFunction(() => window.__fugloyTest !== undefined, undefined, { timeout: 30_000 });
};

/** The canvas's centre pixel, RGBA. */
const centre = (page: Page): Promise<number[]> =>
  page.getByTestId('trs-canvas').evaluate((c: HTMLCanvasElement) => Array.from(c.getContext('2d')!.getImageData(c.width >> 1, c.height >> 1, 1, 1).data));

test('open the site, Write a program, press Run: the screen is blank, with no ROM and no request past the site', async ({ page }) => {
  const outside: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith(ORIGIN) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) outside.push(r.url());
  });
  await ready(page);
  // Nothing of the emulator before Run is opened.
  await page.getByTestId('write-program').click();
  await expect(page.locator('.cm-content')).toContainText('ORG');
  await expect(page.getByRole('tab', { name: 'Run ▶' })).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('run-run').click();
  await expect(page.getByTestId('run-message')).toHaveText("Running on Fugløy's stub ROM (no ROM needed for this program)");
  await expect.poll(() => page.evaluate(() => window.__fugloyTest!.runnerState())).toBe('running');
  const text = await page.evaluate(() => window.__fugloyTest!.screenText());
  expect(text).toHaveLength(16);
  for (const row of text) expect(row).toMatch(/^ {64}$/);
  await expect.poll(() => centre(page)).toEqual(BG);
  // Run doesn't move the focus; the screen says how to type to it.
  await expect(page.getByTestId('run-run')).toBeFocused();
  await expect(page.getByTestId('trs-screen')).toContainText('Click the screen to type to the TRS-80');
  // The listing refreshed quietly: the program is open, and Source ✎ is still the left tab.
  await expect(page.getByTestId('file-name')).toHaveText('clear-screen.cmd');
  await expect(page.getByRole('tab', { name: 'Source ✎' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('saved-work-dialog')).not.toBeVisible();
  expect(outside).toEqual([]);

  const r = await new AxeBuilder({ page }).include('#right-panel-run').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
});

test('Ctrl/⌘+Enter in the editor runs; an error goes to Source ✎ and runs nothing; a ROM call is refused with its line', async ({ page }) => {
  await ready(page);
  await page.getByTestId('write-program').click();
  const content = page.locator('.cm-content');
  await expect(content).toContainText('ORG');
  await content.click();
  const lines = await page.locator('.cm-line').count();
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByTestId('run-message')).toHaveText("Running on Fugløy's stub ROM (no ROM needed for this program)");
  // No line was inserted.
  expect(await page.locator('.cm-line').count()).toBe(lines);

  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('\tORG\t7000H\nSTART:\tLDA\n\tEND\tSTART\n');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByTestId('run-message')).toContainText('The program has 1 error, so it did not run. The first is on line 2');
  await expect(page.getByTestId('source-diag')).toHaveCount(1);
  await expect(content).toBeFocused();
  expect(await page.evaluate(() => window.__fugloyTest!.runnerState())).toBe('idle');

  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('\tORG\t7000H\nSTART:\tCALL\t$VDCLS\nWAIT:\tJR\tWAIT\n\tEND\tSTART\n');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByTestId('run-message')).toContainText("Line 2 calls $VDCLS, the ROM's routine at $01C9");
  expect(await page.evaluate(() => window.__fugloyTest!.runnerState())).toBe('idle');
});

test('keys reach the TRS-80 only while its screen has focus, and Tab leaves it', async ({ page }) => {
  await ready(page);
  await page.getByTestId('write-program').click();
  await expect(page.locator('.cm-content')).toContainText('ORG');
  await page.evaluate(() => window.__fugloyTest!.run());
  const screen = page.getByTestId('trs-screen');
  await screen.click();
  await expect(screen).toBeFocused();
  await expect(screen).not.toContainText('Click the screen');
  await page.keyboard.press('Tab');
  await expect(screen).not.toBeFocused();
  // Ctrl/⌘+Enter on the screen restarts the program.
  await screen.click();
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect.poll(() => page.evaluate(() => window.__fugloyTest!.runnerState())).toBe('running');
});

test('a program opened from a file is never replaced by a Run, until Show in Listing', async ({ page }) => {
  await ready(page);
  await page.getByTestId('open-sea-dragon').click();
  await expect(page.getByTestId('file-name')).toHaveText('seadrg01.cmd');
  await page.getByRole('tab', { name: 'Source ✎' }).click();
  await expect(page.locator('.cm-content')).toContainText('ORG');
  await page.getByRole('tab', { name: 'Run ▶' }).click();
  await page.getByTestId('run-run').click();
  await expect.poll(() => page.evaluate(() => window.__fugloyTest!.runnerState())).toBe('running');
  await expect(page.getByTestId('file-name')).toHaveText('seadrg01.cmd');
  await page.getByTestId('run-show-listing').click();
  await expect(page.getByTestId('file-name')).toHaveText('clear-screen.cmd');
  await expect(page.getByRole('tab', { name: 'Listing' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('save-state')).toHaveText('not saved (assembled from your source)');
});

test('Ctrl/⌘+Enter in the listing runs and refreshes it in place, keeping the focus there; inside the inline editor it runs nothing', async ({ page }) => {
  await ready(page);
  await page.getByTestId('write-program').click();
  await expect(page.locator('.cm-content')).toContainText('ORG');
  await page.evaluate(() => window.__fugloyTest!.run());
  await expect(page.getByTestId('file-name')).toHaveText('clear-screen.cmd');
  await page.getByRole('tab', { name: 'Listing' }).click();
  const row = page.locator('.fg-row-code').first();
  const inListing = (): Promise<boolean> => page.evaluate(() => document.activeElement?.closest('.fg-listing') != null);
  await page.getByTestId('run-stop').click();
  await row.click();
  expect(await inListing()).toBe(true);
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect.poll(() => page.evaluate(() => window.__fugloyTest!.runnerState())).toBe('running');
  expect(await inListing()).toBe(true);
  await expect(page.getByRole('tab', { name: 'Listing' })).toHaveAttribute('aria-selected', 'true');

  // In the inline editor (N), Ctrl/⌘+Enter runs nothing and the editor stays open.
  await page.getByTestId('run-stop').click();
  await row.click();
  await page.keyboard.press('n');
  await expect(page.getByTestId('inline-edit-input')).toBeFocused();
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByTestId('inline-edit-input')).toBeFocused();
  expect(await page.evaluate(() => window.__fugloyTest!.runnerState())).toBe('stopped');
});

test('leaving the workbench for another page stops the program', async ({ page }) => {
  await ready(page);
  await page.getByTestId('write-program').click();
  await expect(page.locator('.cm-content')).toContainText('ORG');
  await page.evaluate(() => window.__fugloyTest!.run());
  await expect.poll(() => page.evaluate(() => window.__fugloyTest!.runnerState())).toBe('running');
  await page.getByRole('link', { name: 'About' }).click();
  await expect(page).toHaveURL(/\/about\/$/);
  await page.goBack();
  await page.waitForFunction(() => window.__fugloyTest !== undefined);
  expect(await page.evaluate(() => window.__fugloyTest!.runnerState())).toBe('stopped');
});
