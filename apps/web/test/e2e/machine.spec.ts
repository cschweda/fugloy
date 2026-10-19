// The TRS-80 first in Run ▶ (phase 5D, Task 4): the screen, with Power, Reset and Pause under it,
// Programs to try, and the debugger in a disclosure. CI has no ROM: with none the tube says so in
// its own font, Power and a Program to try each say what is missing, and typing to the screen is
// harmless. With the Model III ROM the gitignored fugloy.mcp.json names (local only, skipped
// without it), opening Run ▶ turns the machine on: Cass?, Memory Size?, READY, and BASIC answers.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));

/** The path of the ROM fugloy.mcp.json (or $FUGLOY_CONFIG) names under `roms.model3`; null when there is none. */
function model3Rom(): string | null {
  const config = process.env.FUGLOY_CONFIG || resolve(repo, 'fugloy.mcp.json');
  if (!existsSync(config)) return null;
  const entry = (JSON.parse(readFileSync(config, 'utf8')).roms ?? {}).model3 as string | undefined;
  if (entry === undefined) return null;
  const path = isAbsolute(entry) ? entry : resolve(dirname(config), entry);
  return existsSync(path) ? path : null;
}

// composables/useRun's sentences, written out (the specs import nothing of the app).
const NAMES: Record<number, string> = { 1: 'Model I', 3: 'Model III', 4: 'Model 4' };
const NO_ROM_POWER = (m: number): string => `There is no ${NAMES[m]} ROM in this browser, so the ${NAMES[m]} cannot be turned on. Add your ROM below.`;
const EXAMPLE_NEEDS_ROM = (title: string, m: number): string => `${title} needs the ${NAMES[m]} ROM, which is not in this browser yet. Add your ROM below, then press Run again.`;
const POWERED_ON = (m: number): string => `The ${NAMES[m]} is on. Type to it on the screen.`;
const POWERED_OFF = (m: number): string => `The ${NAMES[m]} is off. Press Power on to turn it on again.`;
const BG = [0, 0, 0, 0xff]; // the black tube

/** The canvas's centre pixel, RGBA. */
const centre = (page: Page): Promise<number[]> =>
  page.getByTestId('trs-canvas').evaluate((c: HTMLCanvasElement) => Array.from(c.getContext('2d')!.getImageData(c.width >> 1, c.height >> 1, 1, 1).data));

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const axe = async (page: Page): Promise<string[]> => {
  const r = await new AxeBuilder({ page }).include('#right-panel-run').withTags(TAGS).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
};

const DEFAULT_MESSAGE = /^Press Run ▶ or (Ctrl|⌘)\+Enter to assemble the source and run it on a fresh Model III\.$/;

/** The site, then Write a program: Source ✎ beside Run ▶. */
const writeProgram = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.waitForFunction(() => window.__fugloyTest !== undefined, undefined, { timeout: 30_000 });
  await page.getByTestId('write-program').click();
  await expect(page.locator('.cm-content')).toContainText('ORG');
  await expect(page.getByTestId('run-tab')).toBeVisible();
};

test('with no ROM the tube says so, Power says what is missing, and typing to the screen is harmless', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await writeProgram(page);
  const screen = page.getByTestId('trs-screen');
  await expect(screen).toHaveAttribute('data-notice', 'no-rom');
  await expect(page.getByTestId('run-message')).toHaveText(DEFAULT_MESSAGE);
  // The notice is drawn on the tube: white phosphor on black, not a blank screen.
  const lit = await page.getByTestId('trs-canvas').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let k = 0; k < d.length; k += 4) if (d[k]! > 0x80) n++;
    return n;
  });
  expect(lit).toBeGreaterThan(100);
  const power = page.getByTestId('machine-power');
  await expect(power).toHaveText('Power on');
  await power.click();
  await expect(page.getByTestId('run-message')).toHaveText(NO_ROM_POWER(3));
  await expect(power).toHaveText('Power on');
  await expect(screen).toHaveAttribute('data-notice', 'no-rom');
  await screen.click();
  await expect(screen).toBeFocused();
  await page.keyboard.press('A');
  await page.waitForTimeout(200);
  expect(errors).toEqual([]);
  expect(await axe(page)).toEqual([]);
});

test('Programs to try lists the three games; with no ROM, Run says the game needs one', async ({ page }) => {
  await writeProgram(page);
  const list = page.getByTestId('programs');
  await expect(list).toContainText('Sea Dragon');
  await expect(list).toContainText('1982');
  await expect(list).toContainText('Rear Guard');
  await expect(list).toContainText('Eliminator');
  await expect(list).not.toContainText('Armored Patrol');
  await expect(page.getByTestId('program-run-sea-dragon')).toHaveAccessibleName('Run Sea Dragon');
  await page.getByTestId('program-run-sea-dragon').click();
  await expect(page.getByTestId('run-message')).toHaveText(EXAMPLE_NEEDS_ROM('Sea Dragon', 3));
  expect(await page.evaluate(() => window.__fugloyTest!.runnerState())).toBe('idle');
});

test('the Debugger is closed when the tab opens, a source Run opens it, and a Program to try leaves it as it was', async ({ page }) => {
  await writeProgram(page);
  const debuggerBox = page.getByTestId('debugger');
  await expect(debuggerBox).not.toHaveAttribute('open', '');
  // A Program to try leaves it closed…
  await page.getByTestId('program-run-rear-guard').click();
  await expect(page.getByTestId('run-message')).toHaveText(EXAMPLE_NEEDS_ROM('Rear Guard', 3));
  await expect(debuggerBox).not.toHaveAttribute('open', '');
  // …a Run of the starter opens it, with the step controls inside…
  await page.getByTestId('run-run').click();
  await expect.poll(() => page.evaluate(() => window.__fugloyTest!.debugMode())).toBe('running');
  await expect(debuggerBox).toHaveAttribute('open', '');
  await expect(debuggerBox.getByTestId('run-step')).toBeVisible();
  await expect(debuggerBox.getByTestId('screen-text')).toBeAttached();
  // The Run ▶ button moved the focus to the screen.
  await expect(page.getByTestId('trs-screen')).toBeFocused();
  // Pause is under the screen, in the machine row.
  await expect(page.getByTestId('machine-row').getByTestId('run-pause')).toBeEnabled();
  await expect(page.getByTestId('machine-power')).toHaveText('Power off');
  expect(await axe(page)).toEqual([]);
  // …and a Program to try leaves it open.
  await page.getByTestId('program-run-sea-dragon').click();
  await expect(page.getByTestId('run-message')).toHaveText(EXAMPLE_NEEDS_ROM('Sea Dragon', 3));
  await expect(debuggerBox).toHaveAttribute('open', '');
  // The user's toggle stands.
  await debuggerBox.locator('summary').first().click();
  await expect(debuggerBox).not.toHaveAttribute('open', '');
  // The debug keys work with it closed, and a pause opens it.
  await page.getByTestId('run-run').focus();
  await page.keyboard.press('F6');
  await expect.poll(() => page.evaluate(() => window.__fugloyTest!.debugMode())).toBe('paused');
  await expect(debuggerBox).toHaveAttribute('open', '');
  await expect(page.getByTestId('run-pause')).toHaveText('Continue');
});

const ROM = model3Rom();

test.describe('on the Model III ROM', () => {
  test.skip(ROM === null, 'needs the Model III ROM that fugloy.mcp.json names');

  /** The screen-text mirror's rows, trimmed. */
  const rows = (page: Page): Promise<string[]> => page.getByTestId('screen-text-row').allTextContents();
  /** A key held long enough for the ROM's keyboard scan to see it. */
  const key = async (page: Page, k: string): Promise<void> => {
    await page.keyboard.down(k);
    await page.waitForTimeout(80);
    await page.keyboard.up(k);
    await page.waitForTimeout(80);
  };

  test('opening Run ▶ powers on: Cass?, Memory Size?, READY, BASIC answers, Reset reboots, and the Model I has no ROM', async ({ page }) => {
    await writeProgram(page);
    await page.getByTestId('run-rom-input').setInputFiles(ROM!);
    await expect(page.getByTestId('run-rom-have')).toBeVisible();
    // The ROM is in this browser now: the next time Run ▶ opens, the machine turns on by itself.
    await writeProgram(page);
    await expect(page.getByTestId('run-message')).toHaveText(POWERED_ON(3));
    await expect(page.getByTestId('machine-power')).toHaveText('Power off');
    const screen = page.getByTestId('trs-screen');
    await expect(screen).not.toHaveAttribute('data-notice', 'no-rom');
    await expect(screen).toBeFocused();
    expect(await axe(page)).toEqual([]);

    // The mirror, inside the Debugger (opened, then the focus back on the screen).
    await page.getByTestId('debugger').locator('summary').first().click();
    await page.getByTestId('screen-text-summary').click();
    await expect.poll(async () => (await rows(page)).join('\n'), { timeout: 3000 }).toContain('Cass?');
    expect(await axe(page)).toEqual([]);
    await screen.click();
    await expect(screen).toBeFocused();

    await key(page, 'Enter');
    await expect.poll(async () => (await rows(page)).join('\n'), { timeout: 5000 }).toContain('Memory Size?');
    await key(page, 'Enter');
    await expect.poll(async () => (await rows(page)).join('\n'), { timeout: 5000 }).toContain('READY');
    for (const k of 'PRINT 2+2') await key(page, k === ' ' ? 'Space' : k);
    await key(page, 'Enter');
    await expect.poll(async () => (await rows(page)).some((r) => r.trimEnd() === ' 4'), { timeout: 5000 }).toBe(true);

    // Pause and Continue hold the machine itself (no debugger: the Debugger stays as it was).
    const pause = page.getByTestId('run-pause');
    await pause.click();
    await expect(pause).toHaveText('Continue');
    await expect.poll(() => page.evaluate(() => window.__fugloyTest!.runnerState())).toBe('paused');
    await pause.click();
    await expect(pause).toHaveText('Pause');
    await expect.poll(() => page.evaluate(() => window.__fugloyTest!.runnerState())).toBe('running');

    await page.getByTestId('machine-reset').click();
    await expect.poll(async () => (await rows(page)).join('\n'), { timeout: 3000 }).toContain('Cass?');
    await expect(screen).toBeFocused();
    await expect.poll(async () => (await rows(page)).join('\n')).not.toContain('READY');

    // Power off and on again.
    const power = page.getByTestId('machine-power');
    await power.click();
    await expect(power).toHaveText('Power on');
    // Off with a ROM: a blank tube, no notice, and the machine says it is off.
    await expect(screen).not.toHaveAttribute('data-notice', 'no-rom');
    await expect(page.getByTestId('run-message')).toHaveText(POWERED_OFF(3));
    await expect.poll(() => centre(page)).toEqual(BG);
    expect(await page.evaluate(() => window.__fugloyTest!.runnerState())).toBe('idle');
    await power.click();
    await expect(power).toHaveText('Power off');
    await expect(screen).toBeFocused();
    // Stop on the machine with no program turns it off the same way.
    await expect.poll(async () => (await rows(page)).join('\n'), { timeout: 3000 }).toContain('Cass?');
    await page.getByTestId('run-stop').click();
    await expect(power).toHaveText('Power on');
    await expect(page.getByTestId('run-message')).toHaveText(POWERED_OFF(3));
    await expect.poll(() => centre(page)).toEqual(BG);
    await power.click();
    await expect(power).toHaveText('Power off');

    await page.getByTestId('run-model').selectOption('1');
    await expect(screen).toHaveAttribute('data-notice', 'no-rom');
    await expect(page.getByTestId('run-message')).toHaveText(NO_ROM_POWER(1));
  });

  test('opening Run ▶ by keyboard on the tablist powers on and leaves the focus on the tab', async ({ page }) => {
    await writeProgram(page);
    await page.getByTestId('run-rom-input').setInputFiles(ROM!);
    await expect(page.getByTestId('run-rom-have')).toBeVisible();
    // A program open, on the Program tab: Run ▶ has not shown yet in this page.
    await page.goto('/');
    await page.waitForFunction(() => window.__fugloyTest !== undefined, undefined, { timeout: 30_000 });
    await page.getByTestId('open-sea-dragon').click();
    await expect(page.getByTestId('workbench')).toBeVisible();
    // Program, then Manual, then Run ▶, arrowing through the right tablist.
    await page.locator('#right-tab-program').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#right-tab-manual')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    const tab = page.locator('#right-tab-run');
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('run-message')).toHaveText(POWERED_ON(3));
    await expect(page.getByTestId('machine-power')).toHaveText('Power off');
    // Give a late focus the time to arrive: it never does.
    await page.waitForTimeout(300);
    await expect(tab).toBeFocused();
    await expect(page.getByTestId('trs-screen')).not.toBeFocused();
  });
});
