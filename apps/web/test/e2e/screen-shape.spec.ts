// Phase 6A: each model's picture at its true shape, and full screen, on the stub ROM (CI has no
// ROM). The Model III's tube is 4:3; the Model I's is (4/3) x (384 / 10.6445 MHz) / (512 /
// 10.1376 MHz), about 0.952, never narrower than its 384 dots, and switching model changes it at the next Run. Full screen puts the
// screen box itself in full screen, the tube centred on black at whole rows within the window,
// with the keyboard's focus kept on the box going in and coming out.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const MODEL1_ASPECT = ((4 / 3) * (384 / 10.6445e6)) / (512 / 10.1376e6);

/** Copies the keyboard's first row ($3801: @ A B C D E F G) to the screen's top left, for ever. */
const KEYS = '\tORG\t7000H\nSTART:\tLD\tA,(3801H)\n\tLD\t(3C00H),A\n\tJR\tSTART\n\tEND\tSTART\n';

/** The site, Write a program, the keyboard program in Source ✎, and Run ▶ on `model`. */
async function runKeys(page: Page, model: '1' | '3' = '3'): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__fugloyTest !== undefined, undefined, { timeout: 30_000 });
  await page.getByTestId('write-program').click();
  const content = page.locator('.cm-content');
  await expect(content).toContainText('ORG');
  await content.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(KEYS);
  await page.getByTestId('run-model').selectOption(model);
  await page.getByTestId('run-run').click();
  await expect.poll(() => page.evaluate(() => window.__fugloyTest!.runnerState())).toBe('running');
}

/** The screen box's inside (its canvas's space, without the border), and the canvas as drawn, in CSS pixels. */
const measure = (page: Page): Promise<{ box: { w: number; h: number }; tube: { w: number; h: number }; vw: number; vh: number; raster: number[] }> =>
  page.getByTestId('trs-screen').evaluate((b: HTMLElement) => {
    const c = b.querySelector('canvas')!.getBoundingClientRect();
    return {
      box: { w: b.clientWidth, h: b.clientHeight },
      tube: { w: c.width, h: c.height },
      vw: window.innerWidth,
      vh: window.innerHeight,
      raster: [b.querySelector('canvas')!.width, b.querySelector('canvas')!.height],
    };
  });

const fullscreenId = (page: Page): Promise<string | null> => page.evaluate(() => (document.fullscreenElement as HTMLElement | null)?.dataset.testid ?? null);

/** The top-left character as m.video.text() reads it. */
const topLeft = async (page: Page): Promise<string> => (await page.evaluate(() => window.__fugloyTest!.screenText()))[0]!.charAt(0);

test('the Model III tube is 4:3, and the Model I one about 0.952, from the next Run on', async ({ page }) => {
  await runKeys(page, '3');
  const m3 = await measure(page);
  expect(m3.raster).toEqual([512, 192]);
  expect(Math.abs(m3.box.w - (m3.box.h * 4) / 3)).toBeLessThanOrEqual(1);
  expect(m3.box.h % 192).toBe(0);

  await page.getByTestId('run-model').selectOption('1');
  await page.getByTestId('run-run').click();
  await expect.poll(async () => (await measure(page)).raster).toEqual([384, 192]);
  const m1 = await measure(page);
  expect(Math.abs(m1.box.w / m1.box.h - MODEL1_ASPECT)).toBeLessThan(0.01);
  // The canvas fills the box (clientWidth rounds to whole pixels); the rows stay whole.
  expect(Math.abs(m1.tube.w - m1.box.w)).toBeLessThanOrEqual(1);
  expect(m1.tube.h).toBe(m1.box.h);
  expect(m1.box.h % 192).toBe(0);
  // Never narrower than its 384 dots: at 1440x900 the Model III's height (384) would be 366 wide,
  // so the Model I takes the next whole-row height that is at least 384 wide.
  expect(m1.box.w).toBeGreaterThanOrEqual(384);
});

test('Full screen shows the tube at whole rows within the window, keeps the keys on it, and comes back to the panel', async ({ page }) => {
  await runKeys(page, '3');
  const panel = await measure(page);
  const button = page.getByTestId('screen-fullscreen');
  await expect(button).toHaveText('Full screen');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await button.click();
  await expect.poll(() => fullscreenId(page)).toBe('trs-screen');
  await expect(button).toHaveText('Leave full screen');
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  const screen = page.getByTestId('trs-screen');
  await expect(screen).toBeFocused();
  await expect.poll(async () => (await measure(page)).tube.h).toBeGreaterThan(panel.tube.h - 1);
  const fs = await measure(page);
  expect(fs.tube.h % 192).toBe(0);
  expect(fs.tube.h).toBeLessThanOrEqual(fs.vh);
  expect(fs.tube.w).toBeLessThanOrEqual(fs.vw);
  expect(Math.abs(fs.tube.w - (fs.tube.h * 4) / 3)).toBeLessThanOrEqual(1);
  // The largest whole-row tube: one more row step would not fit.
  expect(fs.tube.h + 192 > fs.vh || ((fs.tube.h + 192) * 4) / 3 > fs.vw).toBe(true);

  // A key typed in full screen reaches the TRS-80: A is bit 1 of $3801, so the top left reads 02H, shown as B.
  await expect.poll(() => topLeft(page)).toBe('@');
  await page.keyboard.down('a');
  await expect.poll(() => topLeft(page)).toBe('B');
  await page.keyboard.up('a');
  await expect.poll(() => topLeft(page)).toBe('@');

  // The button again leaves full screen: the panel's size, the focus on the screen. (In full screen
  // the box covers the page, so a pointer cannot reach the button; Esc is the way out by hand.)
  await button.dispatchEvent('click');
  await expect.poll(() => fullscreenId(page)).toBeNull();
  await expect(button).toHaveText('Full screen');
  await expect(screen).toBeFocused();
  await expect.poll(async () => (await measure(page)).tube).toEqual(panel.tube);

  // Leaving another way (Esc's path, document.exitFullscreen) also leaves the focus on the screen.
  await button.click();
  await expect.poll(() => fullscreenId(page)).toBe('trs-screen');
  await page.evaluate(() => document.exitFullscreen());
  await expect.poll(() => fullscreenId(page)).toBeNull();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(screen).toBeFocused();
  await expect.poll(async () => (await measure(page)).tube).toEqual(panel.tube);
});

test('in a window taller than it is wide, the full-screen tube is bound by the width and fits', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 1200 });
  await runKeys(page, '1');
  await page.getByTestId('screen-fullscreen').click();
  await expect.poll(() => fullscreenId(page)).toBe('trs-screen');
  await expect.poll(async () => (await measure(page)).tube.h % 192).toBe(0);
  const fs = await measure(page);
  expect(fs.tube.w).toBeLessThanOrEqual(fs.vw);
  expect(fs.tube.h).toBeLessThanOrEqual(fs.vh);
  // Width-bound: one more row step would be too wide, though the height has room for it.
  expect((fs.tube.h + 192) * MODEL1_ASPECT).toBeGreaterThan(fs.vw);
  expect(fs.tube.h + 192).toBeLessThanOrEqual(fs.vh);
  expect(Math.abs(fs.tube.w / fs.tube.h - MODEL1_ASPECT)).toBeLessThan(0.01);
  await expect(page.getByTestId('trs-screen')).toBeFocused();
});
