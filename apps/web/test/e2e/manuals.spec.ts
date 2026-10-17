// Bring-your-own manuals: the Manuals page, a citation without its manual, and
// the Manual tab opening a PDF the test writes itself (no manual is committed).
// archive.org is never reached: its cover requests are answered locally.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/** A minimal PDF with one line of text per page, in Helvetica. */
function makePdf(pages: string[]): Buffer {
  const objs: string[] = [];
  const n = pages.length;
  // 1 catalog, 2 pages, 3 font, then a page and its content stream per page.
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Count ${n} /Kids [${pages.map((_, i) => `${4 + 2 * i} 0 R`).join(' ')}] >>`;
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  pages.forEach((text, i) => {
    const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
    objs[4 + 2 * i] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + 2 * i} 0 R >>`;
    objs[5 + 2 * i] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** IN A,(0ECH) / RET at $5200, as a .CMD. */
const MODEPORT_CMD = [0x01, 0x05, 0x00, 0x52, 0xdb, 0xec, 0xc9, 0x02, 0x02, 0x00, 0x52];

const noArchive = async (page: Page): Promise<string[]> => {
  const seen: string[] = [];
  await page.route('https://archive.org/**', (route) => {
    seen.push(route.request().url());
    return route.fulfill({ status: 404, body: '' });
  });
  return seen;
};

const openModeport = async (page: Page): Promise<void> => {
  await page.getByRole('link', { name: 'Fugløy home' }).click();
  await page.waitForFunction(() => window.__fugloyTest !== undefined, undefined, { timeout: 30_000 });
  await page.evaluate((bytes) => window.__fugloyTest!.load(bytes, 'MODE.CMD'), MODEPORT_CMD);
  await page.locator('.fg-follow[data-table]', { hasText: 'MODEPORT' }).first().click();
  await expect(page.getByTestId('symbol-name')).toHaveText('MODEPORT');
};

test('the Manuals page lists every source, with archive.org covers said so', async ({ page }) => {
  const seen = await noArchive(page);
  await page.goto('/manuals');
  await expect(page.getByRole('heading', { name: 'Manuals', level: 1 })).toBeVisible();
  const m3 = page.getByTestId('manual-m3-trm');
  await expect(m3).toContainText('Model III Technical Reference Manual');
  await expect(m3).toContainText('Provide your own copy');
  const img = m3.locator('img');
  await expect(img).toHaveAttribute('src', 'https://archive.org/services/img/Model_III_Technical_Reference_Manual_1981_Tandy');
  await expect(img).toHaveAttribute('loading', 'lazy');
  await expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect(m3).toContainText('cover image from archive.org');
  // A source with no scan has a title card, not a cover.
  await expect(page.locator('.fg-manual', { hasText: 'catalog no.' }).first().locator('.fg-cover-card')).toBeVisible();
  await expect(page.getByTestId('manuals-backup')).toBeVisible();
  await expect(page.getByTestId('manuals-restore')).toBeVisible();
  // Covers are the only third-party requests, and they go to archive.org's image service.
  for (const u of seen) expect(u).toMatch(/^https:\/\/archive\.org\/services\/img\//);
});

test('a citation without the manual links to archive.org and to adding it', async ({ page }) => {
  await noArchive(page);
  await page.goto('/manuals');
  await openModeport(page);
  const missing = page.getByTestId('citation-missing').first();
  await expect(missing.getByTestId('archive-page')).toHaveText('Open page 15 on archive.org');
  await expect(missing.getByTestId('archive-page')).toHaveAttribute('href', /\/page\/n25\/mode\/1up$/);
  await expect(missing).toContainText('cover image from archive.org');
  await missing.getByTestId('add-manual').click();
  await expect(page).toHaveURL(/\/manuals\?add=m3-trm$/);
  await expect(page.getByTestId('manual-m3-trm')).toHaveClass(/fg-manual-wanted/);
});

test('an unknown PDF is named by the user, then a citation opens it at the page, marked', async ({ page }) => {
  await noArchive(page);
  await page.goto('/manuals');
  const pages = Array.from({ length: 16 }, (_, i) => `Page ${i + 1}`);
  pages[14] = 'Port Address: 0ECH';
  await page.getByTestId('manual-file').setInputFiles({ name: 'my-trm.pdf', mimeType: 'application/pdf', buffer: makePdf(pages) });
  const which = page.getByTestId('manual-which');
  await expect(which).toContainText('Which manual is it?');
  await which.locator('select').selectOption('m3-trm');
  await which.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByTestId('manual-message')).toContainText('Added my-trm.pdf');
  await expect(page.getByTestId('manual-m3-trm').getByTestId('manual-status')).toHaveText('You have it: set which PDF page is printed page 1');
  await expect(page.getByTestId('manual-m3-trm').getByTestId('manual-thumb')).toBeVisible();

  await openModeport(page);
  // pdf.js's worker comes from the app's own assets, and nothing else leaves the site.
  const foreign: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.hostname !== 'localhost' && !r.url().startsWith('https://archive.org/services/img/')) foreign.push(r.url());
  });
  const worker = page.waitForResponse(/\/_nuxt\/pdf\.worker\.min\.[\w-]+\.mjs$/);
  await page.getByTestId('open-manual').first().click();
  expect((await worker).headers()['content-type']).toContain('javascript');
  const tab = page.getByTestId('manual-tab');
  await expect(tab.getByTestId('manual-unmapped')).toContainText('printed page 15');
  await tab.getByTestId('manual-offset').fill('1');
  await tab.getByRole('button', { name: 'Set' }).click();
  await expect(tab.getByTestId('manual-page')).toHaveText('PDF page 15 of 16');
  await expect(tab.getByTestId('manual-mark')).toHaveText('MODEPORT is not in the page’s text; 0ECH is marked.');
  await tab.getByRole('button', { name: 'Next PDF page' }).click();
  await expect(tab.getByTestId('manual-page')).toHaveText('PDF page 16 of 16');
  await tab.getByTestId('manual-back').click();
  await expect(page.locator('#right-panel-symbol')).toBeVisible();
  await expect(page.locator('.fg-listing')).toBeFocused();
  expect(foreign).toEqual([]);
});

test('a file that is not a PDF is refused on the Manuals page', async ({ page }) => {
  await noArchive(page);
  await page.goto('/manuals');
  await page.getByTestId('manual-file').setInputFiles({ name: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('hello') });
  await expect(page.getByTestId('manual-message')).toContainText('is not a PDF');
});

test('with no IndexedDB, adding a manual explains why it cannot be kept', async ({ page }) => {
  await page.addInitScript(() => {
    // @ts-expect-error simulating a private window
    delete window.indexedDB;
  });
  await noArchive(page);
  await page.goto('/manuals');
  await page.getByTestId('manual-m3-trm').getByRole('button', { name: 'Add this manual…' }).click();
  await page.getByTestId('manual-file').setInputFiles({ name: 'm.pdf', mimeType: 'application/pdf', buffer: makePdf(['x']) });
  await expect(page.getByTestId('manual-message')).toContainText('storage is unavailable');
});
