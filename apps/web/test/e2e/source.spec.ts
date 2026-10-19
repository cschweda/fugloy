// Source ✎ in a browser against the generated site: CodeMirror loads only when
// the tab first opens, a typed error is marked and listed, its Fix applies,
// keys typed in the editor stay there, and axe is clean on the tab.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const open = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.waitForFunction(() => window.__fugloyTest !== undefined, undefined, { timeout: 30_000 });
  await page.getByTestId('open-sea-dragon').click();
  await expect(page.locator('.fg-row-cursor')).toHaveAttribute('data-addr', String(0x8881));
};

test('Source ✎ loads the editor on first open, marks a typed error, and fixes it in one click', async ({ page }) => {
  await open(page);
  // Nothing of CodeMirror before the tab opens.
  expect(await page.locator('.cm-editor').count()).toBe(0);
  await page.getByRole('tab', { name: 'Source ✎' }).click();
  const content = page.locator('.cm-content');
  await expect(content).toBeVisible();
  await expect(content).toContainText('ORG');
  await expect(page.getByTestId('source-diag-count')).toHaveText('No problems: the program assembles.');

  // Type a program with an 8080 spelling over the starter; the listing's keys (g, n, ;) must not fire.
  await content.click();
  await page.keyboard.press('ControlOrMeta+a');
  // Clear first and let the editor settle: keys typed into its first edit's reactions can land out of place on a slow runner.
  await page.keyboard.press('Backspace');
  await expect(content).toHaveText('');
  await page.keyboard.type('\tORG\t7000H\n');
  await page.keyboard.press('Home');
  await page.keyboard.type('\tPUSH\tA ; g n');
  await expect(page.getByTestId('goto-box')).toHaveCount(0);
  await expect(page.getByTestId('source-diag')).toHaveCount(1);
  await expect(page.getByTestId('source-diag')).toContainText('PUSH works on register pairs');
  await expect(page.locator('.cm-lintRange-error')).toHaveCount(1);

  const fix = page.getByTestId('source-diag-fix');
  await expect(fix).toHaveAccessibleName('Fix line 2: write PUSH AF');
  await fix.click();
  await expect(content).toContainText('PUSH AF ; g n');
  await expect(page.getByTestId('source-diag')).toHaveCount(0);

  // The focus is back in the editor, so one undo there takes the fix back (not the workbench's hint undo).
  await expect(content).toBeFocused();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('source-diag')).toHaveCount(1);

  // The listing's keys stay out of the whole Source panel, even on a plain button.
  await page.getByTestId('source-new').focus();
  await page.keyboard.press('g');
  await expect(page.getByTestId('goto-box')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Source ✎' })).toHaveAttribute('aria-selected', 'true');

  const r = await new AxeBuilder({ page }).include('#left-panel-source').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
});

test('the source survives a reload', async ({ page }) => {
  await open(page);
  await page.getByRole('tab', { name: 'Source ✎' }).click();
  const content = page.locator('.cm-content');
  await expect(content).toBeVisible();
  await content.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\n; kept across a reload');
  // The save follows 500 ms after typing stops.
  await page.waitForTimeout(1000);
  await page.reload();
  await page.waitForFunction(() => window.__fugloyTest !== undefined, undefined, { timeout: 30_000 });
  await page.getByTestId('open-sea-dragon').click();
  await page.getByRole('tab', { name: 'Source ✎' }).click();
  await expect(page.locator('.cm-content')).toContainText('; kept across a reload');
});

test('Tab types a tab in the editor; Esc then Tab leaves it; Download .z saves the source', async ({ page }) => {
  await open(page);
  await page.getByRole('tab', { name: 'Source ✎' }).click();
  const content = page.locator('.cm-content');
  await content.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('X');
  await page.keyboard.press('Tab');
  await expect(content).toBeFocused();
  expect(await content.innerText()).toBe('X\t');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  await expect(content).not.toBeFocused();
  // Focus moved on to the page, not into nowhere.
  expect(await page.evaluate(() => document.activeElement !== document.body && document.activeElement !== null)).toBe(true);
  const download = page.waitForEvent('download');
  await page.getByTestId('source-download').click();
  expect((await download).suggestedFilename()).toBe('clear-screen.z');
});

test('a Source chunk that cannot be fetched says so, and Retry loads it', async ({ page }) => {
  await open(page);
  // Every script fetched from now on fails: only the Source tab's chunk is still to come.
  await page.route('**/_nuxt/*.js', (route) => route.abort());
  await page.getByRole('tab', { name: 'Source ✎' }).click();
  await expect(page.getByTestId('source-load-error')).toContainText('The Source editor could not be loaded');
  await page.unroute('**/_nuxt/*.js');
  await page.getByTestId('source-load-retry').click();
  await expect(page.locator('.cm-content')).toBeVisible();
});
