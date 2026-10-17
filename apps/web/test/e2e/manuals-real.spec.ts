// Local only: the archive.org PDFs of the Model III Technical Reference Manual
// (docs/reference/archive-pdfs/, gitignored; never committed). Skips when they
// are missing, so CI and a clean worktree pass. Checks that `m3-trm p.15`
// opens on the right PDF page with MODEPORT's port marked.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const DIR = fileURLToPath(new URL('../../../../docs/reference/archive-pdfs/Model_III_Technical_Reference_Manual_1981_Tandy/', import.meta.url));
const TEXT = `${DIR}Model_III_Technical_Reference_Manual_1981_Tandy_text.pdf`;
const IMAGE = `${DIR}Model_III_Technical_Reference_Manual_1981_Tandy.pdf`;
const MODEPORT_CMD = [0x01, 0x05, 0x00, 0x52, 0xdb, 0xec, 0xc9, 0x02, 0x02, 0x00, 0x52];
const SHOTS = process.env.FUGLOY_SHOTS;

for (const [label, path, mark] of [
  ['the text-layer PDF', TEXT, 'MODEPORT is not in the page’s text; 0ECH is marked.'],
  ['the image-only PDF', IMAGE, 'This PDF has no text layer, so nothing can be marked.'],
] as const) {
  test(`m3-trm p.15 opens at PDF page 26 of ${label}`, async ({ page }) => {
    test.skip(!existsSync(path), `${path} is missing (gitignored, local only)`);
    await page.route('https://archive.org/**', (r) => r.fulfill({ status: 404, body: '' }));
    await page.goto('/manuals');
    await page.getByTestId('manual-file').setInputFiles({ name: 'm3trm.pdf', mimeType: 'application/pdf', buffer: readFileSync(path) });
    await expect(page.getByTestId('manual-message')).toContainText('as TRS-80 Model III Technical Reference Manual', { timeout: 60_000 });
    await expect(page.getByTestId('manual-m3-trm').getByTestId('manual-status')).toHaveText('You have it: the archive.org scan');

    await page.getByRole('link', { name: 'Fugløy home' }).click();
    await page.waitForFunction(() => window.__fugloyTest !== undefined, undefined, { timeout: 30_000 });
    await page.evaluate((bytes) => window.__fugloyTest!.load(bytes, 'MODE.CMD'), MODEPORT_CMD);
    await page.locator('.fg-follow[data-table]', { hasText: 'MODEPORT' }).first().click();
    const cite = page.getByTestId('citation').filter({ hasText: 'page 15' });
    await cite.getByTestId('open-manual').click();
    const tab = page.getByTestId('manual-tab');
    await expect(tab.getByTestId('manual-page')).toHaveText('PDF page 26 of 154', { timeout: 60_000 });
    await expect(tab.getByTestId('manual-mark')).toHaveText(mark, { timeout: 60_000 });
    // The mark is drawn on the page: count strongly yellow pixels.
    const yellow = await tab.getByTestId('manual-canvas').evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i]! > 200 && d[i + 1]! > 150 && d[i + 2]! < 110) n++;
      return n;
    });
    if (label.includes('text')) expect(yellow).toBeGreaterThan(200);
    else expect(yellow).toBe(0);
    if (SHOTS !== undefined) await page.screenshot({ path: `${SHOTS}/m3-trm-p15-${label.includes('text') ? 'text' : 'image'}.png` });
  });
}
