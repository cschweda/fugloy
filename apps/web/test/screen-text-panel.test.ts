// @vitest-environment happy-dom
// The screen-text mirror (phase 5C Ruling 13; in 5D inside Run ▶'s Debugger, not the screen): a "Screen text" disclosure,
// closed by default, holding the screen's rows as a list (a blank row reads "blank"). While open it
// refreshes at most twice a second, only when the text changed, with no live region of its own.
// "Speak screen changes" (opt-in) speaks through the announcer at most once a second.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import starter from '@fugloy/asm-examples/clear-screen.z?raw';
import { assemble } from '@fugloy/asm';
import type { Machine } from '@fugloy/emu';
import { prepareMachine } from '../app/utils/emulator/boot';
import { stubRom } from '../app/utils/emulator/stub-rom';
import ScreenText from '../app/components/run/ScreenText.vue';
import TrsScreen from '../app/components/run/TrsScreen.vue';

let w: VueWrapper | null = null;
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  w?.unmount();
  w = null;
  vi.useRealTimers();
  document.body.innerHTML = '';
});

function machine(): Machine {
  const m = prepareMachine({ model: 3, rom: stubRom(3), result: assemble(starter, { model: 3 }) });
  // A known screen: all spaces.
  m.mem.write(0x3c00, new Uint8Array(1024).fill(0x20));
  return m;
}
const put = (m: Machine, row: number, text: string): void => m.mem.write(0x3c00 + row * 64, new TextEncoder().encode(text.padEnd(64, ' ')));

function mountText(m: Machine) {
  w = mount(defineComponent({ setup: () => () => h(ScreenText, { machine: m }) }), { attachTo: document.body });
  const text = (): { refresh(): void } => w!.findComponent(ScreenText).vm as unknown as { refresh(): void };
  return { text };
}

const items = (): string[] => [...document.querySelectorAll('[data-testid="screen-text-row"]')].map((li) => li.textContent!.trim());
const region = (): string => document.querySelector('[data-testid="debug-announcer"]')?.textContent?.trim() ?? '';
const details = (): HTMLDetailsElement => document.querySelector('[data-testid="screen-text"]') as HTMLDetailsElement;

async function open(): Promise<void> {
  details().open = true;
  details().dispatchEvent(new Event('toggle'));
  await nextTick();
}

describe('the screen-text mirror', () => {
  it('is closed by default and reads nothing while closed', async () => {
    const m = machine();
    const raw = vi.spyOn(m.video, 'raw', 'get');
    const { text } = mountText(m);
    expect(details().open).toBe(false);
    expect(details().querySelector('summary')!.textContent).toContain('Screen text');
    for (let k = 0; k < 10; k++) text().refresh();
    expect(raw).not.toHaveBeenCalled();
  });

  it('when open lists the rows, a blank one as "blank", graphics as spaces', async () => {
    const m = machine();
    put(m, 0, 'SCORE 120');
    m.mem.write(0x3c00 + 64, new Uint8Array([0x48, 0x49, 0xbf, 0x41]));
    const { text } = mountText(m);
    await open();
    expect(items().length).toBe(16);
    expect(items()[0]).toBe('SCORE 120');
    expect(items()[1]).toBe('HI A');
    expect(items()[2]).toBe('blank');
    expect(document.querySelector('[data-testid="screen-text"] ol')).not.toBeNull();
    expect(document.querySelector('[data-testid="screen-text"] [aria-live], [data-testid="screen-text"] [role="status"]')).toBeNull();
    text().refresh();
  });

  it('refreshes at most twice a second, and the last change always shows', async () => {
    const m = machine();
    const { text } = mountText(m);
    await open();
    put(m, 0, 'ONE');
    text().refresh();
    await nextTick();
    // The open itself refreshed just now: this change waits.
    expect(items()[0]).toBe('blank');
    vi.advanceTimersByTime(200);
    put(m, 0, 'TWO');
    text().refresh();
    await nextTick();
    expect(items()[0]).toBe('blank');
    vi.advanceTimersByTime(300);
    await nextTick();
    expect(items()[0]).toBe('TWO');
    // Frames every 16 ms for a second: at most 2 more refreshes reach the list.
    let shown = 0;
    const observer = new MutationObserver(() => shown++);
    observer.observe(details().querySelector('ol')!, { subtree: true, childList: true, characterData: true });
    for (let k = 0; k < 60; k++) {
      put(m, 0, `ROW ${k}`);
      text().refresh();
      vi.advanceTimersByTime(1000 / 60);
      await Promise.resolve();
    }
    await nextTick();
    await Promise.resolve();
    observer.disconnect();
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThanOrEqual(3);
  });

  it('"Speak screen changes" is off by default, and speaks at most once a second', async () => {
    const m = machine();
    const { text } = mountText(m);
    await open();
    const speak = document.querySelector('[data-testid="screen-text-speak"]') as HTMLInputElement;
    expect(speak.checked).toBe(false);
    put(m, 3, 'HELLO');
    vi.advanceTimersByTime(600);
    text().refresh();
    await nextTick();
    expect(region()).toBe('');
    speak.checked = true;
    speak.dispatchEvent(new Event('change'));
    await nextTick();
    put(m, 3, 'SCORE 120');
    vi.advanceTimersByTime(600);
    text().refresh();
    await nextTick();
    expect(region()).toBe('Row 4: SCORE 120.');
    put(m, 3, 'SCORE 130');
    vi.advanceTimersByTime(500);
    text().refresh();
    await nextTick();
    expect(region()).toBe('Row 4: SCORE 120.');
    vi.advanceTimersByTime(500);
    await nextTick();
    expect(region()).toBe('Row 4: SCORE 130.');
    for (let r = 5; r < 10; r++) put(m, r, `LINE ${r}`);
    vi.advanceTimersByTime(1000);
    text().refresh();
    await nextTick();
    expect(region()).toBe('The screen changed (5 rows).');
  });

  it('is not inside the TRS-80 screen (5D: Run ▶\'s Debugger holds it and refreshes it each frame)', async () => {
    const m = machine();
    w = mount(defineComponent({ setup: () => () => h(TrsScreen, { machine: m, running: true }) }), { attachTo: document.body });
    await nextTick();
    expect(document.querySelector('[data-testid="trs-screen"]')).not.toBeNull();
    expect(details()).toBeNull();
  });
});
