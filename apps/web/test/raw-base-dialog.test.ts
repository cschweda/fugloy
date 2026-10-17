// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import RawBaseDialog from '../app/components/RawBaseDialog.vue';

describe('RawBaseDialog', () => {
  it('refuses an address the file would run past $FFFF from, and loads one it fits at', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const w = mount(RawBaseDialog, { props: { open: false, name: 'blob.bin', size: 0x1000 }, attachTo: host });
    await w.setProps({ open: true } as never);
    await w.get('input').setValue('F800');
    await w.get('form').trigger('submit');
    expect(w.emitted('load')).toBeUndefined();
    expect(w.get('[role="alert"]').text()).toBe('A 4,096-byte file loaded at $F800 runs past $FFFF. The highest address it fits at is $F000.');
    await w.get('input').setValue('F000');
    await w.get('form').trigger('submit');
    expect(w.emitted('load')).toEqual([[0xf000]]);
    w.unmount();
  });
});
