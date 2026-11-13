// attachKeyboard: keys on the screen element go to the matrix through its own browser mapping;
// Tab and modified keys are never captured, and blur releases every key (Ruling 9). The element
// is an EventTarget, so no DOM is needed.
import { describe, expect, it } from 'vitest';
import { Machine } from '@fugloy/emu';
import { attachKeyboard } from '../app/utils/emulator/keyboard';
import { stubRom } from '../app/utils/emulator/stub-rom';

type Key = Event & { key: string; code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean };
const key = (type: string, k: string, code: string, mods: Partial<Key> = {}): Key =>
  Object.assign(new Event(type, { cancelable: true }), { key: k, code, ctrlKey: false, metaKey: false, altKey: false, ...mods }) as Key;

describe('attachKeyboard', () => {
  it('presses mapped keys, ignores Tab and modified keys, and releases all on blur', () => {
    const m = new Machine({ roms: { level2: stubRom(3) } });
    const el = new EventTarget() as unknown as HTMLElement;
    let machine: Machine | null = m;
    const detach = attachKeyboard(el, () => machine);
    const rows = m.system.keyboard as unknown as { rows: Uint8Array };
    const down = (): number => rows.rows.reduce((n, r) => n + r, 0);

    const a = key('keydown', 'a', 'KeyA');
    el.dispatchEvent(a);
    expect(a.defaultPrevented).toBe(true);
    expect(down()).toBeGreaterThan(0);
    el.dispatchEvent(key('keyup', 'a', 'KeyA'));
    expect(down()).toBe(0);

    for (const e of [key('keydown', 'Tab', 'Tab'), key('keydown', 'r', 'KeyR', { ctrlKey: true }), key('keydown', 'r', 'KeyR', { metaKey: true }), key('keydown', 'x', 'KeyX', { altKey: true })]) {
      el.dispatchEvent(e);
      expect(e.defaultPrevented, e.key).toBe(false);
      expect(down()).toBe(0);
    }
    const unmapped = key('keydown', 'F7', 'F7');
    el.dispatchEvent(unmapped);
    expect(unmapped.defaultPrevented).toBe(false);

    el.dispatchEvent(key('keydown', 'Enter', 'Enter'));
    el.dispatchEvent(key('keydown', 'b', 'KeyB'));
    expect(down()).toBeGreaterThan(0);
    el.dispatchEvent(new Event('blur'));
    expect(down()).toBe(0);

    // No machine: nothing is captured.
    machine = null;
    const late = key('keydown', 'a', 'KeyA');
    el.dispatchEvent(late);
    expect(late.defaultPrevented).toBe(false);

    detach();
    machine = m;
    el.dispatchEvent(key('keydown', 'a', 'KeyA'));
    expect(down()).toBe(0);
  });

  // The TRS-80's : and @ are unshifted keys that a US keyboard types with Shift.
  it("types a character the keyboard needs Shift for without the TRS-80's SHIFT, and keeps Shift otherwise", () => {
    const m = new Machine({ roms: { level2: stubRom(3) } });
    const el = new EventTarget() as unknown as HTMLElement;
    const detach = attachKeyboard(el, () => m);
    const k = m.system.keyboard as unknown as { read(select: number): number };
    const SHIFT_ROW = 0x80;
    const send = (type: string, key_: string, code: string): void => void el.dispatchEvent(key(type, key_, code));

    send('keydown', 'Shift', 'ShiftLeft');
    expect(k.read(SHIFT_ROW)).toBe(0x01); // Shift alone is the TRS-80's SHIFT
    send('keydown', ':', 'Semicolon');
    expect(k.read(0x20)).toBe(0x04); // the : key
    expect(k.read(SHIFT_ROW)).toBe(0x00); // unshifted, so not *
    send('keyup', ':', 'Semicolon');
    expect(k.read(0x20)).toBe(0x00);
    expect(k.read(SHIFT_ROW)).toBe(0x01); // Shift is still held
    send('keydown', '"', 'Quote');
    expect(k.read(0x10)).toBe(0x04); // the 2 key
    expect(k.read(SHIFT_ROW)).toBe(0x01); // SHIFT+2, the character's own
    send('keyup', 'Shift', 'ShiftLeft'); // Shift released first
    expect(k.read(0x10)).toBe(0x04);
    send('keyup', "'", 'Quote');
    expect(k.read(0xff)).toBe(0x00);

    // Shift with the space bar and the arrows stays SHIFT (games read it).
    send('keydown', 'Shift', 'ShiftRight');
    send('keydown', ' ', 'Space');
    send('keydown', 'ArrowLeft', 'ArrowLeft');
    expect(k.read(SHIFT_ROW)).toBe(0x01);
    el.dispatchEvent(new Event('blur'));
    expect(k.read(0xff)).toBe(0x00);
    send('keydown', ':', 'Semicolon'); // nothing remembered a Shift across the blur
    send('keyup', ':', 'Semicolon');
    expect(k.read(0xff)).toBe(0x00);
    detach();
  });
});
