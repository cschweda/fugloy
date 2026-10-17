import { describe, expect, it } from 'vitest';
import { isTyping, keyId, modalOpen } from '../app/utils/keys';

const press = (key: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe('keyId', () => {
  it('names plain keys in lowercase, so G and g are one binding', () => {
    expect(keyId(press('g'))).toBe('g');
    expect(keyId(press('G', { shiftKey: true }))).toBe('g');
  });
  it('puts modifiers first in a fixed order', () => {
    expect(keyId(press('ArrowLeft', { altKey: true }))).toBe('alt+arrowleft');
    expect(keyId(press('z', { metaKey: true }))).toBe('ctrl+z');
    expect(keyId(press('z', { ctrlKey: true }))).toBe('ctrl+z');
    expect(keyId(press('ArrowRight', { ctrlKey: true, altKey: true, shiftKey: true }))).toBe('ctrl+alt+shift+arrowright');
  });
  it('keeps a modified letter apart from the bare letter', () => {
    expect(keyId(press('g', { ctrlKey: true }))).not.toBe(keyId(press('g')));
  });
});

describe('isTyping', () => {
  it('is true for input, textarea, select and editable elements', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) expect(isTyping({ tagName, isContentEditable: false } as unknown as EventTarget)).toBe(true);
    expect(isTyping({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true);
  });
  it('is false for other elements, the document and null', () => {
    expect(isTyping({ tagName: 'DIV', isContentEditable: false } as unknown as EventTarget)).toBe(false);
    expect(isTyping({ tagName: 'BUTTON' } as unknown as EventTarget)).toBe(false);
    expect(isTyping({} as EventTarget)).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
});

describe('modalOpen', () => {
  it('is true only while an open dialog is in the document', () => {
    const doc = (hit: boolean) => ({ querySelector: (sel: string) => (hit && sel === 'dialog[open]' ? ({} as Element) : null) });
    expect(modalOpen(doc(true))).toBe(true);
    expect(modalOpen(doc(false))).toBe(false);
  });
});

describe('keyId with shift and a modifier', () => {
  it('names shift on a letter when ctrl or alt is held, so redo is apart from undo', () => {
    expect(keyId(press('z', { metaKey: true, shiftKey: true }))).toBe('ctrl+shift+z');
    expect(keyId(press('Z', { ctrlKey: true, shiftKey: true }))).toBe('ctrl+shift+z');
    expect(keyId(press(';'))).toBe(';');
    expect(keyId(press('ArrowDown', { shiftKey: true }))).toBe('shift+arrowdown');
    expect(keyId(press('F10', { shiftKey: true }))).toBe('shift+f10');
  });
});
