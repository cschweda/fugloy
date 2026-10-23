// @vitest-environment happy-dom
// The running line in Source ✎ (phase 5C Rulings 2-4 and 7), through useDebug: a CodeMirror
// dispatch only when the set of marks changes, at most 30 a second, none while the panel is hidden
// (the latest set once it shows); an edit after Run hides the marks and says why; a pause brings
// the paused line into view without moving the selection.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { computed, effectScope, shallowRef, watch } from 'vue';
import * as realKit from '../app/utils/emulator/kit';
import { createDebug } from '../app/composables/useDebug';
import type { DebugControl } from '../app/composables/useDebug';
import { createRun, STOPPED_SOURCE } from '../app/composables/useRun';
import { createSources } from '../app/composables/useSources';
import type { Sources } from '../app/composables/useSources';
import { createWorkbench } from '../app/composables/useWorkbench';
import type { Runner } from '../app/utils/emulator/runner';
import { runPatched, runStub } from './emulator-support';
import type { Holder } from './source-run-support';
import { clickGutter, FakeIO, gutterMarks, LOOP, mountSource, noRoms, prepare } from './source-run-support';

const holder: Holder = { sources: null, run: null };
vi.mock('../app/composables/useSources', async (orig) => ({
  ...(await orig<typeof import('../app/composables/useSources')>()),
  useSources: () => holder.sources,
}));
vi.mock('../app/composables/useRun', async (orig) => ({
  ...(await orig<typeof import('../app/composables/useRun')>()),
  useRun: () => holder.run,
}));
const { default: SourceTab } = await import('../app/components/source/SourceTab.vue');

const stopSelectionChange = (e: Event): void => e.stopImmediatePropagation();
window.addEventListener('selectionchange', stopSelectionChange, true);

const CHANGED = 'The source has changed since this Run, so the running line is not shown. Press Run to see it again.';

let w: VueWrapper | null = null;
beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', FakeIO);
});
afterEach(() => {
  holder.run?.stop();
  w?.unmount();
  w = null;
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('the running line in Source', () => {
  it('ten frames with the same marks make exactly one dispatch', async () => {
    // One line that loops on itself: every frame's window holds only it.
    const text = '        ORG     7000H\nSTART:  LD      A,1\nWAIT:   JR      WAIT\n        END     START\n';
    const { clock } = await prepare(holder, text);
    const m = await mountSource(SourceTab, holder, clock);
    w = m.w;
    await m.run.run();
    await flushPromises();
    // The Run's start shows the entry line; from then on, the loop.
    expect(m.sent).toEqual([[{ line: 2, class: 'fg-run-now' }]]);
    m.sent.length = 0;
    for (let k = 0; k < 10; k++) {
      clock.frame();
      await flushPromises();
    }
    expect(m.sent).toEqual([[{ line: 3, class: 'fg-run-now' }]]);
    expect(m.view().dom.querySelector('.cm-line.fg-run-now')?.textContent).toContain('JR');
  });

  it('ten changing frames within 100 ms make at most 3 dispatches (30 a second)', async () => {
    let k = 0;
    // A runner whose marks change every frame.
    const kit = { ...realKit, trailOf: () => ({ now: 4 + (k++ % 3), trail: [], out: null }) };
    const { clock } = await prepare(holder, LOOP, { kit });
    const m = await mountSource(SourceTab, holder, clock);
    w = m.w;
    await m.run.run();
    for (let f = 0; f < 10; f++) {
      clock.frame(10);
      await flushPromises();
    }
    expect(clock.now()).toBe(100);
    expect(m.sent.length).toBeGreaterThan(0);
    expect(m.sent.length).toBeLessThanOrEqual(3);
  });

  it('a hidden panel gets no dispatch, then the latest set once it shows', async () => {
    let k = 0;
    const kit = { ...realKit, trailOf: () => ({ now: 4 + (k++ % 3), trail: [], out: null }) };
    const { clock } = await prepare(holder, LOOP, { kit });
    const host = document.createElement('div');
    const m = await mountSource(SourceTab, holder, clock, host);
    w = m.w;
    host.style.display = 'none';
    await m.run.run();
    for (let f = 0; f < 10; f++) {
      clock.frame();
      await flushPromises();
    }
    expect(m.sent).toEqual([]);
    const latest = m.run.debug.marks.value;
    expect(latest.length).toBe(1);
    host.style.display = '';
    FakeIO.show();
    await flushPromises();
    expect(m.sent).toEqual([latest]);
  });

  it('an edit after Run clears the marks and says why; Run shows them again', async () => {
    const { clock } = await prepare(holder, LOOP);
    const m = await mountSource(SourceTab, holder, clock);
    w = m.w;
    await m.run.run();
    clock.frame();
    await flushPromises();
    expect(m.sent.at(-1)!.length).toBeGreaterThan(0);
    expect(m.w.find('[data-testid="source-run-changed"]').exists()).toBe(false);
    const v = m.view();
    v.dispatch({ changes: { from: v.state.doc.length, insert: '; more\n' }, userEvent: 'input.type' });
    await flushPromises();
    expect(m.sent.at(-1)).toEqual([]);
    expect(v.dom.querySelector('[class*="fg-run-"]')).toBeNull();
    expect(m.w.get('[data-testid="source-run-changed"]').text()).toBe(CHANGED);
    // The listing still has the running program's marks.
    expect(m.run.debug.marks.value.length).toBeGreaterThan(0);
    await m.run.run();
    clock.frame();
    await flushPromises();
    expect(m.w.find('[data-testid="source-run-changed"]').exists()).toBe(false);
    expect(m.sent.at(-1)!.length).toBeGreaterThan(0);
  });

  it('a pause at a breakpoint lights the line, puts ▶ in the gutter, and scrolls to it without moving the selection', async () => {
    const { clock } = await prepare(holder, LOOP);
    const m = await mountSource(SourceTab, holder, clock);
    w = m.w;
    const v = m.view();
    v.dispatch({ selection: { anchor: v.state.doc.line(1).from } });
    clickGutter(v, 5);
    await flushPromises();
    await m.run.run();
    const before = m.transactions.length;
    clock.frame();
    await flushPromises();
    expect(m.run.debug.mode.value).toBe('paused');
    expect(m.run.debug.marks.value.find((x) => x.class === 'fg-run-paused')?.line).toBe(5);
    expect(v.dom.querySelector('.cm-line.fg-run-paused')?.textContent).toContain('DEC');
    // One mark on the paused breakpoint line: ▶ in place of ●, the cell tinted.
    expect(gutterMarks(v)).toEqual([{ text: '▶', title: 'Paused here, at a breakpoint. Click to remove the breakpoint.' }]);
    expect(v.dom.querySelector('.fg-bp-gutter .cm-gutterElement.fg-bp-pc-line .fg-bp-pc-break')).not.toBeNull();
    // A scroll to line 5's start, and the selection where it was.
    const scrolls = m.transactions.slice(before).filter((tr) => tr.effects.some((e) => (e.value as { range?: { from: number } } | null)?.range?.from === v.state.doc.line(5).from));
    expect(scrolls.length).toBe(1);
    expect(v.state.selection.main.head).toBe(0);
    expect(m.transactions.slice(before).every((tr) => !tr.selection)).toBe(true);
  });

  it('a paused stop names the line in run.message, and a step moves the paused line', async () => {
    const { clock } = await prepare(holder, LOOP);
    const m = await mountSource(SourceTab, holder, clock);
    w = m.w;
    clickGutter(m.view(), 5);
    await flushPromises();
    await m.run.run();
    clock.frame();
    await flushPromises();
    expect(m.run.debug.announce.value).toBe('Paused at line 5, DEC A, at a breakpoint.');
    expect(m.run.message.value).toBe('Paused at line 5, DEC A, at a breakpoint.');
    m.run.debug.step();
    await flushPromises();
    expect(m.run.debug.marks.value.find((x) => x.class === 'fg-run-paused')?.line).toBe(6);
    // The breakpoint keeps its ● on line 5, and ▶ moves to line 6.
    expect(gutterMarks(m.view())).toEqual([
      { text: '●', title: expect.stringMatching(/^Breakpoint/) },
      { text: '▶', title: 'Paused here.' },
    ]);
    expect(m.run.debug.announce.value).toBe('Line 6, JR LOOP. Changed: A, F.');
    m.run.debug.continue();
    expect(m.run.debug.mode.value).toBe('running');
    clock.frame();
    expect(m.run.debug.mode.value).toBe('paused');
  });
});

describe('the running line in Source: a pause seen later', () => {
  /** Transactions that scroll to the start of `line`. */
  const scrollsTo = (m: Awaited<ReturnType<typeof mountSource>>, from: number, line: number): number =>
    m.transactions.slice(from).filter((tr) => tr.effects.some((e) => (e.value as { range?: { from: number } } | null)?.range?.from === m.view().state.doc.line(line).from)).length;

  it('a pause while hidden scrolls once the panel shows, but not after the program resumed', async () => {
    const { clock } = await prepare(holder, LOOP);
    const host = document.createElement('div');
    const m = await mountSource(SourceTab, holder, clock, host);
    w = m.w;
    clickGutter(m.view(), 5);
    await flushPromises();
    host.style.display = 'none';
    await m.run.run();
    clock.frame();
    await flushPromises();
    expect(m.run.debug.mode.value).toBe('paused');
    // Shown while still paused: the scroll happens now.
    let from = m.transactions.length;
    host.style.display = '';
    FakeIO.show();
    await flushPromises();
    expect(scrollsTo(m, from, 5)).toBe(1);
    // Hidden, paused again, resumed before it shows: no stale scroll.
    host.style.display = 'none';
    m.run.debug.continue();
    clock.frame();
    await flushPromises();
    expect(m.run.debug.mode.value).toBe('paused');
    m.run.debug.continue();
    await flushPromises();
    from = m.transactions.length;
    host.style.display = '';
    FakeIO.show();
    await flushPromises();
    expect(scrollsTo(m, from, 5)).toBe(0);
  });

  it('a pause while hidden does not scroll after the text was edited', async () => {
    const { clock } = await prepare(holder, LOOP);
    const host = document.createElement('div');
    const m = await mountSource(SourceTab, holder, clock, host);
    w = m.w;
    clickGutter(m.view(), 5);
    await flushPromises();
    host.style.display = 'none';
    await m.run.run();
    clock.frame();
    await flushPromises();
    const v = m.view();
    v.dispatch({ changes: { from: 0, insert: '; new first line\n' }, userEvent: 'input.type' });
    await flushPromises();
    const from = m.transactions.length;
    host.style.display = '';
    FakeIO.show();
    await flushPromises();
    expect(scrollsTo(m, from, 5)).toBe(0);
    expect(scrollsTo(m, from, 6)).toBe(0);
  });
});

/** A source that useDebug sees as the one on screen. */
function oneSource(text: string): Sources {
  const src = shallowRef({ id: 's', name: 'loop.z', text, model: 3 as const, savedAt: 0, breakpoints: [] as number[] });
  return { current: computed(() => src.value), update: () => {} } as unknown as Sources;
}

/** A fake prefers-reduced-motion query whose `change` the test fires. */
function motionQuery(matches: boolean) {
  const listeners: ((e: { matches: boolean }) => void)[] = [];
  const mq = {
    matches,
    addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => listeners.push(cb),
    fire(next: boolean) {
      mq.matches = next;
      for (const cb of listeners) cb({ matches: next });
    },
  };
  return mq;
}

/**
 * useDebug over a runner on the stub, wired as createRun wires it: started before attach, as useRun
 * does. `model1Rom`: on a Model I ROM instead, the stub with these patches (address → bytes).
 */
function debugOver(text: string, opts: { kit?: typeof realKit; motion?: ReturnType<typeof motionQuery>; breakpoints?: number[]; model1Rom?: Record<number, number[]> } = {}) {
  const kit = opts.kit ?? realKit;
  let dbg!: DebugControl;
  const hooks = { onFrame: (r: Runner) => dbg.frame(r), onPause: (r: Runner) => dbg.paused(r), onStop: (r: Runner) => dbg.stopped(r) };
  const { runner, result, clock } = opts.model1Rom === undefined ? runStub(text, hooks) : runPatched(text, opts.model1Rom, { ...hooks, model: 1 });
  const stepper = realKit.createStepper(runner);
  const { inactive } = stepper.setBreakpoints(opts.breakpoints ?? []);
  dbg = createDebug({ sources: oneSource(text), say: () => {}, state: () => {}, now: clock.now, motionQuery: () => (opts.motion ?? null) as unknown as MediaQueryList | null });
  runner.start();
  dbg.attach({ kit, runner, stepper, result, inactive, sourceId: 's', text });
  return { dbg, runner, clock };
}

describe('useDebug', () => {
  it('a breakpoint on the entry line stops the started runner before its first instruction', () => {
    const { dbg, runner, clock } = debugOver(LOOP, { breakpoints: [2] });
    expect(runner.state).toBe('running');
    expect(dbg.mode.value).toBe('running');
    clock.frame();
    expect(runner.pausedBy?.kind).toBe('break');
    expect(dbg.mode.value).toBe('paused');
    expect(dbg.marks.value.find((x) => x.class === 'fg-run-paused')?.line).toBe(2);
    expect(dbg.announce.value).toBe('Paused at line 2, LD A,1, at a breakpoint.');
  });

  it('a step on a HALT with interrupts on says the CPU is waiting for an interrupt', () => {
    const text = '        ORG     7000H\nSTART:  EI\n        HALT\nWAIT:   JR      WAIT\n        END     START\n';
    const { dbg, runner, clock } = debugOver(text, { breakpoints: [3] });
    clock.frame();
    expect(runner.pausedBy?.kind).toBe('break');
    expect(dbg.announce.value).toBe('Paused at line 3, HALT, at a breakpoint.');
    dbg.step();
    expect(runner.machine.cpu.halted).toBe(true);
    expect(dbg.announce.value).toContain(realKit.HALTED_WAITING);
    dbg.step();
    expect(dbg.announce.value).toContain(realKit.HALTED_WAITING);
    expect(realKit.HALTED_WAITING).toBe('The CPU is halted (HALT), waiting for an interrupt; press Continue to run until one comes.');
  });

  it("on a Model I a step that leaves the CPU halted says its HALT raises an NMI, never that it waits for an interrupt", () => {
    // The Model I's HALT line drives its reset switch's NMI (emu spec §5); its ROM here is the stub with a loop at $0066.
    const text = '        ORG     7000H\nSTART:  EI\n        HALT\nWAIT:   JR      WAIT\n        END     START\n';
    const { dbg, runner, clock } = debugOver(text, { breakpoints: [3], model1Rom: { 0x0066: [0x18, 0xfe] } });
    clock.frame();
    expect(runner.pausedBy?.kind).toBe('break');
    expect(dbg.announce.value).toBe('Paused at line 3, HALT, at a breakpoint.');
    dbg.step();
    expect(runner.machine.cpu.halted).toBe(true);
    // EI's delay ends with the HALT, so IFF1 and IFF2 change on this step.
    expect(dbg.announce.value).toBe(`Line 3, HALT. Changed: IFF1, IFF2. ${realKit.HALTED_NMI}`);
    expect(realKit.HALTED_NMI).toBe("The CPU is halted (HALT), and on the Model I a HALT raises an NMI at the next instruction: the next step or Continue goes to $0066, the ROM's reset.");
    // The next step takes the NMI and runs the instruction at $0066.
    dbg.step();
    expect(runner.machine.cpu.halted).toBe(false);
    expect(runner.pc).toBe(0x0066);
    expect(dbg.announce.value).not.toContain(realKit.HALTED_WAITING);
    expect(dbg.announce.value).not.toContain(realKit.HALTED_NMI);
  });

  it('keeps the same marks array across frames whose set does not change', () => {
    const text = '        ORG     7000H\nSTART:  LD      A,1\nWAIT:   JR      WAIT\n        END     START\n';
    const { dbg, clock } = debugOver(text);
    let replaced = 0;
    watch(dbg.marks, () => replaced++, { flush: 'sync' });
    dbg.continue();
    clock.frame();
    const set = dbg.marks.value;
    expect(set).toEqual([{ line: 3, class: 'fg-run-now' }]);
    const before = replaced;
    for (let k = 0; k < 10; k++) clock.frame();
    expect(dbg.marks.value).toBe(set);
    expect(replaced).toBe(before);
  });

  it('with reduced motion: no trail, and the line moves at most 4 times a second', () => {
    let k = 0;
    const kit = { ...realKit, trailOf: () => ({ now: 4 + (k++ % 3), trail: [2, 3], out: null }) };
    const { dbg, clock } = debugOver(LOOP, { kit, motion: motionQuery(true) });
    expect(dbg.reduced.value).toBe(true);
    let published = 0;
    watch(dbg.marks, () => published++, { flush: 'sync' });
    dbg.continue();
    const classes = new Set<string>();
    for (let f = 0; f < 100; f++) {
      clock.frame(10);
      for (const x of dbg.marks.value) classes.add(x.class);
    }
    expect(clock.now()).toBe(1000);
    expect(published).toBeGreaterThan(1);
    expect(published).toBeLessThanOrEqual(5);
    expect([...classes]).toEqual(['fg-run-now']);
  });

  it('follows the reduced-motion setting as it changes', () => {
    let k = 0;
    const kit = { ...realKit, trailOf: () => ({ now: 4 + (k++ % 3), trail: [2], out: null }) };
    const motion = motionQuery(false);
    const { dbg, clock } = debugOver(LOOP, { kit, motion });
    dbg.continue();
    clock.frame();
    expect(dbg.marks.value.some((x) => x.class === 'fg-run-trail-1')).toBe(true);
    motion.fire(true);
    expect(dbg.reduced.value).toBe(true);
    clock.frame(300);
    expect(dbg.marks.value.some((x) => x.class.startsWith('fg-run-trail'))).toBe(false);
    motion.fire(false);
    expect(dbg.reduced.value).toBe(false);
  });

  it("keeps the Run's watchers alive when the component scope that first asked for it ends", async () => {
    const sources = createSources({ open: async () => null, starter: async () => LOOP });
    await sources.start();
    await sources.create({ name: 'loop.z', text: LOOP });
    const clock = (await import('./emulator-support')).fakeClock();
    const scope = effectScope();
    const run = scope.run(() => createRun({ sources, roms: noRoms, wb: createWorkbench({ readExample: async () => null }), kit: async () => realKit, runner: clock }))!;
    scope.stop();
    await run.run();
    expect(run.state.value).toBe('running');
    // Switching source still stops the program, which only a live watcher does.
    await sources.create({ name: 'other.z', text: LOOP });
    await flushPromises();
    expect(run.state.value).toBe('stopped');
    expect(run.message.value).toBe(STOPPED_SOURCE);
    // And the coordinator's own watcher follows the new source's breakpoints.
    sources.update(sources.current.value!.id, { breakpoints: [4] });
    await flushPromises();
    expect(run.debug.breakpoints.value).toEqual([4]);
  });
});
