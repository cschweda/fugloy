// Saving in the browser: hints and settings in IndexedDB, hint-file drop, Back up and Restore.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const HASH = '8fa50e79d9f699e23f5daf41c654fc82c288e4df8816d5aaebd709bce43ed2af';
const seaHints = readFileSync(fileURLToPath(new URL('../../../../examples/sea-dragon/seadrg01.hints', import.meta.url)), 'utf8');

const ready = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.waitForFunction(() => window.__fugloyTest !== undefined, undefined, { timeout: 30_000 });
};
const openSea = async (page: Page): Promise<void> => {
  await ready(page);
  await page.getByTestId('open-sea-dragon').click();
  await expect(page.locator('.fg-row-cursor')).toHaveAttribute('data-addr', String(0x8881));
};
const saveState = (page: Page) => page.getByTestId('save-state');
const rename = async (page: Page, name: string): Promise<void> => {
  await page.keyboard.press('g');
  await page.keyboard.type('$4B9E');
  await page.keyboard.press('Enter');
  await expect(page.locator('.fg-row-cursor')).toHaveAttribute('data-addr', String(0x4b9e));
  await page.keyboard.press('n');
  await page.getByTestId('inline-edit-input').fill(name);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('inline-edit')).toHaveCount(0);
};
const hintText = async (page: Page): Promise<string> => {
  await page.getByRole('tab', { name: 'Hints' }).click();
  const text = await page.getByTestId('hint-text').innerText();
  await page.getByRole('tab', { name: 'Listing' }).click();
  return text;
};
const dropFile = (page: Page, name: string, text: string): Promise<void> =>
  page.evaluate(
    ({ name, text }) => {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File([text], name));
      document.body.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
    },
    { name, text },
  );

test('a rename survives a reload, and the status line says saved', async ({ page }) => {
  await openSea(page);
  await rename(page, 'INIT');
  await expect(saveState(page)).toHaveText('saved');
  await page.reload();
  await page.waitForFunction(() => window.__fugloyTest !== undefined, undefined, { timeout: 30_000 });
  await page.getByTestId('open-sea-dragon').click();
  await expect(saveState(page)).toHaveText('saved');
  expect(await hintText(page)).toContain('block 0:$021F name INIT');
});

test('with no IndexedDB the workbench still opens and edits, and says it is not saved', async ({ page }) => {
  await page.addInitScript(() => {
    // @ts-expect-error simulating a private window
    delete window.indexedDB;
  });
  await openSea(page);
  await rename(page, 'INIT');
  await expect(saveState(page)).toHaveText('not saved (storage unavailable)');
  expect(await hintText(page)).toContain('name INIT');
});

test('a dropped hint file, told by content, goes to the open program; another program\'s is refused', async ({ page }) => {
  await openSea(page);
  await dropFile(page, 'notes.txt', `${seaHints.trimEnd()}\nblock 0:$021F name DROPPED\n`);
  await expect(page.getByTestId('hints-tab')).toBeVisible();
  expect(await page.getByTestId('hint-text').innerText()).toContain('name DROPPED');
  await expect(saveState(page)).toHaveText('saved');
  const other = seaHints.replace(/block 0 length \$3690 hash [0-9a-f]+/, 'block 0 length $3690 hash 0000000000000000');
  await dropFile(page, 'other.hints', other);
  await expect(page.getByTestId('edit-message')).toHaveText('these hints are for another program (no block matched)');
});

test('a hint file dropped with no program open asks for the program first', async ({ page }) => {
  await ready(page);
  await page.getByTestId('file-input').setInputFiles({ name: 'x.hints', mimeType: 'text/plain', buffer: Buffer.from(seaHints) });
  await expect(page.getByTestId('open-error')).toContainText('Open the program it belongs to first');
});

test('Back up downloads the work, and Restore asks before replacing a program', async ({ page }) => {
  await openSea(page);
  await rename(page, 'INIT');
  await expect(saveState(page)).toHaveText('saved');
  await page.getByTestId('backup-summary').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('backup-save').click()]);
  const backup = JSON.parse(readFileSync((await download.path())!, 'utf8'));
  expect(backup.fugloyBackup).toBe(1);
  expect(backup.programs).toHaveLength(1);
  expect(backup.programs[0].hash).toBe(HASH);
  expect(backup.programs[0].hints).toContain('name INIT');

  // A backup carrying different hints for the same program.
  backup.programs[0].hints = seaHints;
  await page.getByTestId('backup-summary').click();
  await page.getByTestId('backup-file').setInputFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  const dialog = page.getByTestId('backup-confirm');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('seadrg01.hints');
  await dialog.getByRole('button', { name: 'Replace' }).click();
  await expect(page.getByTestId('backup-message')).toContainText('1 replaced');
  expect(await hintText(page)).not.toContain('name INIT');
});
