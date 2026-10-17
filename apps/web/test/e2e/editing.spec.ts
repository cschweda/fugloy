// Editing the listing from the keyboard and the right-click menu, in a browser against the generated site.
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

const open = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.waitForFunction(() => window.__fugloyTest !== undefined, undefined, { timeout: 30_000 });
  await page.getByTestId('open-sea-dragon').click();
  await expect(page.locator('.fg-row-cursor')).toHaveAttribute('data-addr', String(0x8881));
};

/** Puts the cursor on `addr` with the G box, as a user would. */
const goTo = async (page: Page, addr: number): Promise<void> => {
  await page.keyboard.press('g');
  await page.keyboard.type(`$${addr.toString(16).toUpperCase()}`);
  await page.keyboard.press('Enter');
  await expect(page.locator('.fg-row-cursor')).toHaveAttribute('data-addr', String(addr));
};

/** The instruction or data row at `addr`, scrolled into view. */
const row = async (page: Page, addr: number): Promise<Locator> => {
  await page.evaluate((a) => window.__fugloyTest!.scrollToAddr(a), addr);
  return page.locator(`.fg-row-code[data-addr="${addr}"], .fg-row-data[data-addr="${addr}"]`);
};

/** The hint file the Hints tab shows; leaves the Listing tab showing. */
const hintText = async (page: Page): Promise<string> => {
  await page.getByRole('tab', { name: 'Hints' }).click();
  const text = await page.getByTestId('hint-text').innerText();
  await page.getByRole('tab', { name: 'Listing' }).click();
  return text;
};

test('N renames the label under the cursor and every use reads the new name', async ({ page }) => {
  await open(page);
  await goTo(page, 0x4b9e);
  await page.keyboard.press('n');
  const input = page.getByTestId('inline-edit-input');
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('placeholder', 'a name for SUB_4B9E');
  await input.fill('INIT');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('inline-edit')).toHaveCount(0);
  await expect(page.getByTestId('status-line')).toContainText('cursor $4B9E');
  await expect(await row(page, 0x499a)).toContainText('CALL INIT');
  expect(await hintText(page)).toContain('block 0:$021F name INIT');
});

test('; writes a comment on the cursor row', async ({ page }) => {
  await open(page);
  await goTo(page, 0x4b9e);
  await page.keyboard.press(';');
  await page.getByTestId('inline-edit-input').fill('clear the screen');
  await page.keyboard.press('Enter');
  await expect(await row(page, 0x4b9e)).toContainText('; clear the screen');
  expect(await hintText(page)).toContain('block 0:$021F comment clear the screen');
});

test('D marks the cursor row as bytes, and undo and redo walk the hint file back and forth', async ({ page }) => {
  await open(page);
  const original = await hintText(page);
  await goTo(page, 0x4b9e);
  await page.locator('.fg-listing').focus();
  await page.keyboard.press('d');
  await expect(await row(page, 0x4b9e)).toHaveClass(/fg-row-data/);
  await expect(await row(page, 0x4b9e)).toContainText('DB');
  expect(await hintText(page)).toContain('block 0:$021F bytes $0003');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(await row(page, 0x4b9e)).toHaveClass(/fg-row-code/);
  await expect(await row(page, 0x4b9e)).toContainText('LD HL,VIDEO');
  expect(await hintText(page)).toBe(original);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(await row(page, 0x4b9e)).toHaveClass(/fg-row-data/);
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('Control+y');
  await expect(await row(page, 0x4b9e)).toHaveClass(/fg-row-data/);
});

test('Shift+Down selects rows, and W marks the whole selection as words', async ({ page }) => {
  await open(page);
  await goTo(page, 0x4b9e);
  await page.keyboard.press('Shift+ArrowDown');
  await expect(page.locator('.fg-row-code.fg-row-selected')).toHaveCount(2);
  await page.keyboard.press('w');
  // LD HL,VIDEO (3 bytes) and the next instruction become one run of words.
  expect(await hintText(page)).toMatch(/block 0:\$021F words \$000[4-7]/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.fg-row-code.fg-row-selected')).toHaveCount(0);
});

test('the right-click menu offers the editing actions with their keys, and the keyboard opens it too', async ({ page }) => {
  await open(page);
  const target = await row(page, 0x4b9e);
  await target.click({ button: 'right' });
  const menu = page.getByTestId('row-menu');
  await expect(menu).toBeVisible();
  await expect(page.locator('.fg-row-cursor')).toHaveAttribute('data-addr', String(0x4b9e));
  for (const [label, key] of [['Code', 'C'], ['Bytes', 'D'], ['Words', 'W'], ['String', 'S'], ['Jump table', 'T'], ['Rename…', 'N'], ['Comment…', ';']]) {
    await expect(menu.getByRole('menuitem', { name: `${label} ${key}` })).toBeVisible();
  }
  await expect(menu.getByRole('menuitem', { name: /^Undo/ })).toBeDisabled();
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await menu.getByRole('menuitem', { name: /^String/ }).click();
  await expect(menu).toHaveCount(0);
  expect(await hintText(page)).toContain('block 0:$021F string');
  // From the keyboard: Shift+F10 on the listing, arrows and Enter pick, Esc closes and gives focus back.
  await page.locator('.fg-listing').focus();
  await page.keyboard.press('Shift+F10');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(page.locator('.fg-listing')).toBeFocused();
  await page.keyboard.press('Shift+F10');
  await page.keyboard.press('n');
  await expect(page.getByTestId('inline-edit-input')).toBeFocused();
});

test('an invalid rename is refused inline and leaves the hint file as it was', async ({ page }) => {
  await open(page);
  const before = await hintText(page);
  await goTo(page, 0x4b9e);
  await page.keyboard.press('n');
  const input = page.getByTestId('inline-edit-input');
  for (const [name, reason] of [
    ['LD', 'reserved'],
    ['L1234', 'generated label'],
    ['MODEPORT', 'MODEPORT is a ROM/hardware name; choose another'],
  ]) {
    await input.fill(name!);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('inline-edit-error')).toContainText(reason!);
    await expect(input).toHaveAttribute('aria-invalid', 'true');
  }
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('inline-edit')).toHaveCount(0);
  await expect(page.locator('.fg-listing')).toBeFocused();
  expect(await hintText(page)).toBe(before);
});

test('the keyboard stays on the listing: links are not tab stops, arrows move the cursor, Enter follows', async ({ page }) => {
  await open(page);
  const listing = page.locator('.fg-listing');
  await expect(page.locator('.fg-listing a.fg-follow').first()).toHaveAttribute('tabindex', '-1');
  const active = await listing.getAttribute('aria-activedescendant');
  expect(active).toBe(await page.locator('.fg-row-cursor').getAttribute('id'));
  await goTo(page, 0x499a);
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.fg-row-cursor')).toHaveAttribute('data-addr', String(0x499d));
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.fg-row-cursor')).toHaveAttribute('data-addr', String(0x499a));
  // CALL SUB_4B9E: Enter follows it, Alt+Left comes back.
  await page.keyboard.press('Enter');
  await expect(page.locator('.fg-row-cursor')).toHaveAttribute('data-addr', String(0x4b9e));
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.locator('.fg-row-cursor')).toHaveAttribute('data-addr', String(0x499a));
  // Shift-click selects rows without selecting text.
  await (await row(page, 0x499f)).click({ modifiers: ['Shift'] });
  await expect(page.locator('.fg-row-code.fg-row-selected')).toHaveCount(3);
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
});
