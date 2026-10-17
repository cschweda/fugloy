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

  it('with noEscape, a close that did not come from a button emits nothing and the dialog comes back', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const w = mount(ConfirmDialog, { props: { open: false, title: 'T', message: 'M', confirmLabel: 'Yes', noEscape: true }, attachTo: host });
    await w.setProps({ open: true } as never);
    const d = w.get('dialog').element as HTMLDialogElement;
    expect(d.open).toBe(true);
    d.close();
    d.dispatchEvent(new Event('close'));
    expect(w.emitted('cancel')).toBeUndefined();
    expect(w.emitted('confirm')).toBeUndefined();
    expect(d.open).toBe(true);
    await w.get('button').trigger('click');
    expect(w.emitted('cancel')).toHaveLength(1);
    w.unmount();
  });

  it('focuses the confirm button by default, and the cancel button with focusCancel', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const plain = mount(ConfirmDialog, { props: { open: false, title: 'T', message: 'M', confirmLabel: 'Load', cancelLabel: 'Keep' }, attachTo: host });
    await plain.setProps({ open: true } as never);
    await new Promise((r) => setTimeout(r, 0));
    expect(document.activeElement?.textContent).toBe('Load');
    plain.unmount();
    const safe = mount(ConfirmDialog, { props: { open: false, title: 'T', message: 'M', confirmLabel: 'Replace', cancelLabel: 'Cancel', focusCancel: true }, attachTo: host });
    await safe.setProps({ open: true } as never);
    await new Promise((r) => setTimeout(r, 0));
    expect(document.activeElement?.textContent).toBe('Cancel');
    safe.unmount();
  });
});
