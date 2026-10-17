// The v1 done-criterion (docs/Fugloy-Project-Plan.md): asylum16, a copyrighted
// Model I game, opened in the browser with its committed hint file, read under
// Model I with the ROM calls named, annotated, and saved. The program lives in
// gitignored sample folders (fixtures/real/ today, or sample/), found the way
// packages/disasm/test/real/samples.ts finds it; without it the test skips, so
// CI and a clean worktree pass.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));

/** Full path of a sample program by basename, searched in the gitignored sample folders, or null. */
function resolveSample(name: string): string | null {
  const find = (dir: string): string | null => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      const hit = statSync(path).isDirectory() ? find(path) : entry === name ? path : null;
      if (hit !== null) return hit;
    }
    return null;
  };
  for (const root of ['sample', 'fixtures/real'].map((d) => join(repo, d))) {
    if (!existsSync(root)) continue;
    const hit = find(root);
    if (hit !== null) return hit;
  }
  return null;
}

const ASYLUM = resolveSample('asylum16.cmd');
const HINTS = join(repo, 'fixtures/hints/asylum16.hints');

const ready = (page: Page): Promise<unknown> => page.waitForFunction(() => window.__fugloyTest !== undefined, undefined, { timeout: 30_000 });
const openAsylum = (page: Page): Promise<void> =>
  page.getByTestId('file-input').setInputFiles({ name: 'asylum16.cmd', mimeType: 'application/octet-stream', buffer: readFileSync(ASYLUM!) });
/** The instruction row at `addr`, scrolled into view. */
const row = async (page: Page, addr: number): Promise<Locator> => {
  await page.evaluate((a) => window.__fugloyTest!.scrollToAddr(a), addr);
  return page.locator(`.fg-row-code[data-addr="${addr}"]`);
};
const hintText = async (page: Page): Promise<string> => {
  await page.getByRole('tab', { name: 'Hints' }).click();
  const text = await page.getByTestId('hint-text').innerText();
  await page.getByRole('tab', { name: 'Listing' }).click();
  return text;
};

test('asylum16 opens with its hints under Model I, names its ROM calls, and keeps a rename and a comment across a reload', async ({ page }) => {
  test.skip(ASYLUM === null, 'asylum16.cmd is not here (sample/ and fixtures/real/ are gitignored)');
  await page.goto('/');
  await ready(page);

  // Open the program, then drop its hint file on the listing (told apart by content), then pick Model I.
  await openAsylum(page);
  await expect(page.getByTestId('file-name')).toHaveText('asylum16.cmd');
  await page.evaluate((text) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File([text], 'asylum16.hints'));
    document.querySelector('.fg-listing')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
  }, readFileSync(HINTS, 'utf8'));
  await expect(page.getByTestId('hints-tab')).toBeVisible();
  expect(await page.getByTestId('hint-text').innerText()).toContain('block 0:$0000 name LOADER');
  await page.getByRole('tab', { name: 'Listing' }).click();
  await page.getByTestId('machine-picker').selectOption('1');
  await expect(page.getByTestId('status-line')).toContainText('Model I · LDOS 5.1');

  // The ROM calls are named from the Model I table, the cassette routines included.
  await expect(await row(page, 0x53dd)).toContainText('CALL $KBCHAR');
  await expect(await row(page, 0x53fe)).toContainText('CALL $CSHIN');
  await expect(await row(page, 0x5408)).toContainText('CALL $CSOFF');

  // Rename the routine at $53F8 from the keyboard; its caller at $43CB reads the new name.
  await expect(await row(page, 0x43cb)).toContainText('CALL SUB_53F8');
  await page.keyboard.press('g');
  await page.keyboard.type('$53F8');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('status-line')).toContainText('cursor $53F8');
  await page.keyboard.press('n');
  await page.getByTestId('inline-edit-input').fill('TAPE_LOAD');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('inline-edit')).toHaveCount(0);
  await expect(await row(page, 0x43cb)).toContainText('CALL TAPE_LOAD');
  // And comment it: the cursor is still on $53F8.
  await page.keyboard.press(';');
  await page.getByTestId('inline-edit-input').fill('read a saved game from tape');
  await page.keyboard.press('Enter');
  await expect(await row(page, 0x53f8)).toContainText('; read a saved game from tape');
  await expect(page.getByTestId('save-state')).toHaveText('saved');

  // Reload and open the same file again: the rename, the hints, and Model I are all kept.
  await page.reload();
  await ready(page);
  await openAsylum(page);
  await expect(page.getByTestId('file-name')).toHaveText('asylum16.cmd');
  await expect(page.getByTestId('save-state')).toHaveText('saved');
  await expect(page.getByTestId('machine-picker')).toHaveValue('1');
  await expect(await row(page, 0x43cb)).toContainText('CALL TAPE_LOAD');
  await expect(await row(page, 0x53f8)).toContainText('; read a saved game from tape');
  await expect(await row(page, 0x53fe)).toContainText('CALL $CSHIN');
  const hints = await hintText(page);
  expect(hints).toContain('name TAPE_LOAD');
  expect(hints).toContain('comment read a saved game from tape');
  expect(hints).toContain('block 0:$0000 name LOADER');
});
