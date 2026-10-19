// @vitest-environment happy-dom
// The registers panel (phase 5C Ruling 11), in Run ▶ beside the screen: every register, the flags
// spelled out as 0 or 1, the values that changed since the previous pause marked by colour and by
// a "changed" word for screen readers, no live region, and 4 updates a second while running.
import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { nextTick, watch } from 'vue';
import RegistersPanel from '../app/components/run/RegistersPanel.vue';
import type { Holder } from './source-run-support';
import { LOOP, prepare } from './source-run-support';

const holder: Holder = { sources: null, run: null };
let w: VueWrapper | null = null;
afterEach(() => {
  holder.run?.stop();
  w?.unmount();
  w = null;
  document.body.innerHTML = '';
});

/** The panel's register rows as text: name, value, and the "changed" word where there is one. */
const rows = (t: VueWrapper): Record<string, string> => Object.fromEntries(t.findAll('[data-testid="reg-row"]').map((r) => [r.get('[data-testid="reg-name"]').text(), r.get('[data-testid="reg-value"]').text()]));

describe('the registers panel', () => {
  it('says there is nothing to show before a Run', async () => {
    const { run } = await prepare(holder, LOOP);
    w = mount(RegistersPanel, { props: { debug: run.debug }, attachTo: document.body });
    expect(w.text()).toContain('The registers show here while a program runs.');
  });

  it('after a step, marks what changed by colour and by word, and spells out the flags', async () => {
    const { run, clock } = await prepare(holder, LOOP);
    w = mount(RegistersPanel, { props: { debug: run.debug }, attachTo: document.body });
    run.debug.toggleBreakpoint(4);
    await run.run();
    clock.frame();
    await nextTick();
    // The first pause has nothing earlier to compare with.
    expect(w.findAll('.fg-reg-changed')).toEqual([]);
    run.debug.step();
    await nextTick();
    const r = rows(w);
    for (const name of ['AF', 'BC', 'DE', 'HL', 'IX', 'IY', 'SP', 'PC', 'AF′', 'BC′', 'DE′', 'HL′', 'I', 'R', 'IM', 'IFF1', 'IFF2']) expect(r[name]).toBeDefined();
    // INC A: A and F changed (one row, AF), nothing else marked; PC moves but is never marked.
    expect(r.AF).toMatch(/^\$[0-9A-F]{4} changed$/);
    expect(r.PC).toMatch(/^\$[0-9A-F]{4}$/);
    expect(r.HL).toMatch(/^\$[0-9A-F]{4}$/);
    expect(w.findAll('[data-testid="reg-row"].fg-reg-changed').map((x) => x.get('[data-testid="reg-name"]').text())).toEqual(['AF']);
    expect(w.get('.fg-reg-changed .sr-only').text()).toBe('changed');
    const flags = w.findAll('[data-testid="flag-row"]').map((x) => `${x.get('th').text()} ${x.get('td').text()}`);
    expect(flags.map((f) => f.split(' ')[0])).toEqual(['Sign', 'Zero', 'Half-carry', 'Parity/Overflow', 'Add/Subtract', 'Carry']);
    for (const f of flags) expect(f).toMatch(/ [01]( changed)?$/);
    // No live region: the announcer speaks; the panel is read on demand.
    expect(w.find('[role="status"], [aria-live]').exists()).toBe(false);
  });

  it('updates 4 times a second while running', async () => {
    const { run, clock } = await prepare(holder, LOOP);
    w = mount(RegistersPanel, { props: { debug: run.debug }, attachTo: document.body });
    await run.run();
    let updates = 0;
    watch(run.debug.registers, () => updates++, { flush: 'sync' });
    // A second and a frame, after the read at the start: at 250, 500, 750 and 1000 ms.
    for (let k = 0; k < 61; k++) clock.frame();
    await nextTick();
    expect(updates).toBeGreaterThanOrEqual(4);
    expect(updates).toBeLessThanOrEqual(5);
    // The panel shows the latest.
    expect(rows(w).PC).toBe(`$${run.debug.registers.value!.snap.pc.toString(16).toUpperCase().padStart(4, '0')}`);
  });
});
