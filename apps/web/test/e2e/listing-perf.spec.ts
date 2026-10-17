// The plan's named risk for phase 4: a listing of 8,000+ rows must scroll
// smoothly, jump to an address fast, and keep the cursor row on screen when the
// rows change. Runs against the generated site through the temporary demo on the
// index page. asylum16 (gitignored) is used when it is present; the raw 48K load
// needs nothing outside the repo.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const repo = (path: string): string => fileURLToPath(new URL(`../../../../${path}`, import.meta.url));
const ASYLUM = repo('fixtures/real/Asylum (1981)(Frank Corr & William F Denman Jr-Med Systems Software)[CMD]/asylum16.cmd');
const ASYLUM_HINTS = repo('fixtures/hints/asylum16.hints');

declare global {
  interface Window {
    __longTasks: number[];
    /** Set by the demo on the index page (app/pages/index.vue). */
    __fugloyDemo?: {
      rowCount: () => number;
      scrollToAddr: (addr: number) => void;
      setCursor: (addr: number | null) => void;
      rerender: (kind: 'tables' | 'names') => void;
      load: (bytes: number[], name: string, hints?: string) => void;
    };
  }
}

interface Case {
  name: string;
  url: string;
  /** A program the test reads itself and hands to the open demo (the page fetches nothing but its bundled examples). */
  input?: () => { bytes: number[]; name: string; hints: string };
  /** Addresses to jump to: row starts and addresses inside rows. */
  jumps: number[];
  available: boolean;
}

const spread = (from: number, to: number, n: number): number[] => Array.from({ length: n }, (_, i) => from + Math.floor(((to - from) * (i + 0.5)) / n));

const CASES: Case[] = [
  { name: 'raw 48K load of seadrg01', url: '/?demo=raw48', jumps: spread(0x4000, 0xffff, 12), available: true },
  {
    name: 'asylum16 with its hints',
    url: '/?demo=seadrg01',
    input: () => ({ bytes: Array.from(readFileSync(ASYLUM)), name: 'asylum16.cmd', hints: readFileSync(ASYLUM_HINTS, 'utf8') }),
    jumps: spread(0x42f3, 0x7ff6, 12),
    available: existsSync(ASYLUM) && existsSync(ASYLUM_HINTS),
  },
];

async function openDemo(page: Page, c: Case): Promise<number> {
  await page.addInitScript(() => {
    window.__longTasks = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__longTasks.push(e.duration);
    }).observe({ type: 'longtask', buffered: true });
  });
  await page.goto(c.url);
  await page.waitForFunction(() => window.__fugloyDemo !== undefined, undefined, { timeout: 30_000 });
  if (c.input !== undefined) {
    await page.evaluate(({ bytes, name, hints }) => window.__fugloyDemo!.load(bytes, name, hints), c.input());
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  }
  return page.evaluate(() => window.__fugloyDemo!.rowCount());
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
      const count = await openDemo(page, c);
      expect(count).toBeGreaterThan(c.name.startsWith('raw') ? 8000 : 1000);
      const listing = page.locator('.fg-listing');
      await listing.hover();

      // Fling: bursts of large wheel deltas down the whole listing and back up.
      const fling = await measure(page, async () => {
        for (let i = 0; i < 80; i++) await page.mouse.wheel(0, 2400);
        for (let i = 0; i < 80; i++) await page.mouse.wheel(0, -2400);
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
          window.__fugloyDemo!.scrollToAddr(addr);
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
            const demo = window.__fugloyDemo!;
            const el = document.querySelector<HTMLElement>('.fg-listing')!;
            const raf = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));
            demo.setCursor(addr);
            demo.scrollToAddr(addr);
            await raf();
            await raf();
            const before = demo.rowCount();
            const cursorTop = (): number | null => el.querySelector('.fg-row-cursor')?.getBoundingClientRect().top ?? null;
            const topBefore = cursorTop();
            const t0 = performance.now();
            demo.rerender(kind);
            await raf();
            const took = performance.now() - t0;
            const box = el.getBoundingClientRect();
            const row = el.querySelector('.fg-row-cursor');
            const r = row?.getBoundingClientRect();
            return {
              kind,
              before,
              after: demo.rowCount(),
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
        `fling (160 wheel steps of 2400px): ${fling.frames.length} frames, frame p50 ${ms(p(fling.frames, 0.5))}, p95 ${ms(p(fling.frames, 0.95))}, max ${ms(Math.max(...fling.frames))}; long tasks: ${fling.longTasks.length}${fling.longTasks.length ? ` (max ${ms(Math.max(...fling.longTasks))})` : ''}`,
        `drag (101 jumps, a frame apart): frame p50 ${ms(p(drag.frames, 0.5))}, p95 ${ms(p(drag.frames, 0.95))}, max ${ms(Math.max(...drag.frames))}; long tasks: ${drag.longTasks.length}${drag.longTasks.length ? ` (max ${ms(Math.max(...drag.longTasks))})` : ''}`,
        `scrollToAddr (${jumps.length} jumps, call to next frame): median ${ms(p(jumps.map((j) => j.ms), 0.5))}, max ${ms(Math.max(...jumps.map((j) => j.ms)))}`,
        ...rerenders.map((r) => `re-render (${r.kind}): ${r.before} -> ${r.after} rows in ${ms(r.ms)}, cursor row moved ${r.delta}px, on screen: ${r.inView}`),
      ].join('\n');
      console.log(report);
      test.info().annotations.push({ type: 'perf', description: report });

      expect(fling.longTasks.filter((d) => d > 50)).toEqual([]);
      expect(drag.longTasks.filter((d) => d > 50)).toEqual([]);
      for (const j of jumps) {
        expect(j.inView, `$${j.addr.toString(16)} in view`).toBe(true);
        expect(j.ms).toBeLessThan(100);
      }
      for (const r of rerenders) {
        expect(r.after).not.toBe(r.before);
        expect(r.inView, `cursor on screen after ${r.kind}`).toBe(true);
      }
    });
  });
}
