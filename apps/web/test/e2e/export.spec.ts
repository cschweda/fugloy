// Export ▾: the zmac download is exactly what the CLI renders for the same hints, and warnings show before a .CAS.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { openProgram, renderSession, withHintText } from '@fugloy/disasm';

const ex = (p: string): string => fileURLToPath(new URL(`../../../../examples/${p}`, import.meta.url));

test('opens Sea Dragon and exports zmac equal to renderSession for the same hints', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__fugloyTest !== undefined, undefined, { timeout: 30_000 });
  await page.getByTestId('open-sea-dragon').click();
  await expect(page.locator('.fg-row-cursor')).toHaveAttribute('data-addr', String(0x8881));
  await page.getByTestId('export-summary').click();
  await expect(page.getByTestId('export-warning')).toHaveCount(0);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-zmac').click()]);
  expect(download.suggestedFilename()).toBe('seadrg01.z80');
  const text = readFileSync((await download.path())!, 'utf8');
  const session = withHintText(
    openProgram(new Uint8Array(readFileSync(ex('sea-dragon/seadrg01.cmd'))), { name: 'seadrg01.cmd', selection: { machine: 3, dos: 'trsdos' } }),
    readFileSync(ex('sea-dragon/seadrg01.hints'), 'utf8'),
    'seadrg01.hints',
  );
  expect(text).toBe(renderSession(session, 'zmac'));
});

test('exports an ARMOUR.III .CMD named ARMOUR.cmd', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__fugloyTest !== undefined, undefined, { timeout: 30_000 });
  await page.getByTestId('open-armored-patrol').click();
  await expect(page.getByTestId('file-name')).toHaveText('ARMOUR.III');
  await page.getByTestId('export-summary').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-cmd').click()]);
  expect(download.suggestedFilename()).toBe('ARMOUR.cmd');
});
