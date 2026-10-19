// Run ▶ in a browser against the generated site, with no ROM: the user's own case (open the
// site, Write a program, press Run, and the screen is blank), Ctrl/⌘+Enter from the editor,
// errors sent to Source ✎, a quiet listing refresh, no request past the site's own origin, and
// axe clean on the Run tab.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const ORIGIN = 'http://localhost:4173';
const BG = [0x10, 0x12, 0x10, 0xff];

const ready = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.waitForFunction(() => window.__fugloyTest !== undefined, undefined, { timeout: 30_000 });
};

/** The canvas's centre pixel, RGBA. */
const centre = (page: Page): Promise<number[]> =>
  page.getByTestId('trs-canvas').evaluate((c: HTMLCanvasElement) => Array.from(c.getContext('2d')!.getImageData(c.width >> 1, c.height >> 1, 1, 1).data));

test('open the site, Write a program, press Run: the screen is blank, with no ROM and no request past the site', async ({ page }) => {
  const outside: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith(ORIGIN) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) outside.push(r.url());
  });
  await ready(page);
  // Nothing of the emulator before Run is opened.
  await page.getByTestId('write-program').click();
  await expect(page.locator('.cm-content')).toContainText('ORG');
  await expect(page.getByRole('tab', { name: 'Run ▶' })).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('run-run').click();
  await expect(page.getByTestId('run-message')).toHaveText("Running on Fugløy's stub ROM (no ROM needed for this program).");
  await expect.poll(() => page.evaluate(() => window.__fugloyTest!.runnerState())).toBe('running');
  const text = await page.evaluate(() => window.__fugloyTest!.screenText());
  expect(text).toHaveLength(16);
  for (const row of text) expect(row).toMatch(/^ {64}$/);
  await expect.poll(() => centre(page)).toEqual(BG);
  // Run doesn't move the focus; the screen says how to type to it.
  await expect(page.getByTestId('run-run')).toBeFocused();
  await expect(page.getByTestId('trs-screen')).toContainText('Click the screen to type to the TRS-80.');
  // The listing refreshed quietly: the program is open, and Source ✎ is still the left tab.
  await expect(page.getByTestId('file-name')).toHaveText('clear-screen.cmd');
  await expect(page.getByRole('tab', { name: 'Source ✎' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('saved-work-dialog')).not.toBeVisible();
  expect(outside).toEqual([]);

  const r = await new AxeBuilder({ page }).include('#right-panel-run').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
});

test('the whole loop: Write, Run, type an error, Run marks it, Fix, Run again, and the screen is blank', async ({ page }) => {
  await ready(page);
  await page.getByTestId('write-program').click();
  const content = page.locator('.cm-content');
  await expect(content).toContainText('ORG');
  await page.getByTestId('run-run').click();
  await expect.poll(() => page.evaluate(() => window.__fugloyTest!.runnerState())).toBe('running');

  // An 8080 spelling: Run refuses it, marks its line, lists it with its Fix, and runs nothing.
  await content.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('\tORG\t7000H\nSTART:\tPUSH\tA\n\tPOP\tAF\n\tLD\tHL,3C00H\n\tLD\tDE,3C01H\n\tLD\tBC,03FFH\n\tLD\t(HL),20H\n\tLDIR\nWAIT:\tJR\tWAIT\n\tEND\tSTART\n');
  await page.getByTestId('run-run').click();
  await expect(page.getByTestId('run-message')).toContainText('The program has 1 error, so it did not run. The first is on line 2');
  await expect(page.locator('.cm-lintRange-error')).toHaveCount(1);
  await expect(page.getByTestId('source-diag')).toContainText('PUSH works on register pairs');
  expect(await page.evaluate(() => window.__fugloyTest!.runnerState())).toBe('idle');

  const fix = page.getByTestId('source-diag-fix');
  await expect(fix).toHaveAccessibleName('Fix line 2: write PUSH AF');
  await fix.click();
  await expect(content).toContainText('PUSH AF');
  await expect(page.getByTestId('source-diag')).toHaveCount(0);

  await page.getByTestId('run-run').click();
  await expect(page.getByTestId('run-message')).toHaveText("Running on Fugløy's stub ROM (no ROM needed for this program).");
  await expect.poll(() => page.evaluate(() => window.__fugloyTest!.runnerState())).toBe('running');
  await expect.poll(async () => (await page.evaluate(() => window.__fugloyTest!.screenText())).every((row) => /^ {64}$/.test(row))).toBe(true);
  await expect.poll(() => centre(page)).toEqual(BG);
});

test('Ctrl/⌘+Enter in the editor runs; an error goes to Source ✎ and runs nothing; a ROM call is refused with its line', async ({ page }) => {
  await ready(page);
  await page.getByTestId('write-program').click();
  const content = page.locator('.cm-content');
  await expect(content).toContainText('ORG');
  await content.click();
  const lines = await page.locator('.cm-line').count();
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByTestId('run-message')).toHaveText("Running on Fugløy's stub ROM (no ROM needed for this program).");
  // No line was inserted.
  expect(await page.locator('.cm-line').count()).toBe(lines);

  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('\tORG\t7000H\nSTART:\tLDA\n\tEND\tSTART\n');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByTestId('run-message')).toContainText('The program has 1 error, so it did not run. The first is on line 2');
  await expect(page.getByTestId('source-diag')).toHaveCount(1);
  await expect(content).toBeFocused();
  expect(await page.evaluate(() => window.__fugloyTest!.runnerState())).toBe('idle');

  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('\tORG\t7000H\nSTART:\tCALL\t$VDCLS\nWAIT:\tJR\tWAIT\n\tEND\tSTART\n');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByTestId('run-message')).toContainText("Line 2 calls $VDCLS, the ROM's routine at $01C9");
  expect(await page.evaluate(() => window.__fugloyTest!.runnerState())).toBe('idle');
});

test('keys reach the TRS-80 only while its screen has focus, and Tab leaves it', async ({ page }) => {
  await ready(page);
  await page.getByTestId('write-program').click();
  await expect(page.locator('.cm-content')).toContainText('ORG');
  await page.evaluate(() => window.__fugloyTest!.run());
  const screen = page.getByTestId('trs-screen');
  await screen.click();
  await expect(screen).toBeFocused();
  await expect(screen).not.toContainText('Click the screen');
  await page.keyboard.press('Tab');
  await expect(screen).not.toBeFocused();
  // Ctrl/⌘+Enter on the screen restarts the program.
  await screen.click();
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect.poll(() => page.evaluate(() => window.__fugloyTest!.runnerState())).toBe('running');
});

test('a program opened from a file is never replaced by a Run, until Show in Listing', async ({ page }) => {
  await ready(page);
  await page.getByTestId('open-sea-dragon').click();
  await expect(page.getByTestId('file-name')).toHaveText('seadrg01.cmd');
  await page.getByRole('tab', { name: 'Source ✎' }).click();
  await expect(page.locator('.cm-content')).toContainText('ORG');
  await page.getByRole('tab', { name: 'Run ▶' }).click();
  await page.getByTestId('run-run').click();
  await expect.poll(() => page.evaluate(() => window.__fugloyTest!.runnerState())).toBe('running');
  await expect(page.getByTestId('file-name')).toHaveText('seadrg01.cmd');
  await page.getByTestId('run-show-listing').click();
  await expect(page.getByTestId('file-name')).toHaveText('clear-screen.cmd');
  await expect(page.getByRole('tab', { name: 'Listing' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('save-state')).toHaveText('not saved (assembled from your source)');
});

test('Ctrl/⌘+Enter in the listing runs and refreshes it in place, keeping the focus there; inside the inline editor it runs nothing', async ({ page }) => {
  await ready(page);
  await page.getByTestId('write-program').click();
  await expect(page.locator('.cm-content')).toContainText('ORG');
  await page.evaluate(() => window.__fugloyTest!.run());
  await expect(page.getByTestId('file-name')).toHaveText('clear-screen.cmd');
  await page.getByRole('tab', { name: 'Listing' }).click();
  const row = page.locator('.fg-row-code').first();
  const inListing = (): Promise<boolean> => page.evaluate(() => document.activeElement?.closest('.fg-listing') != null);
  await page.getByTestId('run-stop').click();
  await row.click();
  expect(await inListing()).toBe(true);
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect.poll(() => page.evaluate(() => window.__fugloyTest!.runnerState())).toBe('running');
  expect(await inListing()).toBe(true);
  await expect(page.getByRole('tab', { name: 'Listing' })).toHaveAttribute('aria-selected', 'true');

  // In the inline editor (N), Ctrl/⌘+Enter runs nothing and the editor stays open.
  await page.getByTestId('run-stop').click();
  await row.click();
  await page.keyboard.press('n');
  await expect(page.getByTestId('inline-edit-input')).toBeFocused();
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByTestId('inline-edit-input')).toBeFocused();
  expect(await page.evaluate(() => window.__fugloyTest!.runnerState())).toBe('stopped');
});

test('leaving the workbench for another page stops the program', async ({ page }) => {
  await ready(page);
  await page.getByTestId('write-program').click();
  await expect(page.locator('.cm-content')).toContainText('ORG');
  await page.evaluate(() => window.__fugloyTest!.run());
  await expect.poll(() => page.evaluate(() => window.__fugloyTest!.runnerState())).toBe('running');
  await page.getByRole('link', { name: 'About' }).click();
  await expect(page).toHaveURL(/\/about\/$/);
  await page.goBack();
  await page.waitForFunction(() => window.__fugloyTest !== undefined);
  expect(await page.evaluate(() => window.__fugloyTest!.runnerState())).toBe('stopped');
});

test('Open as source ✎ turns Sea Dragon into a source beside its listing; with no ROM, Run names the first ROM call', async ({ page }) => {
  await ready(page);
  await page.getByTestId('open-sea-dragon').click();
  await expect(page.getByTestId('file-name')).toHaveText('seadrg01.cmd');
  // Export ▾ offers it too.
  await page.getByTestId('export-summary').click();
  await expect(page.getByTestId('export-open-source')).toHaveText('Open as source ✎');
  await page.getByTestId('export-summary').click();
  await page.getByRole('tab', { name: 'Program' }).click();
  await page.getByTestId('open-as-source').click();
  await expect(page.getByRole('tab', { name: 'Source ✎' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('source-pick').locator('option:checked')).toHaveText('seadrg01.z');
  await expect(page.locator('.cm-content')).toContainText('ORG');
  await expect(page.getByTestId('source-diag-count')).toHaveText(/No problems|warning|note/);
  // It reassembles to the program exactly, so there is no note.
  await expect(page.getByTestId('source-open-note')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByTestId('run-message')).toContainText("calls $DELAY, the ROM's routine at $0060");
  expect(await page.evaluate(() => window.__fugloyTest!.runnerState())).toBe('idle');
  // The disassembly stays open: a Run of the source never replaces a program opened from a file.
  await expect(page.getByTestId('file-name')).toHaveText('seadrg01.cmd');
});

test('debugging from the keyboard (5C): F9 sets a breakpoint, Run stops there, F10 steps, the list removes it, F5 continues; axe clean paused and running', async ({ page }) => {
  await ready(page);
  await page.getByTestId('write-program').click();
  const content = page.locator('.cm-content');
  await expect(content).toContainText('ORG');
  await content.click();
  await page.keyboard.press('ControlOrMeta+a');
  // Line 2 LD A,1; 3 INC A; 4 DEC A; 5 JR LOOP.
  await page.keyboard.type('\tORG\t7000H\nSTART:\tLD\tA,1\nLOOP:\tINC\tA\n\tDEC\tA\n\tJR\tLOOP\n\tEND\tSTART\n');
  // The cursor to line 4, then F9 (the editor's line, from the keyboard alone).
  await page.locator('.cm-line').nth(3).click();
  await page.keyboard.press('F9');
  await expect(page.getByTestId('breakpoint-text')).toHaveText('Line 4: DEC A');
  // What the page saw of each key: whether the debug keys claimed it.
  await page.evaluate(() => {
    const w = window as unknown as { seen: string[] };
    w.seen = [];
    window.addEventListener('keydown', (e) => w.seen.push(`${e.shiftKey ? 'Shift+' : ''}${e.key}:${e.defaultPrevented}`));
  });
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect.poll(() => page.evaluate(() => window.__fugloyTest!.runnerState())).toBe('paused');
  await expect(page.getByTestId('run-message')).toHaveText('Paused at line 4, DEC A, at a breakpoint.');
  await expect(page.getByTestId('debug-announcer')).toHaveText('Paused at line 4, DEC A, at a breakpoint.');
  await expect(page.locator('.cm-line.fg-run-paused')).toContainText('DEC');
  await expect(page.getByTestId('registers')).toContainText('Half-carry');
  let r = await new AxeBuilder({ page }).include('#right-panel-run').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);

  // F10 steps one line; F11 and F7 step too.
  await page.keyboard.press('F10');
  await expect(page.getByTestId('run-message')).toHaveText(/^Line 5, JR LOOP\./);
  await page.keyboard.press('F11');
  await expect(page.getByTestId('run-message')).toHaveText(/^Line 3, INC A\./);
  await page.keyboard.press('F7');
  await expect(page.getByTestId('run-message')).toHaveText(/^Line 4, DEC A\./);
  await expect(page.getByTestId('debug-announcer')).toHaveText(/^Line 4, DEC A\./);

  // The breakpoint list, by keyboard: Tab to Remove, Enter.
  const remove = page.getByTestId('breakpoint-remove');
  await remove.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('breakpoint')).toHaveCount(0);
  await expect(page.getByTestId('breakpoints')).toBeFocused();

  // F5 continues; while running, F5 is swallowed: no reload under the program.
  await page.keyboard.press('F5');
  await expect.poll(() => page.evaluate(() => window.__fugloyTest!.runnerState())).toBe('running');
  await page.keyboard.press('F5');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__fugloyTest?.runnerState())).toBe('running');
  r = await new AxeBuilder({ page }).include('#right-panel-run').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  // Shift+F5 stops it.
  await page.keyboard.press('Shift+F5');
  await expect.poll(() => page.evaluate(() => window.__fugloyTest!.runnerState())).toBe('stopped');
  const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen);
  expect(seen.filter((k) => /^(Shift\+)?F\d/.test(k))).toEqual(['F10:true', 'F11:true', 'F7:true', 'F5:true', 'F5:true', 'Shift+F5:true']);
});

test('the screen-text mirror lists the screen, closed until opened, and every debug control is in the Tab order', async ({ page }) => {
  await ready(page);
  await page.getByTestId('write-program').click();
  await expect(page.locator('.cm-content')).toContainText('ORG');
  await page.evaluate(() => window.__fugloyTest!.run());
  await expect.poll(() => page.evaluate(() => window.__fugloyTest!.runnerState())).toBe('running');
  const mirror = page.getByTestId('screen-text');
  await expect(mirror).not.toHaveAttribute('open', '');
  await page.getByTestId('screen-text-summary').focus();
  await page.keyboard.press('Enter');
  await expect(mirror).toHaveAttribute('open', '');
  await expect(page.getByTestId('screen-text-row')).toHaveCount(16);
  await expect(page.getByTestId('screen-text-row').first()).toHaveText('blank');
  // Tab from Run ▶ reaches each control in turn.
  await page.getByTestId('run-run').focus();
  const order: string[] = [];
  for (let k = 0; k < 12; k++) {
    await page.keyboard.press('Tab');
    order.push(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.testid ?? document.activeElement?.tagName ?? ''));
  }
  for (const id of ['run-stop', 'run-pause', 'run-step', 'run-step-over', 'run-to-here', 'run-follow', 'trs-screen', 'screen-text-summary', 'screen-text-speak']) expect(order).toContain(id);
});
