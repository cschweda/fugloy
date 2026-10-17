// The plan's named risk for phase 4: a listing of 8,000+ rows must scroll
// smoothly, jump to an address fast, and keep the cursor row on screen when the
// rows change. Runs against the generated site's workbench, driven through its
// test hook (window.__fugloyTest, app/pages/index.vue). asylum16 (gitignored) is
// used when it is present; the raw 48K load needs nothing outside the repo.
// The timing limits apply only with FUGLOY_PERF=1; CI runs the rest.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const repo = (path: string): string => fileURLToPath(new URL(`../../../../${path}`, import.meta.url));
const ASYLUM = repo('fixtures/real/Asylum (1981)(Frank Corr & William F Denman Jr-Med Systems Software)[CMD]/asylum16.cmd');
const ASYLUM_HINTS = repo('fixtures/hints/asylum16.hints');
/** FUGLOY_PERF=1 enforces the timing limits; without it the numbers are printed and only correctness is checked. */
const PERF = process.env.FUGLOY_PERF === '1';

declare global {
  interface Window {
    __longTasks: number[];
    /** Set by the workbench (app/pages/index.vue). */
    __fugloyTest?: {
      rowCount: () => number;
      scrollToAddr: (addr: number) => void;
      setCursor: (addr: number | null) => void;
      rerender: (kind: 'tables' | 'names') => void;
      load: (bytes: number[], name: string, hints?: string, base?: number) => void;
      loadedBytes: () => number[];
    };
  }
}

interface Case {
  name: string;
  /** A program the test reads itself and hands to the workbench (the page fetches nothing but its bundled examples); without it, seadrg01's loaded image repeated over 48K, loaded raw at $4000. */
  input?: () => { bytes: number[]; name: string; hints: string };
  /** Addresses to jump to: row starts and addresses inside rows. */
  jumps: number[];
  available: boolean;
}

const spread = (from: number, to: number, n: number): number[] => Array.from({ length: n }, (_, i) => from + Math.floor(((to - from) * (i + 0.5)) / n));

const CASES: Case[] = [
  { name: 'raw 48K load of seadrg01', jumps: spread(0x4000, 0xffff, 12), available: true },
  {
    name: 'asylum16 with its hints',
    input: () => ({ bytes: Array.from(readFileSync(ASYLUM)), name: 'asylum16.cmd', hints: readFileSync(ASYLUM_HINTS, 'utf8') }),
    jumps: spread(0x42f3, 0x7ff6, 12),
    available: existsSync(ASYLUM) && existsSync(ASYLUM_HINTS),
  },
];

const nextFrames = (page: Page): Promise<unknown> => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** Opens Sea Dragon with one click on the first screen, as a visitor would. */
async function openSeaDragon(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__fugloyTest !== undefined, undefined, { timeout: 30_000 });
  await page.getByTestId('open-sea-dragon').click();
  await expect(page.locator('.fg-listing')).toBeVisible();
}

async function openCase(page: Page, c: Case): Promise<number> {
  await page.addInitScript(() => {
    window.__longTasks = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__longTasks.push(e.duration);
    }).observe({ type: 'longtask', buffered: true });
  });
  await openSeaDragon(page);
  if (c.input !== undefined) {
    await page.evaluate(({ bytes, name, hints }) => window.__fugloyTest!.load(bytes, name, hints), c.input());
  } else {
    await page.evaluate(() => {
      const t = window.__fugloyTest!;
      const loaded = t.loadedBytes();
      t.load(Array.from({ length: 0xc000 }, (_, i) => loaded[i % loaded.length]!), 'seadrg01 x 48K (raw)', undefined, 0x4000);
    });
  }
  await nextFrames(page);
  return page.evaluate(() => window.__fugloyTest!.rowCount());
}

/** Sea Dragon open, the cursor on $49B1 (L49B1) and scrolled to it. */
async function openAt49B1(page: Page): Promise<void> {
  await openSeaDragon(page);
  await page.evaluate(() => {
    window.__fugloyTest!.setCursor(0x49b1);
    window.__fugloyTest!.scrollToAddr(0x49b1);
  });
  await nextFrames(page);
}

/** Long tasks and frame intervals while `action` runs. */
async function measure(page: Page, action: () => Promise<void>): Promise<{ longTasks: number[]; frames: number[] }> {
  await page.evaluate(() => {
    window.__longTasks = [];
    const w = window as unknown as { __frames: number[]; __recording: boolean };
    w.__frames = [];
    w.__recording = true;
    let last = performance.now();
    const tick = (t: number): void => {
      w.__frames.push(t - last);
      last = t;
      if (w.__recording) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await action();
  // Let the last frames and any long task land before reading them.
  await page.waitForTimeout(300);
  return page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __recording: boolean };
    w.__recording = false;
    return { longTasks: [...window.__longTasks], frames: w.__frames.slice(1) };
  });
}

const p = (values: number[], q: number): number => {
  const s = [...values].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};
const ms = (v: number): string => `${v.toFixed(1)} ms`;

for (const c of CASES) {
  test.describe(c.name, () => {
    test.skip(!c.available, 'sample not present (fixtures/real is gitignored)');

    test('scrolls smoothly, jumps fast, and keeps the cursor on screen', async ({ page }) => {
      // FUGLOY_CPU_THROTTLE=4 runs the same check on a CPU slowed fourfold (Chromium's DevTools throttling).
      const throttle = Number(process.env.FUGLOY_CPU_THROTTLE ?? 1);
      if (throttle > 1) await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: throttle });
      const count = await openCase(page, c);
      expect(count).toBeGreaterThan(c.name.startsWith('raw') ? 8000 : 1000);
      const listing = page.locator('.fg-listing');
      await listing.hover();

      // Fling: bursts of large wheel deltas down the whole listing to the bottom, then back to the top.
      const geometry = (): Promise<{ top: number; max: number }> =>
        page.evaluate(() => {
          const el = document.querySelector<HTMLElement>('.fg-listing')!;
          return { top: el.scrollTop, max: el.scrollHeight - el.clientHeight };
        });
      await page.evaluate(() => {
        document.querySelector<HTMLElement>('.fg-listing')!.scrollTop = 0;
      });
      const { max } = await geometry();
      const steps = Math.ceil(max / 2400) + 5;
      let bottom = 0;
      let backToTop = -1;
      const fling = await measure(page, async () => {
        for (let i = 0; i < steps; i++) await page.mouse.wheel(0, 2400);
        await expect.poll(async () => (await geometry()).top, { timeout: 10_000 }).toBeGreaterThanOrEqual(max - 1);
        bottom = (await geometry()).top;
        for (let i = 0; i < steps; i++) await page.mouse.wheel(0, -2400);
        await expect.poll(async () => (await geometry()).top, { timeout: 10_000 }).toBe(0);
        backToTop = (await geometry()).top;
      });
      // Scrollbar drag: jump the scroll position across the listing, a frame apart.
      const drag = await measure(page, async () => {
        await page.evaluate(async () => {
          const el = document.querySelector<HTMLElement>('.fg-listing')!;
          const raf = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));
          for (let i = 0; i <= 100; i++) {
            el.scrollTop = ((el.scrollHeight - el.clientHeight) * ((i * 37) % 101)) / 100;
            await raf();
          }
        });
      });

      // scrollToAddr: time from the call to the next frame with the row in view.
      const jumps = await page.evaluate(async (addrs) => {
        const el = document.querySelector<HTMLElement>('.fg-listing')!;
        const out: { addr: number; ms: number; inView: boolean }[] = [];
        for (const addr of addrs) {
          el.scrollTop = addr % 2 === 0 ? 0 : el.scrollHeight;
          await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
          const t0 = performance.now();
          window.__fugloyTest!.scrollToAddr(addr);
          await new Promise((r) => requestAnimationFrame(() => r(undefined)));
          const box = el.getBoundingClientRect();
          // The row holding addr starts at most 3 bytes below it (rows are at most 4 bytes).
          const inView = [...el.querySelectorAll<HTMLElement>('.fg-row[data-addr]')].some((row) => {
            const a = Number(row.dataset.addr);
            const r = row.getBoundingClientRect();
            return a <= addr && a > addr - 4 && r.top >= box.top && r.bottom <= box.bottom;
          });
          out.push({ addr, ms: performance.now() - t0, inView });
        }
        return out;
      }, c.jumps);

      // Cursor stays on screen across re-renders with new rows of the same program.
      const cursorAddr = c.jumps[Math.floor(c.jumps.length / 2)]!;
      const rerenders: { kind: string; before: number; after: number; delta: number; inView: boolean; ms: number }[] = [];
      for (const kind of ['names', 'tables', 'tables'] as const) {
        const result = await page.evaluate(
          async ({ addr, kind }) => {
            const hook = window.__fugloyTest!;
            const el = document.querySelector<HTMLElement>('.fg-listing')!;
            const raf = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));
            hook.setCursor(addr);
            hook.scrollToAddr(addr);
            await raf();
            await raf();
            const before = hook.rowCount();
            const cursorTop = (): number | null => el.querySelector('.fg-row-cursor')?.getBoundingClientRect().top ?? null;
            const topBefore = cursorTop();
            const t0 = performance.now();
            hook.rerender(kind);
            await raf();
            const took = performance.now() - t0;
            const box = el.getBoundingClientRect();
            const row = el.querySelector('.fg-row-cursor');
            const r = row?.getBoundingClientRect();
            return {
              kind,
              before,
              after: hook.rowCount(),
              delta: r === undefined || topBefore === null ? NaN : r.top - topBefore,
              inView: r !== undefined && r.top >= box.top && r.bottom <= box.bottom,
              ms: took,
            };
          },
          { addr: cursorAddr, kind },
        );
        rerenders.push(result);
      }

      const report = [
        `${c.name}: ${count} rows${throttle > 1 ? ` (CPU throttled ${throttle}x)` : ''}`,
        `fling (${steps} wheel steps of 2400px down to scrollTop ${bottom} of ${max}, ${steps} back to ${backToTop}): ${fling.frames.length} frames, frame p50 ${ms(p(fling.frames, 0.5))}, p95 ${ms(p(fling.frames, 0.95))}, max ${ms(Math.max(...fling.frames))}; long tasks: ${fling.longTasks.length}${fling.longTasks.length ? ` (max ${ms(Math.max(...fling.longTasks))})` : ''}`,
        `drag (101 jumps, a frame apart): frame p50 ${ms(p(drag.frames, 0.5))}, p95 ${ms(p(drag.frames, 0.95))}, max ${ms(Math.max(...drag.frames))}; long tasks: ${drag.longTasks.length}${drag.longTasks.length ? ` (max ${ms(Math.max(...drag.longTasks))})` : ''}`,
        `scrollToAddr (${jumps.length} jumps, call to next frame): median ${ms(p(jumps.map((j) => j.ms), 0.5))}, max ${ms(Math.max(...jumps.map((j) => j.ms)))}`,
        ...rerenders.map((r) => `re-render (${r.kind}): ${r.before} -> ${r.after} rows in ${ms(r.ms)}, cursor row moved ${r.delta}px, on screen: ${r.inView}`),
      ].join('\n');
      console.log(report);
      test.info().annotations.push({ type: 'perf', description: report });

      expect(bottom).toBeGreaterThanOrEqual(max - 1);
      expect(backToTop).toBe(0);
      // The timings are held to their limits only with FUGLOY_PERF=1 (run locally): a shared CI
      // runner is too noisy for them, so CI checks only what the listing does, not how fast.
      if (PERF) {
        expect(fling.longTasks.filter((d) => d > 50)).toEqual([]);
        expect(drag.longTasks.filter((d) => d > 50)).toEqual([]);
      }
      for (const j of jumps) {
        expect(j.inView, `$${j.addr.toString(16)} in view`).toBe(true);
        if (PERF) expect(j.ms).toBeLessThan(100);
      }
      for (const r of rerenders) {
        expect(r.after).not.toBe(r.before);
        expect(r.inView, `cursor on screen after ${r.kind}`).toBe(true);
      }
    });
  });
}

// The ListingView contracts the perf numbers rest on, on a real example (no samples needed).
test.describe('ListingView anchoring (seadrg01)', () => {
  test('a cursor on a labelled address stays put across re-renders', async ({ page }) => {
    await openAt49B1(page);
    // $49B1 is L49B1, a jump target: a label row sits above its instruction row.
    await expect(page.locator('.fg-row-label[data-addr="18865"]')).toBeVisible();
    for (const kind of ['names', 'tables', 'tables'] as const) {
      const r = await page.evaluate(async (kind) => {
        const hook = window.__fugloyTest!;
        const raf = (): Promise<void> => new Promise((res) => requestAnimationFrame(() => res()));
        const el = document.querySelector<HTMLElement>('.fg-listing')!;
        hook.setCursor(0x49b1);
        await raf();
        const cursor = (): HTMLElement | null => el.querySelector<HTMLElement>('.fg-row-cursor');
        const before = cursor()!.getBoundingClientRect().top;
        const rows = hook.rowCount();
        hook.rerender(kind);
        await raf();
        const row = cursor()!;
        return { kind, rowsChanged: hook.rowCount() !== rows, addr: row.dataset.addr, kindOfRow: row.className, delta: row.getBoundingClientRect().top - before };
      }, kind);
      expect(r.rowsChanged, `${kind} changed the rows`).toBe(true);
      expect(r.addr).toBe(String(0x49b1));
      expect(r.kindOfRow).toContain('fg-row-code');
      expect(r.delta, `cursor moved after ${kind}`).toBe(0);
    }
  });

  test('the top row stays put across re-renders when the cursor is off screen, label row or not', async ({ page }) => {
    await openAt49B1(page);
    for (const labelOnTop of [true, false]) {
      const r = await page.evaluate(async (labelOnTop) => {
        const hook = window.__fugloyTest!;
        const raf = (): Promise<void> => new Promise((res) => requestAnimationFrame(() => res()));
        const el = document.querySelector<HTMLElement>('.fg-listing')!;
        hook.setCursor(null);
        // Put the L49B1 label row, or the instruction row under it, exactly at the top.
        const label = el.querySelector<HTMLElement>('.fg-row-label[data-addr="18865"]')!;
        const index = Math.round((label.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop) / 20);
        el.scrollTop = (index + (labelOnTop ? 0 : 1)) * 20;
        await raf();
        const topRow = (): HTMLElement => [...el.querySelectorAll<HTMLElement>('.fg-row')].find((row) => Math.abs(row.getBoundingClientRect().top - el.getBoundingClientRect().top) < 1)!;
        const before = topRow().className;
        hook.rerender('tables');
        await raf();
        const after = topRow();
        return { before, after: after.className, addr: after.dataset.addr };
      }, labelOnTop);
      expect(r.addr).toBe(String(0x49b1));
      expect(r.after).toBe(r.before);
    }
  });

  test('scrollToAddr in the same tick as new rows lands on the new rows', async ({ page }) => {
    await openAt49B1(page);
    const results = await page.evaluate(async () => {
      const hook = window.__fugloyTest!;
      const raf = (): Promise<void> => new Promise<void>((res) => requestAnimationFrame(() => res()));
      // Queried each time: a newly opened program gets a new (keyed) ListingView.
      const inView = (target: number): boolean => {
        const el = document.querySelector<HTMLElement>('.fg-listing')!;
        const box = el.getBoundingClientRect();
        return [...el.querySelectorAll<HTMLElement>('.fg-row[data-addr]')].some((row) => {
          const a = Number(row.dataset.addr);
          const b = row.getBoundingClientRect();
          return a <= target && a > target - 4 && b.top >= box.top && b.bottom <= box.bottom;
        });
      };
      const out: Record<string, boolean> = {};
      // No await between the rows change and the call. Same program, new rows:
      hook.rerender('tables');
      hook.scrollToAddr(0x7a00);
      await raf();
      out.tables = inView(0x7a00);
      // A new program with far more rows (5,380 -> about 12,650), opened in the
      // same tick as the call: the scroll reaches the new listing, not the old.
      const bytes = Array.from({ length: 0xc000 }, (_, i) => (i * 7) & 0xff);
      hook.load(bytes, 'raw', undefined, 0x4000);
      hook.scrollToAddr(0xf000);
      await raf();
      out.grown = inView(0xf000);
      return out;
    });
    expect(results).toEqual({ tables: true, grown: true });
  });
});
