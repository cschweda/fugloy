// @vitest-environment happy-dom
// The listing follows the run (phase 5C Rulings 5-7): through one <style id="fg-running-line"> keyed
// on the rows' data-addr, never through the listing components. Only a listing of the program that
// is running follows: the source's own listing, or one whose loaded bytes are the Run's (Open as
// source). The style is rewritten only when the set changes and removed on stop and on Close. A
// pause brings PC's row into view through the page's scrollTo, without moving the cursor or focus;
// while running, only with Follow on, at most 4 times a second, and never while the row is in view.
// F9 and Run to Here act on the listing's cursor line; a listing that does not follow says so.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultDos, renderSession } from '@fugloy/disasm';
import type { Roms } from '../app/composables/useRoms';
import { flushPromises } from '@vue/test-utils';
import { assemble } from '@fugloy/asm';
import type { AsmResult } from '@fugloy/asm';
import * as realKit from '../app/utils/emulator/kit';
import { listingFollows } from '../app/utils/emulator/running';
import { createRun } from '../app/composables/useRun';
import { createSources } from '../app/composables/useSources';
import { createWorkbench } from '../app/composables/useWorkbench';
import { installListingFollow, LISTING_STYLE_ID, listingCss, listingStyleWrites } from '../app/utils/running/listing-style';
import { installDebugKeys, LISTING_CHANGED, LISTING_NOT_RUNNING, LISTING_NOTHING_RUN, LISTING_STOPPED, runToHere } from '../app/utils/running/debug-keys';
import type { DebugKeyOptions } from '../app/utils/running/debug-keys';
import { fakeClock } from './emulator-support';
import { FakeIO, LOOP, noRoms } from './source-run-support';

/** A .CMD of an assembled program: one 01 record per run, then 02 with the entry. */
function cmdOf(result: AsmResult): Uint8Array {
  const out: number[] = [];
  for (const r of result.image!.runs()) {
    for (let a = r.start; a <= r.end; a += 200) {
      const n = Math.min(200, r.end - a + 1);
      out.push(0x01, n + 2, a & 0xff, a >> 8, ...result.image!.bytes.subarray(a, a + n));
    }
  }
  out.push(0x02, 0x02, result.entry! & 0xff, result.entry! >> 8);
  return Uint8Array.from(out);
}

const WAIT = '        ORG     7000H\nSTART:  LD      A,1\nWAIT:   JR      WAIT\n        END     START\n';
const OTHER = '        ORG     8000H\nGO:     LD      B,2\n        JR      GO\n        END     GO\n';
// LOOP's lines: 2 LD A,1 at $7000, 4 INC A at $7002, 5 DEC A at $7003, 6 JR LOOP at $7004.
const A = { start: 0x7000, inc: 0x7002, dec: 0x7003, jr: 0x7004 };

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
  vi.unstubAllGlobals();
  FakeIO.all = [];
  document.head.querySelector(`#${LISTING_STYLE_ID}`)?.remove();
  document.body.innerHTML = '';
});

async function setup(text = LOOP) {
  const sources = createSources({ open: async () => null, starter: async () => text });
  await sources.start();
  const src = await sources.create({ name: 'loop.z', text });
  const wb = createWorkbench({ readExample: async () => null });
  const clock = fakeClock();
  const run = createRun({ sources, roms: noRoms, wb, kit: async () => realKit, runner: clock });
  cleanups.push(() => run.stop());
  const scroll = vi.fn<(addr: number) => void>();
  const uninstall = installListingFollow(run.debug, scroll, { now: clock.now });
  cleanups.push(uninstall);
  return { sources, src, wb, clock, run, scroll };
}

async function frames(clock: ReturnType<typeof fakeClock>, n: number): Promise<void> {
  for (let k = 0; k < n; k++) {
    clock.frame();
    await flushPromises();
  }
}

const style = (): HTMLStyleElement | null => document.getElementById(LISTING_STYLE_ID) as HTMLStyleElement | null;
const sel = (addr: number): string => `[data-addr="${addr}"]`;

/** A listing on the page, with a row for each address; `inView` says which rows are on screen, `shown` whether it is displayed. */
function fakeListing(addrs: number[], inView: (addr: number) => boolean = () => false, shown: () => boolean = () => true): HTMLElement {
  const el = document.createElement('div');
  el.checkVisibility = () => shown();
  el.className = 'fg-listing';
  el.tabIndex = 0;
  el.getBoundingClientRect = () => ({ top: 0, bottom: 400, left: 0, right: 800, height: 400, width: 800, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  for (const a of addrs) {
    const row = document.createElement('div');
    row.className = 'fg-row fg-row-code';
    row.dataset.addr = String(a);
    row.getBoundingClientRect = () => {
      const top = inView(a) ? 100 : 1000;
      return { top, bottom: top + 20, left: 0, right: 800, height: 20, width: 800, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    };
    el.append(row);
  }
  document.body.append(el);
  return el;
}

function keyOpts(over: Partial<DebugKeyOptions> = {}): DebugKeyOptions & { say: ReturnType<typeof vi.fn> } {
  return { runNow: vi.fn(), stop: vi.fn(), say: vi.fn(), ...over } as never;
}
const press = (target: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
};

describe('which listing follows a run', () => {
  it('after a clean Run, the source’s own listing follows', async () => {
    const { run, wb, src, clock } = await setup();
    await run.run();
    await frames(clock, 3);
    expect(wb.origin.value).toEqual({ kind: 'source', sourceId: src.id });
    expect(run.debug.listingFollows.value).toBe(true);
    expect(run.debug.listing.value?.marks.length).toBeGreaterThan(0);
  });

  it('an Open-as-source listing (the same bytes, opened from a file) follows', async () => {
    const { run, wb, clock } = await setup();
    wb.openBytes(cmdOf(assemble(LOOP)), 'loop.cmd');
    expect(wb.origin.value).toBeNull();
    await run.run();
    await frames(clock, 3);
    // The Run does not replace a program opened from a file (5B Ruling 10).
    expect(wb.session.value?.name).toBe('loop.cmd');
    expect(run.debug.listingFollows.value).toBe(true);
    expect(style()?.textContent).toMatch(/data-addr="2867[2-6]"/);
  });

  it('an unrelated program opened from a file does not, and F9 there says so', async () => {
    const { run, wb, clock } = await setup();
    wb.openBytes(cmdOf(assemble(OTHER)), 'other.cmd');
    await run.run();
    await frames(clock, 3);
    expect(run.debug.listingFollows.value).toBe(false);
    expect(run.debug.listing.value).toBeNull();
    expect(style()).toBeNull();
    const opts = keyOpts();
    cleanups.push(installDebugKeys(run.debug, opts));
    const listing = fakeListing([0x8000]);
    wb.cursor.value = 0x8000;
    const e = press(listing, 'F9');
    expect(e.defaultPrevented).toBe(true);
    expect(opts.say).toHaveBeenCalledWith(LISTING_NOT_RUNNING);
    expect(LISTING_NOT_RUNNING).toBe('This listing is not the program that is running. Set breakpoints in Source ✎.');
    expect(run.debug.breakpoints.value).toEqual([]);
  });

  it('listingFollows compares every byte asm loaded, and takes the source’s own listing by origin', () => {
    const r = assemble(LOOP);
    const wb = createWorkbench({ readExample: async () => null });
    wb.openBytes(cmdOf(r), 'loop.cmd');
    const s = wb.session.value!;
    expect(listingFollows(s, r, 'x', null)).toBe(true);
    const changed = assemble(LOOP.replace('LD      A,1', 'LD      A,2'));
    expect(listingFollows(s, changed, 'x', null)).toBe(false);
    expect(listingFollows(s, changed, 'x', { kind: 'source', sourceId: 'x' })).toBe(true);
    expect(listingFollows(s, changed, 'x', { kind: 'source', sourceId: 'y' })).toBe(false);
  });
});

describe('the listing’s <style>', () => {
  it('names now, the trail, and the breakpoints by data-addr', async () => {
    const { run, clock } = await setup();
    run.debug.toggleBreakpoint(5);
    await run.run();
    await frames(clock, 1);
    // Paused on line 5's breakpoint: the paused row, its breakpoint dot (▶ on it), and the trail.
    const text = style()!.textContent!;
    expect(text).toContain(sel(A.dec));
    expect(text).toMatch(new RegExp(`\\[data-addr="${A.dec}"\\][^{]*\\.fg-col-line::before`));
    expect(text).toContain('▶');
    run.debug.toggleBreakpoint(6);
    run.debug.continue();
    await frames(clock, 1);
    run.debug.pause();
    await flushPromises();
    const after = style()!.textContent!;
    expect(after).toMatch(new RegExp(`\\[data-addr="${A.jr}"\\][^{]*\\.fg-col-line::before`));
    expect(after).toContain('●');
    // The trail: other loop lines than the paused one are named too.
    expect([A.inc, A.dec, A.jr].filter((a) => after.includes(sel(a))).length).toBeGreaterThanOrEqual(2);
    // Every rule is scoped to the listing's code and data rows.
    for (const rule of after.split('}').filter((r) => r.trim() !== '')) expect(rule).toContain('.fg-listing :is(.fg-row-code,.fg-row-data)[data-addr=');
  });

  it('is written once for an unchanged set', async () => {
    const { run, clock } = await setup(WAIT);
    await run.run();
    await frames(clock, 3);
    const before = listingStyleWrites();
    await frames(clock, 10);
    expect(listingStyleWrites() - before).toBe(0);
    expect(style()!.textContent).toContain(sel(0x7002));
  });

  it('is removed on stop, and on Close', async () => {
    const { run, wb, clock } = await setup();
    await run.run();
    await frames(clock, 2);
    expect(style()).not.toBeNull();
    run.stop();
    await flushPromises();
    expect(style()).toBeNull();
    await run.run();
    await frames(clock, 2);
    expect(style()).not.toBeNull();
    wb.close();
    await flushPromises();
    expect(style()).toBeNull();
  });

  it('is removed when the follower is uninstalled', async () => {
    const { run, clock } = await setup();
    await run.run();
    await frames(clock, 2);
    expect(style()).not.toBeNull();
    cleanups.pop()!();
    expect(style()).toBeNull();
  });

  it('listingCss gives the paused row a solid band and bar, and a breakpoint a dot', () => {
    const css = listingCss({ marks: [{ addr: 10, class: 'fg-run-paused' }, { addr: 12, class: 'fg-run-trail-1' }], breaks: [10, 14] });
    expect(css).toContain(`${sel(10)}{`);
    expect(css).toMatch(/\[data-addr="10"\]\{[^}]*box-shadow:inset 3px 0 0/);
    expect(css).toMatch(/\[data-addr="14"\] \.fg-col-line::before\{content:"●"/);
    expect(css).toMatch(/\[data-addr="10"\] \.fg-col-line::before\{content:"▶"/);
    expect(listingCss({ marks: [], breaks: [] })).toBe('');
  });
});

describe('scrolling the listing', () => {
  it('a pause scrolls to PC’s row through scrollListing; the cursor and focus stay', async () => {
    const { run, wb, clock, scroll } = await setup();
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();
    wb.cursor.value = null;
    run.debug.toggleBreakpoint(5);
    await run.run();
    await frames(clock, 1);
    expect(run.debug.mode.value).toBe('paused');
    expect(scroll).toHaveBeenCalledWith(A.dec);
    expect(wb.cursor.value).toBeNull();
    expect(document.activeElement).toBe(button);
    scroll.mockClear();
    run.debug.step();
    await flushPromises();
    expect(scroll).toHaveBeenCalledWith(A.jr);
  });

  it('while running: no scroll with Follow off; with it on, at most 4 a second, none while the row is in view', async () => {
    const { run, clock, scroll } = await setup();
    let visible = false;
    fakeListing([A.start, A.inc, A.dec, A.jr], () => visible);
    await run.run();
    await frames(clock, 59);
    expect(scroll).not.toHaveBeenCalled();
    run.debug.follow.value = true;
    await frames(clock, 59); // under a second
    expect(scroll.mock.calls.length).toBeGreaterThan(0);
    expect(scroll.mock.calls.length).toBeLessThanOrEqual(4);
    scroll.mockClear();
    visible = true;
    await frames(clock, 60);
    expect(scroll).not.toHaveBeenCalled();
  });

  it('a listing that does not follow is never scrolled', async () => {
    const { run, wb, clock, scroll } = await setup();
    wb.openBytes(cmdOf(assemble(OTHER)), 'other.cmd');
    run.debug.toggleBreakpoint(5);
    await run.run();
    await frames(clock, 1);
    expect(run.debug.mode.value).toBe('paused');
    expect(scroll).not.toHaveBeenCalled();
  });
});

describe('F9 and Run to Here from the listing', () => {
  it('F9 on the listing toggles the cursor row’s source line', async () => {
    const { run, wb, clock } = await setup();
    await run.run();
    await frames(clock, 2);
    const opts = keyOpts();
    cleanups.push(installDebugKeys(run.debug, opts));
    const listing = fakeListing([A.start, A.inc, A.dec, A.jr]);
    wb.cursor.value = A.dec;
    expect(run.debug.listingLine()).toBe(5);
    expect(press(listing, 'F9').defaultPrevented).toBe(true);
    expect(run.debug.breakpoints.value).toEqual([5]);
    press(listing, 'F9');
    expect(run.debug.breakpoints.value).toEqual([]);
    expect(opts.say).not.toHaveBeenCalled();
  });

  it('Ctrl+F10 on the listing runs to the cursor row’s line', async () => {
    const { run, wb, clock } = await setup();
    await run.run();
    await frames(clock, 2);
    cleanups.push(installDebugKeys(run.debug, keyOpts()));
    const listing = fakeListing([A.start, A.inc, A.dec, A.jr]);
    wb.cursor.value = A.inc;
    expect(press(listing, 'F10', { ctrlKey: true }).defaultPrevented).toBe(true);
    await frames(clock, 1);
    expect(run.debug.mode.value).toBe('paused');
    expect(run.debug.reveal.value?.line).toBe(4);
  });

  it('Run to Here from a button goes to the listing’s line when focus was last there', async () => {
    const { run, wb, clock } = await setup();
    await run.run();
    await frames(clock, 2);
    const opts = keyOpts();
    cleanups.push(installDebugKeys(run.debug, opts));
    const listing = fakeListing([A.start, A.inc, A.dec, A.jr]);
    listing.focus();
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();
    wb.cursor.value = A.inc;
    expect(runToHere(run.debug, opts)).toBeNull();
    await frames(clock, 1);
    expect(run.debug.reveal.value?.line).toBe(4);
  });
});

describe('fix round 1', () => {
  it('a pause while the listing is hidden scrolls once it shows; a resume first drops it', async () => {
    vi.stubGlobal('IntersectionObserver', FakeIO);
    const { run, clock, scroll } = await setup();
    let shown = false;
    fakeListing([A.start, A.inc, A.dec, A.jr], () => false, () => shown);
    run.debug.toggleBreakpoint(5);
    await run.run();
    await frames(clock, 1);
    expect(run.debug.mode.value).toBe('paused');
    expect(scroll).not.toHaveBeenCalled();
    shown = true;
    FakeIO.show();
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenCalledWith(A.dec);
    FakeIO.show();
    expect(scroll).toHaveBeenCalledTimes(1);
    // Hidden again, paused again by a step, then resumed before the listing shows: no stale scroll.
    shown = false;
    run.debug.step();
    await flushPromises();
    expect(scroll).toHaveBeenCalledTimes(1);
    run.debug.toggleBreakpoint(5); // off, so the loop runs on
    run.debug.continue();
    await frames(clock, 1);
    expect(run.debug.mode.value).toBe('running');
    shown = true;
    FakeIO.show();
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it('after an edit, the listing shows only the breakpoints emu holds: none on a data line', async () => {
    const text = LOOP.replace('        END     START', 'DATA:   DB      5\n        END     START');
    const { run, sources, src, clock } = await setup(text);
    run.debug.toggleBreakpoint(5);
    run.debug.toggleBreakpoint(7); // DB 5, at $7006: no instruction to stop at
    await run.run();
    await frames(clock, 1);
    expect(run.debug.inactive.value).toEqual([7]);
    expect(run.debug.listing.value?.breaks).toEqual([A.dec]);
    sources.update(src.id, { text: `${text}; edited\n` });
    await flushPromises();
    expect(run.debug.dirty.value).toBe(true);
    expect(run.debug.inactive.value).toEqual([]);
    expect(run.debug.listing.value?.breaks).toEqual([A.dec]);
  });

  it('F9 in the listing: before any Run, after a stop, and after an edit, it refuses with its sentence and toggles nothing', async () => {
    const { run, wb, sources, src, clock } = await setup();
    const opts = keyOpts();
    cleanups.push(installDebugKeys(run.debug, opts));
    // Before any Run: an unrelated listing, nothing running.
    wb.openBytes(cmdOf(assemble(LOOP)), 'loop.cmd');
    const listing = fakeListing([A.start, A.inc, A.dec, A.jr]);
    wb.cursor.value = A.dec;
    expect(press(listing, 'F9').defaultPrevented).toBe(true);
    expect(opts.say).toHaveBeenLastCalledWith(LISTING_NOTHING_RUN);
    await run.run();
    await frames(clock, 2);
    // Edited since the Run: the lines no longer match.
    sources.update(src.id, { text: `${LOOP}; edited\n` });
    await flushPromises();
    press(listing, 'F9');
    expect(opts.say).toHaveBeenLastCalledWith(LISTING_CHANGED);
    sources.update(src.id, { text: LOOP });
    await flushPromises();
    // Stopped: the listing shows no marks, so F9 there says so rather than toggling unseen.
    run.stop();
    await flushPromises();
    press(listing, 'F9');
    expect(opts.say).toHaveBeenLastCalledWith(LISTING_STOPPED);
    expect(run.debug.breakpoints.value).toEqual([]);
    expect(LISTING_STOPPED).toMatch(/^The program has stopped.*Source ✎, or press Run first\.$/);
  });

  it('Follow switched on scrolls at once when the running line is out of view, without waiting for it to move', async () => {
    const { run, clock, scroll } = await setup(WAIT);
    fakeListing([0x7000, 0x7002]);
    await run.run();
    await frames(clock, 10);
    expect(scroll).not.toHaveBeenCalled();
    run.debug.follow.value = true;
    await flushPromises();
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenCalledWith(0x7002);
  });

  it('an image with no loaded bytes follows no listing', () => {
    const wb = createWorkbench({ readExample: async () => null });
    wb.openBytes(cmdOf(assemble(LOOP)), 'loop.cmd');
    const empty = assemble('        ORG     7000H\nX       EQU     1\n        END\n');
    expect(empty.image?.runs().length ?? 0).toBe(0);
    expect(listingFollows(wb.session.value, empty, 'x', null)).toBe(false);
  });
});

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
/** The ROM fugloy.mcp.json (or $FUGLOY_CONFIG) names under `roms.model3`; null when there is none. */
function configuredRom(): Uint8Array | null {
  const config = process.env.FUGLOY_CONFIG || resolve(repo, 'fugloy.mcp.json');
  if (!existsSync(config)) return null;
  const entry = (JSON.parse(readFileSync(config, 'utf8')).roms ?? {}).model3 as string | undefined;
  if (entry === undefined) return null;
  const path = isAbsolute(entry) ? entry : resolve(dirname(config), entry);
  return existsSync(path) ? new Uint8Array(readFileSync(path)) : null;
}
const rom = configuredRom();

describe.skipIf(rom === null)('Sea Dragon, opened as source, on the real Model III ROM', { timeout: 120_000 }, () => {
  it('the disassembly follows the run, relocated code included, and a pause scrolls to its row', async () => {
    const wb = createWorkbench({ readExample: async () => null });
    wb.openBytes(new Uint8Array(readFileSync(resolve(repo, 'examples/sea-dragon/seadrg01.cmd'))), 'seadrg01.cmd', {
      selection: { machine: 3, dos: defaultDos(3) },
      hintText: readFileSync(resolve(repo, 'examples/sea-dragon/seadrg01.hints'), 'utf8'),
      hintSource: 'seadrg01.hints',
    });
    const session = wb.session.value!;
    const sources = createSources({ open: async () => null });
    await sources.start();
    // Open as source ✎: the zmac text of the disassembly, a source of its own; the listing stays.
    await sources.fromSession(session, renderSession(session, 'zmac'));
    const roms: Roms = { ...noRoms, have: (m) => m === 3, bytes: async (m) => (m === 3 ? rom : null) };
    const clock = fakeClock();
    const run = createRun({ sources, roms, wb, kit: async () => realKit, runner: clock });
    cleanups.push(() => run.stop());
    const scroll = vi.fn<(addr: number) => void>();
    cleanups.push(installListingFollow(run.debug, scroll, { now: clock.now }));
    await run.run();
    expect(run.message.value).toBe('Running on your Model III ROM.');
    expect(wb.session.value).toBe(session);
    const title = 'BY: Wayne Westmoreland & Terry Gilman';
    const screen = (): string => run.runner.value!.machine.video.text().join('\n');
    for (let k = 0; k < 600 && !screen().includes(title); k++) clock.frame();
    await flushPromises();
    expect(screen()).toContain(title);
    expect(run.debug.listingFollows.value).toBe(true);

    // The marks name rows the listing has: the game runs at $497F up, where the file put it at $5200.
    const codeRows = new Set(wb.rows.value.filter((r) => r.kind === 'code').map((r) => (r as { addr: number }).addr));
    const marks = run.debug.listing.value!.marks;
    expect(marks.length).toBeGreaterThan(0);
    for (const mk of marks) expect(codeRows.has(mk.addr)).toBe(true);
    // At least one of the program's lines lit is in relocated code: its run address is not where it loads.
    const relocated = marks.filter((mk) => mk.addr >= 0x497f && mk.addr < 0x8881);
    expect(relocated.length).toBeGreaterThan(0);
    expect(style()!.textContent).toContain(sel(relocated[0]!.addr));

    // A pause scrolls the disassembly to the paused row (or the ROM routine's caller).
    run.debug.pause();
    await flushPromises();
    const line = run.debug.reveal.value!.line!;
    const addr = run.debug.listingAddr(line)!;
    expect(scroll).toHaveBeenLastCalledWith(addr);
    expect(codeRows.has(addr)).toBe(true);
  });

  it('a breakpoint on the print routine ($6140, relocated code) stops on its own line', async () => {
    const wb = createWorkbench({ readExample: async () => null });
    wb.openBytes(new Uint8Array(readFileSync(resolve(repo, 'examples/sea-dragon/seadrg01.cmd'))), 'seadrg01.cmd', {
      selection: { machine: 3, dos: defaultDos(3) },
      hintText: readFileSync(resolve(repo, 'examples/sea-dragon/seadrg01.hints'), 'utf8'),
      hintSource: 'seadrg01.hints',
    });
    const session = wb.session.value!;
    const sources = createSources({ open: async () => null });
    await sources.start();
    await sources.fromSession(session, renderSession(session, 'zmac'));
    const roms: Roms = { ...noRoms, have: (m) => m === 3, bytes: async (m) => (m === 3 ? rom : null) };
    const clock = fakeClock();
    const run = createRun({ sources, roms, wb, kit: async () => realKit, runner: clock });
    cleanups.push(() => run.stop());
    const scroll = vi.fn<(addr: number) => void>();
    cleanups.push(installListingFollow(run.debug, scroll, { now: clock.now }));
    await run.run();
    // The hints name the routine PRINT_TEXT; it loads at $69C1 and runs at $6140.
    const result = run.lastResult.value!;
    const line = result.sourceMap.lineOf(0x6140)!;
    expect(line).not.toBeNull();
    const text = sources.current.value!.text.split('\n');
    expect(text.slice(Math.max(0, line - 3), line).join('\n')).toContain('PRINT_TEXT');
    run.debug.toggleBreakpoint(line);
    await flushPromises();
    expect(run.debug.inactive.value).toEqual([]);
    for (let k = 0; k < 600 && run.debug.mode.value !== 'paused'; k++) {
      clock.frame();
      await flushPromises();
    }
    expect(run.debug.mode.value).toBe('paused');
    expect(run.runner.value!.machine.cpu.regs.pc).toBe(0x6140);
    expect(run.debug.reveal.value!.line).toBe(line);
    expect(run.message.value).toMatch(new RegExp(`^Paused at line ${line}, .*, at a breakpoint\\.$`));
    // The listing follows: its paused row is the routine's, with the breakpoint's dot, and it scrolled there.
    expect(run.debug.listing.value!.marks).toContainEqual({ addr: 0x6140, class: 'fg-run-paused' });
    expect(run.debug.listing.value!.breaks).toEqual([0x6140]);
    expect(scroll).toHaveBeenLastCalledWith(0x6140);
  });
});
