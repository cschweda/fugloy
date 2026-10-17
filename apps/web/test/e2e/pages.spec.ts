// The technical details page keeps its styles and script to itself, the About page says what it must,
// and axe finds nothing on any page, including the workbench with Sea Dragon open (the listing scroller
// is role="group" with aria-activedescendant).
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const violations = async (page: import('@playwright/test').Page): Promise<string[]> => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
};

test('technical details runs the explainer without restyling the site', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/technical-details');
  const explainer = page.getByTestId('explainer');
  await expect(explainer.getByRole('heading', { level: 1 })).toContainText('Inside');
  // The script ran: the Names toggle fills its listing, and flips it.
  await expect(page.locator('#namesOut')).toContainText('CALL 0049H');
  await page.locator('#namesView button[data-v="names"]').click();
  await expect(page.locator('#namesOut')).toContainText('CALL $KBWAIT');
  // The explainer's body styles belong to its wrapper, not to the page or the top bar.
  const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const wrapBg = await explainer.evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(wrapBg).toBe('rgb(11, 15, 28)');
  expect(bodyBg).not.toBe(wrapBg);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('header.fg-bar')!).backgroundColor)).toBe('rgb(22, 27, 34)');
  // Leaving the page removes its stylesheet: the About page's headings are the site's, not the explainer's.
  await page.getByRole('link', { name: 'About' }).first().click();
  await expect(page.getByTestId('about')).toBeVisible();
  expect(await page.locator('style').evaluateAll((els) => els.some((e) => e.textContent?.includes('.fg-inside')))).toBe(false);
  expect(errors).toEqual([]);
});

test('the About page keeps its promises and credits its sources', async ({ page }) => {
  await page.goto('/about');
  const about = page.getByTestId('about');
  await expect(about).toContainText('never uploaded');
  await expect(about).toContainText('one browser on one computer');
  await expect(about).toContainText('Back up');
  await expect(about).toContainText('Restore');
  expect(await about.getByTestId('credit-sources').locator('li').count()).toBeGreaterThan(5);
  await expect(about).toContainText('zmac');
  await expect(about.getByRole('link', { name: 'PDF.js' })).toBeVisible();
  await expect(about.getByRole('link', { name: 'trs-80.org' })).toHaveAttribute('href', /trs-80\.org/);
  await expect(about).toContainText('I hereby release them into the public domain');
  expect((await page.request.get('/pdfjs/LICENSE')).ok()).toBe(true);
});

for (const path of ['/', '/technical-details', '/manuals', '/about']) {
  test(`axe finds nothing on ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForTimeout(500);
    expect(await violations(page)).toEqual([]);
  });
}

test('axe finds nothing on the workbench with Sea Dragon open', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__fugloyTest !== undefined, undefined, { timeout: 30_000 });
  await page.getByTestId('open-sea-dragon').click();
  await expect(page.getByTestId('workbench')).toBeVisible();
  await page.waitForTimeout(800);
  expect(await violations(page)).toEqual([]);
});

test('the explainer keeps its section rail pinned while the page scrolls, and anchors scroll smoothly', async ({ page }) => {
  await page.goto('/technical-details');
  const rail = page.locator('.fg-inside .rail');
  await expect(rail).toBeVisible();
  const top = async (): Promise<number> => (await rail.boundingBox())!.y;
  await page.evaluate(() => window.scrollTo(0, 4000));
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(3000);
  expect(Math.abs(await top())).toBeLessThan(2);
  await page.evaluate(() => window.scrollTo(0, 9000));
  await page.waitForTimeout(300);
  expect(Math.abs(await top())).toBeLessThan(2);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe('smooth');
  // Leaving the page gives the site its own scrolling back.
  await page.getByRole('link', { name: 'About' }).first().click();
  await expect(page.getByTestId('about')).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe('auto');
});
