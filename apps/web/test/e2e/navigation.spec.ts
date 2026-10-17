// The Symbol and Index tabs and listing navigation, in a browser against the generated site.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const open = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.waitForFunction(() => window.__fugloyTest !== undefined, undefined, { timeout: 30_000 });
  await page.getByTestId('open-sea-dragon').click();
  await expect(page.locator('.fg-row-cursor')).toHaveAttribute('data-addr', String(0x497f));
};

test('G goes to an address and Alt+Left comes back, Alt+Right returns', async ({ page }) => {
  await open(page);
  await page.keyboard.press('g');
  await expect(page.getByTestId('goto-input')).toBeFocused();
  await page.keyboard.type('$4B9E');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('goto-box')).toBeHidden();
  await expect(page.locator('.fg-row-cursor')).toHaveAttribute('data-addr', String(0x4b9e));
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.locator('.fg-row-cursor')).toHaveAttribute('data-addr', String(0x497f));
  await page.keyboard.press('Alt+ArrowRight');
  await expect(page.locator('.fg-row-cursor')).toHaveAttribute('data-addr', String(0x4b9e));
});

test('the G box refuses an unknown name inline, ignores workbench keys while typing, and Esc returns focus to the listing', async ({ page }) => {
  await open(page);
  await page.keyboard.press('g');
  // A g typed into the box is text, not a second "open the box".
  await page.keyboard.type('GAME');
  await expect(page.getByTestId('goto-input')).toHaveValue('GAME');
  await expect(page.getByTestId('goto-input')).toBeFocused();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.getByTestId('goto-input')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('goto-error')).toContainText('GAME');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('goto-box')).toBeHidden();
  await expect(page.locator('[data-testid="workbench"] [tabindex="0"]:focus')).toHaveCount(1);
  await expect(page.getByTestId('goto-input')).toHaveCount(0);
});

test('G to a label switches the right page to the Symbol tab', async ({ page }) => {
  await open(page);
  await page.keyboard.press('g');
  await page.keyboard.type('SUB_4B9E');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: 'Symbol' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('symbol-name')).toHaveText('SUB_4B9E');
});

test('workbench keys wait while a dialog is open', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const d = document.createElement('dialog');
    d.id = 'probe';
    document.body.append(d);
    d.show();
  });
  await page.keyboard.press('g');
  await expect(page.getByTestId('goto-box')).toHaveCount(0);
  await page.evaluate(() => document.getElementById('probe')!.remove());
  await page.keyboard.press('g');
  await expect(page.getByTestId('goto-box')).toBeVisible();
});

test('clicking a name in the listing opens it in the Symbol tab with its uses', async ({ page }) => {
  await open(page);
  // The port name on the IN/OUT at $499F.
  await page.locator(`.fg-row[data-addr="${0x499f}"] a.fg-follow`).first().click();
  await expect(page.getByRole('tab', { name: 'Symbol' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('symbol-name')).toBeVisible();
  await expect(page.getByTestId('uses-table')).toContainText('$499F');
  // The cursor did not move for a table name.
  await expect(page.locator('.fg-row-cursor')).toHaveAttribute('data-addr', String(0x497f));
});

test('the Index lists routines and filters them; a routine opens in the Symbol tab and moves the cursor', async ({ page }) => {
  await open(page);
  await page.getByRole('tab', { name: 'Index' }).click();
  await expect(page.getByTestId('index-routines')).toBeVisible();
  await page.getByTestId('index-filter').fill('4B9E');
  await page.getByTestId('index-routines').getByRole('button', { name: 'SUB_4B9E' }).click();
  await expect(page.getByTestId('symbol-name')).toHaveText('SUB_4B9E');
  await expect(page.locator('.fg-row-cursor')).toHaveAttribute('data-addr', String(0x4b9e));
});
