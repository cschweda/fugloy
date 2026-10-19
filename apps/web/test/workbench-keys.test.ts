// @vitest-environment happy-dom
// The workbench's keys stay out of a panel that keeps its own keys (data-own-keys):
// the Source panel now, the Run panel later.
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { useWorkbenchKeys } from '../app/composables/useWorkbenchKeys';
import { ownsKeys } from '../app/utils/keys';

describe('a panel that owns its keys', () => {
  it('gets no workbench key, even on a plain button inside it; outside it the key works', () => {
    const ran: string[] = [];
    const Page = defineComponent({
      setup() {
        useWorkbenchKeys({ keys: { g: { run: () => ran.push('g') }, 'ctrl+z': { run: () => ran.push('undo') } }, active: () => true, inListing: () => false });
        return () => h('div', [h('button', { id: 'outside' }, 'out'), h('div', { 'data-own-keys': '' }, [h('button', { id: 'inside' }, 'in')])]);
      },
    });
    const host = document.createElement('div');
    document.body.append(host);
    const w = mount(Page, { attachTo: host });
    const press = (id: string, init: KeyboardEventInit): void => {
      document.getElementById(id)!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
    };
    press('inside', { key: 'g' });
    press('inside', { key: 'z', ctrlKey: true });
    expect(ran).toEqual([]);
    press('outside', { key: 'g' });
    expect(ran).toEqual(['g']);
    expect(ownsKeys(document.getElementById('inside'))).toBe(true);
    expect(ownsKeys(document.getElementById('outside'))).toBe(false);
    expect(ownsKeys(null)).toBe(false);
    w.unmount();
  });
});
