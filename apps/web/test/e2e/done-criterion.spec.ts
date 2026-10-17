// The phase 4 workbench, read as one story against the generated site: open
// Sea Dragon, rename and comment from the keyboard, reload and find the work
// saved, export it and check the exports against the CLI and the loader, drop
// a file that is not a program, and undo. The steps follow the phase 4 plan's
// Task 18, except that step 10 (undo both edits) runs before the reload: the
// edit history is per page session, so a reload starts a new one (the saved
// hint file survives it). After the exports, undo is checked again in the
// reloaded page's own history.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Download, Locator, Page } from '@playwright/test';
import { run } from '@fugloy/cli';
import { loadCmd } from '@fugloy/disasm';

const SEADRG01 = fileURLToPath(new URL('../../../../examples/sea-dragon/seadrg01.cmd', import.meta.url));

const ready = async (page: Page): Promise<void> => {
  await page.waitForFunction(() => window.__fugloyTest !== undefined, undefined, { timeout: 30_000 });
};
const cursor = (page: Page): Locator => page.locator('.fg-row-cursor');
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
const exportAs = async (page: Page, kind: string): Promise<Download> => {
  await page.getByTestId('export-summary').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId(`export-${kind}`).click()]);
  return download;
};

/** What `pnpm fugloy <file> --hints <hints> --format zmac` prints, through `@fugloy/cli`'s `run`. */
async function cliZmac(file: string, hints: string): Promise<string> {
  let out = '';
  let err = '';
  const code = await run([file, '--hints', hints, '--format', 'zmac'], {
    stdout: (t) => (out += t),
    stderr: (t) => (err += t),
    readFile: async (p) => new Uint8Array(readFileSync(p)),
    writeFile: async () => {
      throw new Error('the CLI should not write a file here');
    },
    fileExists: async () => false,
  });
  expect(err).toBe('');
  expect(code).toBe(0);
  return out;
}

test('the v1 workbench story: open, edit, save, reload, export, drop, undo', async ({ page }) => {
  // 1. The first screen offers the four bundled games.
  await page.goto('/');
  await ready(page);
  for (const id of ['sea-dragon', 'rear-guard', 'eliminator', 'armored-patrol']) await expect(page.getByTestId(`open-${id}`)).toBeVisible();

  // 2. One click opens Sea Dragon as a Model III program, with its labels.
  await page.getByTestId('open-sea-dragon').click();
  await expect(cursor(page)).toHaveAttribute('data-addr', String(0x8881));
  await page.evaluate(() => window.__fugloyTest!.scrollToAddr(0x497f));
  await expect(page.locator(`.fg-row-label[data-addr="${0x497f}"]`)).toHaveText(/L497F:/);
  await expect(page.getByTestId('program-panel')).toContainText('Model III');

  // 3. G goes to an address.
  await page.keyboard.press('g');
  await page.keyboard.type('4B9E');
  await page.keyboard.press('Enter');
  await expect(cursor(page)).toHaveAttribute('data-addr', String(0x4b9e));

  // 4. N names it, and its caller reads the name.
  await page.keyboard.press('n');
  await page.getByTestId('inline-edit-input').fill('INIT');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('inline-edit')).toHaveCount(0);
  await expect(await row(page, 0x499a)).toContainText('CALL INIT');

  // 5. ; comments the cursor row (still $4B9E: scrolling does not move the cursor).
  await expect(page.getByTestId('status-line')).toContainText('cursor $4B9E');
  await page.keyboard.press(';');
  await page.getByTestId('inline-edit-input').fill('set up the screen');
  await page.keyboard.press('Enter');
  await expect(await row(page, 0x4b9e)).toContainText('; set up the screen');
  await expect(page.getByTestId('save-state')).toHaveText('saved');

  // 10. ⌘Z twice undoes both edits (and redo puts them back, for the rest of the story).
  const edited = await hintText(page);
  await page.locator('.fg-listing').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(await row(page, 0x499a)).toContainText('CALL SUB_4B9E');
  await expect(await row(page, 0x4b9e)).not.toContainText('set up the screen');
  const undone = await hintText(page);
  expect(undone).not.toContain('name INIT');
  expect(undone).not.toContain('set up the screen');
  await page.locator('.fg-listing').focus();
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(await row(page, 0x499a)).toContainText('CALL INIT');
  expect(await hintText(page)).toBe(edited);
  await expect(page.getByTestId('save-state')).toHaveText('saved');

  // 6. A reload keeps both edits, and the status line says they are saved.
  await page.reload();
  await ready(page);
  await page.getByTestId('open-sea-dragon').click();
  await expect(page.getByTestId('save-state')).toHaveText('saved');
  await expect(await row(page, 0x499a)).toContainText('CALL INIT');
  await expect(await row(page, 0x4b9e)).toContainText('; set up the screen');
  expect(await hintText(page)).toBe(edited);

  // 7. The zmac download is what the CLI prints for the same program and the downloaded hint file.
  const dir = mkdtempSync(join(tmpdir(), 'fugloy-done-'));
  try {
    const hints = await exportAs(page, 'hints');
    expect(hints.suggestedFilename()).toBe('seadrg01.hints');
    const hintsPath = join(dir, 'seadrg01.hints');
    writeFileSync(hintsPath, readFileSync((await hints.path())!));
    expect(readFileSync(hintsPath, 'utf8')).toContain('name INIT');
    const zmac = await exportAs(page, 'zmac');
    expect(zmac.suggestedFilename()).toBe('seadrg01.z80');
    const text = readFileSync((await zmac.path())!, 'utf8');
    expect(text).toContain('CALL\tINIT');
    expect(text).toBe(await cliZmac(SEADRG01, hintsPath));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // 8. The .CMD download loads back to seadrg01's image and entry.
  const cmd = await exportAs(page, 'cmd');
  expect(cmd.suggestedFilename()).toBe('seadrg01.cmd');
  const exported = loadCmd(new Uint8Array(readFileSync((await cmd.path())!)));
  const original = loadCmd(new Uint8Array(readFileSync(SEADRG01)));
  expect(exported.warnings).toEqual([]);
  expect(exported.entry).toBe(original.entry);
  expect(Buffer.from(exported.image.loaded).equals(Buffer.from(original.image.loaded))).toBe(true);
  expect(Buffer.from(exported.image.bytes).equals(Buffer.from(original.image.bytes))).toBe(true);

  // Undo after the exports. The reloaded page has a history of its own, and exports are not edits:
  // ⌘Z leaves the saved work as it is. A new edit then undoes and redoes as one step.
  await page.locator('.fg-listing').focus();
  await page.keyboard.press('ControlOrMeta+z');
  expect(await hintText(page)).toBe(edited);
  await page.keyboard.press('g');
  await page.keyboard.type('499A');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('status-line')).toContainText('cursor $499A');
  await page.keyboard.press(';');
  await page.getByTestId('inline-edit-input').fill('calls INIT');
  await page.keyboard.press('Enter');
  await expect(await row(page, 0x499a)).toContainText('; calls INIT');
  await page.locator('.fg-listing').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(await row(page, 0x499a)).not.toContainText('calls INIT');
  expect(await hintText(page)).toBe(edited);
  await page.locator('.fg-listing').focus();
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(await row(page, 0x499a)).toContainText('; calls INIT');

  // 9. A JPEG dropped on the workbench is not a program, and the open one stays.
  await page.evaluate(() => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00])], 'photo.jpg'));
    document.querySelector('.fg-listing')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
  });
  await expect(page.getByTestId('open-error')).toContainText('photo.jpg is not a .CMD or .BAS program.');
  await expect(page.getByTestId('file-name')).toHaveText('seadrg01.cmd');
  await expect(page.locator('.fg-listing')).toBeVisible();
});
