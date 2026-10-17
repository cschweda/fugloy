// The first screen and opening programs, in a browser against the generated site.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const ready = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.waitForFunction(() => window.__fugloyTest !== undefined, undefined, { timeout: 30_000 });
};
const pick = (page: Page, name: string, bytes: number[] | Buffer): Promise<void> =>
  page.getByTestId('file-input').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });

const seadrg06 = (): number[] => Array.from(readFileSync(fileURLToPath(new URL('../../../../examples/sea-dragon/seadrg06.cmd', import.meta.url))));

/** Drags a file over `selector` and drops it, as a browser would; says whether the page stopped the browser's default (opening the file). */
const drop = (page: Page, selector: string, name: string, bytes: number[]): Promise<{ dragover: boolean; drop: boolean }> =>
  page.evaluate(
    ({ selector, name, bytes }) => {
      const target = document.querySelector(selector)!;
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File([new Uint8Array(bytes)], name));
      const fire = (type: string): boolean => {
        const e = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer });
        target.dispatchEvent(e);
        return e.defaultPrevented;
      };
      fire('dragenter');
      const dragover = fire('dragover');
      return { dragover, drop: fire('drop') };
    },
    { selector, name, bytes },
  );

test('one click opens Sea Dragon with its hints, as Model III', async ({ page }) => {
  await ready(page);
  for (const id of ['sea-dragon', 'rear-guard', 'eliminator', 'armored-patrol']) await expect(page.getByTestId(`open-${id}`)).toBeVisible();
  await page.getByTestId('open-sea-dragon').click();
  await expect(page.getByTestId('workbench')).toBeVisible();
  await expect(page.getByTestId('file-name')).toHaveText('seadrg01.cmd');
  // Both pages show on a desktop, so the narrow-screen page switch does not.
  await expect(page.getByRole('group', { name: 'Page' })).toBeHidden();
  await expect(page.getByTestId('program-panel')).toBeVisible();
  await expect(page.getByTestId('machine-picker')).toHaveValue('3');
  await expect(page.getByTestId('dos-picker')).toHaveValue('trsdos');
  // The cursor opens on the entry, in view, and the ~70 header comment lines are folded behind one toggle row.
  await expect(page.locator('.fg-row-cursor')).toHaveAttribute('data-addr', String(0x8881));
  await expect(page.locator('.fg-row-cursor')).toBeInViewport();
  const toggle = page.getByTestId('header-toggle');
  await page.locator('.fg-listing').evaluate((el) => (el.scrollTop = 0));
  await expect(toggle).toHaveText(/^▸ \d+ header lines$/);
  await expect(page.locator('.fg-row-header')).toHaveCount(0);
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.locator('.fg-row-header').first()).toBeVisible();
  await expect(page.getByTestId('header-toggle')).toHaveText(/^▾ hide \d+ header lines$/);
  const status = page.getByTestId('status-line');
  await expect(status).toContainText('13,968 bytes · 56 blocks');
  await expect(status).toContainText('45% code');
  await expect(status).toContainText('entry $8881');
  await expect(status).toContainText('Model III · TRSDOS 1.3');
  await expect(page.getByTestId('program-panel')).toContainText('public domain 1995');
  // The Program tab is a spec sheet: machine evidence, loading, and the memory map.
  const panel = page.getByTestId('program-panel');
  await expect(panel).toContainText('Writes port $EC (MODEPORT), which only the Model III has.');
  await expect(panel).toContainText('$5200–$888F');
  await expect(panel).toContainText('32K');
  await expect(panel.getByTestId('memory-map')).toBeVisible();
  // A name under "Talks to" opens in the Symbol tab.
  await panel.getByRole('button', { name: 'MODEPORT' }).click();
  await expect(page.getByTestId('symbol-name')).toHaveText('MODEPORT');
});

test('the machine picker re-renders with the other machine names', async ({ page }) => {
  await ready(page);
  await page.getByTestId('open-sea-dragon').click();
  await page.getByTestId('machine-picker').selectOption('1');
  await expect(page.getByTestId('dos-picker')).toHaveValue('ldos');
  await expect(page.getByTestId('status-line')).toContainText('Model I · LDOS 5.1');
  await page.evaluate(() => window.__fugloyTest!.scrollToAddr(0x4a46));
  await expect(page.locator(`.fg-row[data-addr="${0x4a46}"]`)).toContainText('CTRLCHARTAB');
  await page.getByTestId('machine-picker').selectOption('4');
  await expect(page.getByTestId('dos-picker')).toBeDisabled();
  await expect(page.getByTestId('status-line')).toContainText('Model 4 · LS-DOS 6 service calls');
});

test('a game button builds menu opens another build', async ({ page }) => {
  await ready(page);
  await page.getByLabel('Other builds of Sea Dragon').click();
  await page.getByRole('button', { name: 'seadrg06.cmd' }).click();
  await expect(page.getByTestId('file-name')).toHaveText('seadrg06.cmd');
  await page.getByTestId('close-program').click();
  await expect(page.getByTestId('drop-zone')).toBeVisible();
});

test('a file that is not a program says so and loads as raw binary at an address', async ({ page }) => {
  await ready(page);
  await pick(page, 'photo.jpg', [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xc9]);
  await expect(page.getByTestId('open-error')).toContainText('photo.jpg is not a .CMD or .BAS program.');
  await expect(page.getByTestId('open-error').getByRole('link', { name: 'Manuals' })).toHaveCount(0);
  await page.getByTestId('load-raw').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').fill('10000');
  await dialog.getByRole('button', { name: 'Load' }).click();
  await expect(dialog.getByRole('alert')).toContainText('from 0 to FFFF');
  await dialog.getByRole('textbox').fill('7000');
  await dialog.getByRole('button', { name: 'Load' }).click();
  await expect(page.getByTestId('workbench')).toBeVisible();
  await expect(page.getByTestId('status-line')).toContainText('12 bytes');
  await expect(page.locator(`.fg-row-code[data-addr="${0x7000}"]`)).toBeVisible();
});

test('a PDF points at the Manuals page, and an empty file says it is empty', async ({ page }) => {
  await ready(page);
  await pick(page, 'manual.pdf', Buffer.from('%PDF-1.7\n%\xe2\xe3\n1 0 obj\n'));
  await expect(page.getByTestId('open-error')).toContainText('manual.pdf is not a .CMD or .BAS program.');
  await expect(page.getByTestId('open-error').getByRole('link', { name: 'Manuals' })).toBeVisible();
  await pick(page, 'blank.cmd', []);
  await expect(page.getByTestId('open-error')).toContainText('blank.cmd is empty (0 bytes).');
  await expect(page.getByTestId('load-raw')).toHaveCount(0);
});

test('the dimmed tabs say "coming later", and the divider drags', async ({ page }) => {
  await ready(page);
  await page.getByTestId('open-armored-patrol').click();
  await expect(page.getByTestId('file-name')).toHaveText('ARMOUR.III');
  for (const name of ['Source ✎', 'Run ▶']) {
    const tab = page.getByRole('tab', { name });
    await expect(tab).toHaveAttribute('aria-disabled', 'true');
    await tab.hover();
    await expect(tab.getByRole('tooltip')).toHaveText('Coming later');
    await expect(tab.getByRole('tooltip')).toHaveCSS('opacity', '1');
  }
  const left = page.locator('.fg-page-left');
  const before = (await left.boundingBox())!.width;
  const divider = (await page.getByRole('separator').boundingBox())!;
  await page.mouse.move(divider.x + 2, divider.y + 200);
  await page.mouse.down();
  await page.mouse.move(divider.x - 200, divider.y + 200, { steps: 5 });
  await page.mouse.up();
  expect((await left.boundingBox())!.width).toBeLessThan(before - 150);
});

test('a narrow screen shows one page at a time and never scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await ready(page);
  await expect(page.getByText('Fugløy is best on a desktop.')).toBeVisible();
  const noSideScroll = (): Promise<boolean> => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(await noSideScroll()).toBe(true);
  await page.getByTestId('open-sea-dragon').click();
  await expect(page.locator('.fg-listing')).toBeVisible();
  await expect(page.getByTestId('program-panel')).toBeHidden();
  expect(await noSideScroll()).toBe(true);
  await page.getByRole('button', { name: 'Details' }).click();
  await expect(page.getByTestId('program-panel')).toBeVisible();
  await expect(page.locator('.fg-listing')).toBeHidden();
  expect(await noSideScroll()).toBe(true);
});

test('a file dropped outside the drop zone on the first screen opens, and the browser does not', async ({ page }) => {
  await ready(page);
  expect(await drop(page, '.fg-first-games', 'seadrg06.cmd', seadrg06())).toEqual({ dragover: true, drop: true });
  await expect(page.getByTestId('file-name')).toHaveText('seadrg06.cmd');
  await expect(page).toHaveURL(/localhost:4173\/$/);
});

test('a PDF dropped on the open workbench suggests Manuals and keeps the program', async ({ page }) => {
  await ready(page);
  await page.getByTestId('open-sea-dragon').click();
  await expect(page.locator('.fg-listing')).toBeVisible();
  expect(await drop(page, '.fg-listing', 'trm.pdf', Array.from(Buffer.from('%PDF-1.7\n')))).toEqual({ dragover: true, drop: true });
  await expect(page.getByTestId('open-error')).toContainText('trm.pdf is not a .CMD or .BAS program.');
  await expect(page.getByTestId('open-error').getByRole('link', { name: 'Manuals' })).toBeVisible();
  await expect(page.getByTestId('confirm-dialog')).toBeHidden();
  await expect(page.getByTestId('file-name')).toHaveText('seadrg01.cmd');
  await expect(page.locator('.fg-row-cursor')).toBeVisible();
});

test('a program dropped on the open workbench asks before it replaces the open one', async ({ page }) => {
  await ready(page);
  await page.getByTestId('open-sea-dragon').click();
  await expect(page.locator('.fg-listing')).toBeVisible();
  await drop(page, '[data-testid=program-panel]', 'seadrg06.cmd', seadrg06());
  const dialog = page.getByTestId('confirm-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Open seadrg06.cmd in place of seadrg01.cmd?');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('file-name')).toHaveText('seadrg01.cmd');
  await drop(page, '.fg-listing', 'seadrg06.cmd', seadrg06());
  await dialog.getByRole('button', { name: 'Replace' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('file-name')).toHaveText('seadrg06.cmd');
  await expect(page.getByTestId('open-error')).toHaveCount(0);
});
