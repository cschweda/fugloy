// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { describe, expect, it } from 'vitest';
import ConfirmDialog from '../app/components/ConfirmDialog.vue';

describe('ConfirmDialog', () => {
  it('two dialogs in one app label and describe themselves, with no id in common', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const Page = defineComponent({
      render: () => [
        h(ConfirmDialog, { open: false, title: 'First', message: 'about one', confirmLabel: 'Yes', testid: 'a' }),
        h(ConfirmDialog, { open: false, title: 'Second', message: 'about two', confirmLabel: 'Yes', testid: 'b' }),
      ],
    });
    const w = mount(Page, { attachTo: host });
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    const dialogs = w.findAll('dialog');
    for (const [i, title, message] of [[0, 'First', 'about one'], [1, 'Second', 'about two']] as const) {
      const d = dialogs[i]!.element;
      expect(document.getElementById(d.getAttribute('aria-labelledby')!)?.textContent).toBe(title);
      expect(document.getElementById(d.getAttribute('aria-describedby')!)?.textContent).toBe(message);
    }
    w.unmount();
  });
});
