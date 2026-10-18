// The Explain tab, in a browser against the generated site: a click on a line
// opens it, arrow keys re-explain while it shows (and only then), previews and
// links move the cursor, a data row shows its region and picture, BASIC gets
// its note, and axe finds nothing.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

const open = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.waitForFunction(() => window.__fugloyTest !== undefined, undefined, { timeout: 30_000 });
  await page.getByTestId('open-sea-dragon').click();
  await expect(page.locator('.fg-row-cursor')).toHaveAttribute('data-addr', String(0x8881));
};

/** The instruction or data row at `addr`, scrolled into view. */
const row = async (page: Page, addr: number): Promise<Locator> => {
  await page.evaluate((a) => window.__fugloyTest!.scrollToAddr(a), addr);
  return page.locator(`.fg-row-code[data-addr="${addr}"], .fg-row-data[data-addr="${addr}"]`);
};

const cursorAt = (page: Page, addr: number): Promise<void> => expect(page.locator('.fg-row-cursor')).toHaveAttribute('data-addr', String(addr));

test('Explain is the first right tab and prompts before any click; Program stays open with the program', async ({ page }) => {
  await open(page);
  const tabs = page.getByRole('tablist', { name: 'Right page' }).getByRole('tab');
  await expect(tabs.first()).toHaveText('Explain');
  await expect(page.getByRole('tab', { name: 'Program' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Explain' }).click();
  await expect(page.getByTestId('explain-prompt')).toHaveText('Click a line to have it explained.');
});

test('a click on a line opens Explain on it, and ArrowDown re-explains the next line', async ({ page }) => {
  await open(page);
  await (await row(page, 0x49a7)).click();
  await expect(page.getByRole('tab', { name: 'Explain' })).toHaveAttribute('aria-selected', 'true');
  const panel = page.getByTestId('explain-panel');
  await expect(panel.getByTestId('explain-line')).toHaveText('49A7  DD 21 80 3F   LD IX,VIDEO+0380H');
  await expect(panel.getByTestId('explain-lead')).toContainText('row 14');
  await expect(panel.getByTestId('explain-details')).toHaveText('4 bytes · 14 T-states · flags unchanged');
  await expect(panel.getByTestId('explain-routine')).toContainText('L497F');
  await page.keyboard.press('ArrowDown');
  await cursorAt(page, 0x49ab);
  await expect(panel.getByTestId('explain-line')).toContainText('49AB');
  await expect(panel.getByTestId('explain-lead')).toContainText('into IY');
});

test('a table name in a sentence opens the Symbol tab; an address in one moves the cursor', async ({ page }) => {
  await open(page);
  await (await row(page, 0x49a7)).click();
  await page.getByTestId('explain-lead').getByRole('button', { name: 'VIDEO+0380H' }).click();
  await expect(page.getByTestId('symbol-name')).toHaveText('VIDEO');
  await page.getByRole('tab', { name: 'Explain' }).click();
  await page.keyboard.press('ArrowDown');
  await (await row(page, 0x49ab)).click();
  // "$628F (MAP_CHARS)": one link for the address, not two.
  await expect(page.getByTestId('explain-lead').getByRole('button')).toHaveText(['$628F']);
  await page.getByTestId('explain-lead').getByRole('button', { name: '$628F' }).click();
  await cursorAt(page, 0x628f);
  await expect(page.getByTestId('explain-line')).toContainText('628F');
});

test('with Program showing, ArrowDown moves the cursor and leaves Program showing', async ({ page }) => {
  await open(page);
  await (await row(page, 0x49a7)).click();
  await page.getByRole('tab', { name: 'Program' }).click();
  await page.locator('.fg-listing').focus();
  await page.keyboard.press('ArrowDown');
  await cursorAt(page, 0x49ab);
  await expect(page.getByRole('tab', { name: 'Program' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('program-panel')).toBeVisible();
  await expect(page.getByTestId('explain-panel')).toBeHidden();
});

test('a preview click moves the cursor to its address', async ({ page }) => {
  await open(page);
  await (await row(page, 0x49ab)).click();
  const preview = page.getByRole('button', { name: '$628F MAP_CHARS', exact: true });
  await expect(preview).toContainText('628F  83 87 8B 8C');
  await preview.click();
  await cursorAt(page, 0x628f);
});

test('a click on a label row explains the label line', async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.__fugloyTest!.scrollToAddr(0x49b1));
  await page.locator(`.fg-row-label[data-addr="${0x49b1}"]`).click();
  await expect(page.getByTestId('explain-lead')).toContainText('L49B1 was reached');
  await expect(page.getByTestId('explain-pattern')).toContainText('64 times');
});

test('a click on a label row shows who reaches the label, as links; a code row does not', async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.__fugloyTest!.scrollToAddr(0x54b4));
  await page.locator(`.fg-row-label[data-addr="${0x54b4}"]`).click();
  const label = page.getByTestId('explain-label');
  await expect(label).toContainText('L54B4');
  await expect(label).toContainText('Jumped to from $54BC.');
  await expect(page.getByTestId('explain-pattern')).toContainText('at most 20 times, leaving early at $54B8');
  await label.getByRole('button', { name: '$54BC' }).click();
  await cursorAt(page, 0x54bc);
  await expect(page.getByTestId('explain-label')).toHaveCount(0);
});

test('a click on a block-comment row says it is your block comment', async ({ page }) => {
  await open(page);
  const ex = (f: string): string => fileURLToPath(new URL(`../../../../examples/sea-dragon/${f}`, import.meta.url));
  const hints = `${readFileSync(ex('seadrg01.hints'), 'utf8')}block 0:$0000 note Sets up the game.\n`;
  await page.evaluate(({ bytes, hints }) => window.__fugloyTest!.load(bytes, 'seadrg01.cmd', hints), { bytes: Array.from(readFileSync(ex('seadrg01.cmd'))), hints });
  await page.evaluate(() => window.__fugloyTest!.scrollToAddr(0x497f));
  await page.locator('.fg-row-note', { hasText: 'Sets up the game.' }).click();
  await expect(page.getByTestId('explain-lead')).toHaveText('Your block comment for $497F, kept in the hint file; the program does not contain it.');
  // The cursor is on $497F; ArrowDown leaves the note for the next line.
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('explain-lead')).not.toContainText('block comment');
});

test('a data row shows its region, CAVERN_MAP (DATA_7399 before the hints named it), and a picture with width buttons', async ({ page }) => {
  await open(page);
  await (await row(page, 0x7dd5)).click();
  const region = page.getByTestId('explain-region');
  await expect(region).toContainText('CAVERN_MAP');
  await expect(region).toContainText('$7399–$7FFF');
  const canvas = region.getByTestId('region-canvas');
  await expect(canvas).toBeVisible();
  expect(await canvas.evaluate((c: HTMLCanvasElement) => c.style.width)).toBe(`${64 * 8}px`);
  await region.getByRole('button', { name: '32', exact: true }).click();
  await expect(region.getByRole('button', { name: '32', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await canvas.evaluate((c: HTMLCanvasElement) => c.style.width)).toBe(`${32 * 8}px`);
  await region.getByLabel('Other').fill('40');
  await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.style.width)).toBe(`${40 * 8}px`);
  // Out of range: clamped, and the field shows the width used once it is left.
  await region.getByLabel('Other').fill('3');
  await region.getByLabel('Other').blur();
  await expect(region.getByLabel('Other')).toHaveValue('8');
  expect(await canvas.evaluate((c: HTMLCanvasElement) => c.style.width)).toBe(`${8 * 8}px`);
  await expect(page.getByTestId('explain-lead')).toContainText('Press C to decode them as code');
});

test('the $888B LDIR says each fact once: one link per address, the pattern adds only what the lead lacks, routine facts fold away', async ({ page }) => {
  await open(page);
  await (await row(page, 0x888b)).click();
  const lead = page.getByTestId('explain-lead');
  await expect(lead).toContainText('Copy $3681 (13,953) bytes from $5200 (L5200) to $497F (L497F)');
  await expect(lead.getByRole('button')).toHaveText(['$5200', '$497F']);
  const pattern = page.getByTestId('explain-pattern');
  await expect(pattern).toHaveText(/This moves the program to where it runs\./);
  await expect(pattern).not.toContainText('Copies');
  const routine = page.getByTestId('explain-routine');
  await expect(routine).toContainText('It ends by jumping on to L497F.');
  const more = routine.getByTestId('explain-routine-more');
  await expect(more.getByText('It copies 13,953 bytes')).toBeHidden();
  await more.getByText('More about this routine').click();
  await expect(more.getByText('It copies 13,953 bytes', { exact: false })).toBeVisible();
  // One line up, inside the copy's setup, the pattern shows in full.
  await page.locator('.fg-listing').focus();
  await page.keyboard.press('ArrowUp');
  await cursorAt(page, 0x8888);
  await expect(page.getByTestId('explain-pattern')).toContainText('Copies 13,953 bytes');
});

test('a shift-click extends the selection and does not open Explain', async ({ page }) => {
  await open(page);
  await (await row(page, 0x49a7)).click({ modifiers: ['Shift'] });
  await expect(page.getByRole('tab', { name: 'Program' })).toHaveAttribute('aria-selected', 'true');
});

test('a .BAS program gets the BASIC note', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__fugloyTest !== undefined, undefined, { timeout: 30_000 });
  const bytes = readFileSync(fileURLToPath(new URL('../../../../fixtures/synthetic/bas/prog-7000.bas', import.meta.url)));
  await page.getByTestId('file-input').setInputFiles({ name: 'prog.bas', mimeType: 'application/octet-stream', buffer: bytes });
  await expect(page.getByTestId('workbench')).toBeVisible();
  await page.locator('.fg-row-basic').first().click();
  await expect(page.getByRole('tab', { name: 'Explain' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('explain-lead')).toHaveText('Explain covers machine code; BASIC comes later.');
});

test('axe finds nothing on the Explain tab, for a code line and a data row', async ({ page }) => {
  await open(page);
  const violations = async (): Promise<string[]> => {
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
    return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
  };
  await (await row(page, 0x888b)).click();
  await expect(page.getByTestId('explain-pattern')).toContainText('moves the program');
  expect(await violations()).toEqual([]);
  await (await row(page, 0x7dd5)).click();
  await expect(page.getByTestId('region-canvas')).toBeVisible();
  expect(await violations()).toEqual([]);
});
