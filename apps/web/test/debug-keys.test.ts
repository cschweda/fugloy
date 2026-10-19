// @vitest-environment happy-dom
// The debug keys (phase 5C Ruling 10) and the announcements (Ruling 12): one document listener
// while Source ✎ or Run ▶ is mounted. F10 and F11 (and F7) step while paused and pause while
// running; F5 continues, runs when idle, and is swallowed while running; Shift+F5 stops a program
// under way and is the browser's otherwise; F9 toggles the cursor line's breakpoint in the editor;
// Ctrl/⌘+F10 runs to the cursor line. Nothing fires in a text field or under an open dialog, and
// Shift+F10 is never touched. One visually hidden status region on the body speaks a pause at
// once and a burst of steps once, the last.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref, shallowRef } from 'vue';
import type { Ref } from 'vue';
import starter from '@fugloy/asm-examples/clear-screen.z?raw';
import { assemble } from '@fugloy/asm';
import { inField, installDebugKeys } from '../app/utils/running/debug-keys';
import type { DebugKeyOptions } from '../app/utils/running/debug-keys';
import { announcer, announcing, speakAnnouncements, STEP_DEBOUNCE_MS } from '../app/utils/running/announce';
import type { Debug, DebugMode } from '../app/composables/useDebug';
import { prepareMachine } from '../app/utils/emulator/boot';
import { stubRom } from '../app/utils/emulator/stub-rom';
import TrsScreen from '../app/components/run/TrsScreen.vue';
import type { Holder } from './source-run-support';
import { LOOP, prepare } from './source-run-support';

function fakeDebug(m: DebugMode = 'paused') {
  const mode: Ref<DebugMode> = ref(m);
  return {
    mode,
    announcement: shallowRef(null),
    pause: vi.fn(),
    continue: vi.fn(),
    step: vi.fn(),
    stepOver: vi.fn(),
    toggleBreakpoint: vi.fn(),
    runToLine: vi.fn(),
  } as unknown as Debug & { mode: Ref<DebugMode>; [k: string]: unknown };
}

function options(over: Partial<DebugKeyOptions> = {}): DebugKeyOptions & { runNow: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; say: ReturnType<typeof vi.fn> } {
  return { runNow: vi.fn(), stop: vi.fn(), say: vi.fn(), cursorLine: () => null, ...over } as never;
}

let uninstall: (() => void)[] = [];
let w: VueWrapper | null = null;
const holder: Holder = { sources: null, run: null };
afterEach(() => {
  for (const u of uninstall) u();
  uninstall = [];
  holder.run?.stop();
  w?.unmount();
  w = null;
  vi.useRealTimers();
  document.body.innerHTML = '';
});

function install(debug: Debug, opts: DebugKeyOptions): void {
  uninstall.push(installDebugKeys(debug, opts));
}

const press = (el: EventTarget, init: KeyboardEventInit): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(e);
  return e;
};

/** A page with an editor (CodeMirror's classes), an input, and a button. */
function page(): { editor: HTMLElement; input: HTMLInputElement; button: HTMLButtonElement } {
  document.body.innerHTML = '<div data-own-keys><div class="cm-editor"><div class="cm-content" contenteditable="true" id="ed"></div></div><input id="in"><button id="b">x</button></div>';
  return { editor: document.getElementById('ed')!, input: document.getElementById('in') as HTMLInputElement, button: document.getElementById('b') as HTMLButtonElement };
}

describe('the debug keys', () => {
  it('F10 and F11 (and F7) step while paused, and pause while running', () => {
    const { button } = page();
    const d = fakeDebug('paused');
    install(d, options());
    expect(press(button, { key: 'F10' }).defaultPrevented).toBe(true);
    expect(d.stepOver).toHaveBeenCalledTimes(1);
    expect(press(button, { key: 'F11' }).defaultPrevented).toBe(true);
    expect(press(button, { key: 'F7' }).defaultPrevented).toBe(true);
    expect(d.step).toHaveBeenCalledTimes(2);
    // Running: useDebug's step and stepOver pause first (Ruling 9); the keys call them all the same.
    d.mode.value = 'running';
    expect(press(document.body, { key: 'F10' }).defaultPrevented).toBe(true);
    expect(d.stepOver).toHaveBeenCalledTimes(2);
    expect(press(document.body, { key: 'F6' }).defaultPrevented).toBe(true);
    expect(d.pause).toHaveBeenCalledTimes(1);
    // Idle: not claimed.
    d.mode.value = 'idle';
    expect(press(document.body, { key: 'F10' }).defaultPrevented).toBe(false);
    expect(press(document.body, { key: 'F11' }).defaultPrevented).toBe(false);
    expect(press(document.body, { key: 'F6' }).defaultPrevented).toBe(false);
    expect(d.stepOver).toHaveBeenCalledTimes(2);
  });

  it('F5 continues when paused and runs when idle or stopped; while running it is swallowed and does nothing else', () => {
    page();
    const d = fakeDebug('paused');
    const o = options();
    install(d, o);
    expect(press(document.body, { key: 'F5' }).defaultPrevented).toBe(true);
    expect(d.continue).toHaveBeenCalledTimes(1);
    d.mode.value = 'idle';
    expect(press(document.body, { key: 'F5' }).defaultPrevented).toBe(true);
    d.mode.value = 'stopped';
    expect(press(document.body, { key: 'F5' }).defaultPrevented).toBe(true);
    expect(o.runNow).toHaveBeenCalledTimes(2);
    d.mode.value = 'running';
    expect(press(document.body, { key: 'F5' }).defaultPrevented).toBe(true);
    expect(d.continue).toHaveBeenCalledTimes(1);
    expect(o.runNow).toHaveBeenCalledTimes(2);
    expect(o.stop).not.toHaveBeenCalled();
  });

  it('Shift+F5 stops a program running or paused; when idle it is the browser’s', () => {
    page();
    const d = fakeDebug('running');
    const o = options();
    install(d, o);
    expect(press(document.body, { key: 'F5', shiftKey: true }).defaultPrevented).toBe(true);
    d.mode.value = 'paused';
    expect(press(document.body, { key: 'F5', shiftKey: true }).defaultPrevented).toBe(true);
    expect(o.stop).toHaveBeenCalledTimes(2);
    d.mode.value = 'idle';
    expect(press(document.body, { key: 'F5', shiftKey: true }).defaultPrevented).toBe(false);
    d.mode.value = 'stopped';
    expect(press(document.body, { key: 'F5', shiftKey: true }).defaultPrevented).toBe(false);
    expect(o.stop).toHaveBeenCalledTimes(2);
    expect(o.runNow).not.toHaveBeenCalled();
  });

  it('F9 in the editor toggles the cursor line; Ctrl+F10 and ⌘+F10 run to the cursor line', () => {
    const { editor, button } = page();
    const d = fakeDebug('idle');
    install(d, options({ cursorLine: (where) => (where === 'source' ? 7 : null) }));
    expect(press(editor, { key: 'F9' }).defaultPrevented).toBe(true);
    expect(d.toggleBreakpoint).toHaveBeenCalledWith(7);
    // F9 elsewhere: not the editor's.
    expect(press(button, { key: 'F9' }).defaultPrevented).toBe(false);
    expect(d.toggleBreakpoint).toHaveBeenCalledTimes(1);
    // Ctrl+F10 needs a program under way.
    expect(press(editor, { key: 'F10', ctrlKey: true }).defaultPrevented).toBe(false);
    d.mode.value = 'paused';
    expect(press(editor, { key: 'F10', ctrlKey: true }).defaultPrevented).toBe(true);
    // From a button, the line is where focus was last (Ruling 9).
    expect(press(button, { key: 'F10', metaKey: true }).defaultPrevented).toBe(true);
    expect(d.runToLine).toHaveBeenCalledTimes(2);
    expect(d.runToLine).toHaveBeenCalledWith(7);
    expect(d.stepOver).not.toHaveBeenCalled();
  });

  it('Run to Here with no cursor line says how to give it one', () => {
    page();
    const d = fakeDebug('paused');
    const o = options();
    install(d, o);
    expect(press(document.body, { key: 'F10', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(d.runToLine).not.toHaveBeenCalled();
    expect(o.say).toHaveBeenCalledWith(expect.stringMatching(/^Run to Here runs to the line .*Source ✎.*then press/));
  });

  it('nothing fires in an INPUT or under an open dialog; F5 is still swallowed there while a program is under way', () => {
    const { input } = page();
    const d = fakeDebug('paused');
    const o = options({ cursorLine: () => 3 });
    install(d, o);
    for (const key of ['F10', 'F11', 'F7', 'F9', 'F6']) expect(press(input, { key }).defaultPrevented).toBe(false);
    // A reload would end the program: F5 and Shift+F5 are swallowed, but do not continue or stop.
    expect(press(input, { key: 'F5', shiftKey: true }).defaultPrevented).toBe(true);
    expect(press(input, { key: 'F5' }).defaultPrevented).toBe(true);
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.append(dialog);
    expect(press(document.body, { key: 'F10' }).defaultPrevented).toBe(false);
    expect(press(document.body, { key: 'F5' }).defaultPrevented).toBe(true);
    d.mode.value = 'idle';
    expect(press(document.body, { key: 'F5' }).defaultPrevented).toBe(false);
    expect([d.step, d.stepOver, d.continue, d.toggleBreakpoint, d.pause, o.runNow, o.stop].every((f) => (f as ReturnType<typeof vi.fn>).mock.calls.length === 0)).toBe(true);
  });

  it('Shift+F10, Alt+F-keys, Ctrl+F5 when idle, and an event already handled are left alone', () => {
    page();
    const d = fakeDebug('paused');
    const o = options({ cursorLine: () => 3 });
    install(d, o);
    expect(press(document.body, { key: 'F10', shiftKey: true }).defaultPrevented).toBe(false);
    expect(press(document.body, { key: 'F10', altKey: true }).defaultPrevented).toBe(false);
    d.mode.value = 'idle';
    expect(press(document.body, { key: 'F5', ctrlKey: true }).defaultPrevented).toBe(false);
    d.mode.value = 'paused';
    const handled = new KeyboardEvent('keydown', { key: 'F10', bubbles: true, cancelable: true });
    handled.preventDefault();
    document.body.dispatchEvent(handled);
    expect(d.stepOver).not.toHaveBeenCalled();
    expect(d.runToLine).not.toHaveBeenCalled();
    expect(o.runNow).not.toHaveBeenCalled();
  });

  it('one listener however many tabs install it, removed with the last', () => {
    page();
    const d = fakeDebug('paused');
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const a = installDebugKeys(d, options());
    const b = installDebugKeys(d, options({ cursorLine: () => 4 }));
    expect(add.mock.calls.filter(([t]) => t === 'keydown').length).toBe(1);
    press(document.body, { key: 'F10' });
    expect(d.stepOver).toHaveBeenCalledTimes(1);
    // The one that knows the cursor answers Run to Here.
    press(document.body, { key: 'F10', ctrlKey: true });
    expect(d.runToLine).toHaveBeenCalledWith(4);
    a();
    a();
    press(document.body, { key: 'F10' });
    expect(d.stepOver).toHaveBeenCalledTimes(2);
    b();
    expect(remove.mock.calls.filter(([t]) => t === 'keydown').length).toBe(1);
    press(document.body, { key: 'F10' });
    expect(d.stepOver).toHaveBeenCalledTimes(2);
    add.mockRestore();
    remove.mockRestore();
  });

  it('F10 on the focused TRS-80 screen steps and never reaches the matrix', async () => {
    const result = assemble(starter, { model: 3 });
    const machine = prepareMachine({ model: 3, rom: stubRom(3), result });
    const down = vi.spyOn(machine.system.keyboard, 'keyDown');
    const up = vi.spyOn(machine.system.keyboard, 'keyUp');
    const host = document.createElement('div');
    host.setAttribute('data-own-keys', '');
    document.body.append(host);
    w = mount(defineComponent({ setup: () => () => h(TrsScreen, { machine, running: true }) }), { attachTo: host });
    await flushPromises();
    const d = fakeDebug('paused');
    install(d, options());
    const el = document.querySelector('[data-testid="trs-screen"]') as HTMLElement;
    el.focus();
    for (const key of ['F10', 'F11', 'F7', 'F5', 'F6', 'F9']) {
      press(el, { key, code: key });
      el.dispatchEvent(new KeyboardEvent('keyup', { key, code: key, bubbles: true, cancelable: true }));
    }
    expect(d.stepOver).toHaveBeenCalledTimes(1);
    expect(d.step).toHaveBeenCalledTimes(2);
    expect(down).not.toHaveBeenCalled();
    expect(up).not.toHaveBeenCalled();
    // Other keys still reach it.
    press(el, { key: 'a', code: 'KeyA' });
    expect(down).toHaveBeenCalledWith('a', 'KeyA');
  });

  it('wait only in text-entry fields: checkboxes, radios and buttons take the keys; the editor does, other contenteditable does not', () => {
    document.body.innerHTML = '<div class="cm-editor"><div class="cm-content" contenteditable="true" id="ed"></div></div><div contenteditable="true" id="ce"></div><textarea id="ta"></textarea><select id="se"></select>';
    const d = fakeDebug('paused');
    install(d, options());
    const input = (type: string | null): HTMLInputElement => {
      const el = document.createElement('input');
      if (type !== null) el.setAttribute('type', type);
      document.body.append(el);
      return el;
    };
    for (const type of ['checkbox', 'radio', 'button', 'submit', 'range', 'color', 'file']) {
      expect(inField(input(type))).toBe(false);
      expect(press(input(type), { key: 'F10' }).defaultPrevented).toBe(true);
    }
    for (const type of [null, 'text', 'search', 'number', 'email', 'url', 'tel', 'password']) {
      expect(inField(input(type))).toBe(true);
      expect(press(input(type), { key: 'F10' }).defaultPrevented).toBe(false);
    }
    for (const id of ['ce', 'ta', 'se']) expect(press(document.getElementById(id)!, { key: 'F10' }).defaultPrevented).toBe(false);
    expect(press(document.getElementById('ed')!, { key: 'F10' }).defaultPrevented).toBe(true);
    expect(d.stepOver).toHaveBeenCalledTimes(8);
  });

  it('no reload under a program: F5, Shift+F5 and Ctrl/⌘+F5 are swallowed in fields and dialogs too; idle they are the browser\'s', () => {
    const { input } = page();
    const d = fakeDebug('running');
    const o = options();
    install(d, o);
    for (const mods of [{}, { shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { ctrlKey: true, shiftKey: true }]) {
      expect(press(input, { key: 'F5', ...mods }).defaultPrevented).toBe(true);
    }
    expect(o.stop).not.toHaveBeenCalled();
    // Outside a field: Ctrl+F5 swallowed, Shift+F5 stops.
    expect(press(document.body, { key: 'F5', ctrlKey: true }).defaultPrevented).toBe(true);
    d.mode.value = 'paused';
    expect(press(document.body, { key: 'F5', metaKey: true }).defaultPrevented).toBe(true);
    expect(o.runNow).not.toHaveBeenCalled();
    expect(d.continue).not.toHaveBeenCalled();
    d.mode.value = 'idle';
    for (const mods of [{ shiftKey: true }, { ctrlKey: true }]) {
      expect(press(input, { key: 'F5', ...mods }).defaultPrevented).toBe(false);
      expect(press(document.body, { key: 'F5', ...mods }).defaultPrevented).toBe(false);
    }
  });

  it('F8 is not a debug key: it reaches the TRS-80 screen\'s keyboard', async () => {
    const result = assemble(starter, { model: 3 });
    const machine = prepareMachine({ model: 3, rom: stubRom(3), result });
    const down = vi.spyOn(machine.system.keyboard, 'keyDown');
    const host = document.createElement('div');
    document.body.append(host);
    w = mount(defineComponent({ setup: () => () => h(TrsScreen, { machine, running: true }) }), { attachTo: host });
    await flushPromises();
    const d = fakeDebug('paused');
    install(d, options());
    const el = document.querySelector('[data-testid="trs-screen"]') as HTMLElement;
    el.focus();
    press(el, { key: 'F8', code: 'F8' });
    expect(down).toHaveBeenCalledWith('F8', 'F8');
    expect([d.step, d.stepOver, d.continue, d.pause].every((f) => (f as ReturnType<typeof vi.fn>).mock.calls.length === 0)).toBe(true);
  });
});

describe('the announcements', () => {
  const region = (): HTMLElement | null => document.querySelector('[data-testid="debug-announcer"]');

  it('are one visually hidden status region on the body, made on first install, apart from the keys', () => {
    expect(region()).toBeNull();
    page();
    install(fakeDebug(), options());
    // The keys alone speak nothing: Run ▶ and Source ✎ install the announcer themselves.
    expect(region()).toBeNull();
    expect(announcing.value).toBe(false);
    const d = fakeDebug();
    uninstall.push(speakAnnouncements(d), speakAnnouncements(d));
    expect(announcing.value).toBe(true);
    const r = region()!;
    expect(r.parentElement).toBe(document.body);
    expect(r.getAttribute('role')).toBe('status');
    expect(document.querySelectorAll('[data-testid="debug-announcer"]').length).toBe(1);
    expect(r.style.position).toBe('absolute');
    expect(r.style.width).toBe('1px');
  });

  it('a breakpoint stop says "Paused at line N, …, at a breakpoint." in the region and in run.message', async () => {
    const { run, clock } = await prepare(holder, LOOP);
    uninstall.push(speakAnnouncements(run.debug));
    run.debug.toggleBreakpoint(5);
    await run.run();
    clock.frame();
    await nextTick();
    expect(region()!.textContent!.trim()).toBe('Paused at line 5, DEC A, at a breakpoint.');
    expect(run.message.value).toBe('Paused at line 5, DEC A, at a breakpoint.');
  });

  it('five steps within 100 ms are spoken once, the last, 150 ms after it', async () => {
    const { run, clock } = await prepare(holder, LOOP);
    uninstall.push(speakAnnouncements(run.debug));
    run.debug.toggleBreakpoint(4);
    await run.run();
    clock.frame();
    await nextTick();
    expect(region()!.textContent!.trim()).toBe('Paused at line 4, INC A, at a breakpoint.');
    vi.useFakeTimers();
    const seen: string[] = [];
    const observer = new MutationObserver(() => seen.push(region()!.textContent!.trim()));
    observer.observe(region()!, { childList: true, characterData: true, subtree: true });
    for (let k = 0; k < 5; k++) {
      run.debug.step();
      vi.advanceTimersByTime(20);
    }
    await Promise.resolve();
    expect(seen).toEqual([]);
    expect(region()!.textContent!.trim()).toBe('Paused at line 4, INC A, at a breakpoint.');
    vi.advanceTimersByTime(STEP_DEBOUNCE_MS - 20 - 1);
    await Promise.resolve();
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(1);
    await Promise.resolve();
    // Five steps from line 4: 5, 6, 4, 5, 6.
    expect(run.message.value).toMatch(/^Line 6, JR LOOP\./);
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set([run.message.value]));
    observer.disconnect();
  });

  it('say() again with the same sentence is spoken again', () => {
    page();
    const a = announcer();
    a.say('Line 6, JR LOOP.');
    const first = region()!.textContent;
    a.say('Line 6, JR LOOP.');
    expect(region()!.textContent).not.toBe(first);
    expect(region()!.textContent!.trim()).toBe('Line 6, JR LOOP.');
  });

  it('the last uninstall stops speaking', async () => {
    page();
    const { run, clock } = await prepare(holder, LOOP);
    const a = speakAnnouncements(run.debug);
    const b = speakAnnouncements(run.debug);
    a();
    a();
    expect(announcing.value).toBe(true);
    b();
    expect(announcing.value).toBe(false);
    run.debug.toggleBreakpoint(5);
    await run.run();
    clock.frame();
    expect(run.message.value).toMatch(/^Paused at line 5/);
    expect(region()?.textContent ?? '').not.toContain('Paused');
  });

  it('a screen sentence and a pending step sentence do not cancel each other', () => {
    page();
    vi.useFakeTimers();
    const a = announcer();
    const seen: string[] = [];
    const record = (): void => void seen.push(region()!.textContent!.trim());
    a.say('Line 6, JR LOOP.', { debounce: STEP_DEBOUNCE_MS, slot: 'step' });
    vi.advanceTimersByTime(50);
    a.say('Row 4: SCORE 120.', { slot: 'screen' });
    record();
    vi.advanceTimersByTime(STEP_DEBOUNCE_MS);
    record();
    expect(seen).toEqual(['Row 4: SCORE 120.', 'Line 6, JR LOOP.']);
  });
});
