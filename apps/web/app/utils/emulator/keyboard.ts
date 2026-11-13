// The screen's keyboard (phase 5B Ruling 9). Keys reach the emulated machine only through the
// screen element, so only while it has focus; typing in the editor, inputs, or dialogs never does.
// They go through the matrix's own browser mapping (keyDown(e.key, e.code), keyUp(e.code)), and
// only a mapped key's default is prevented. Tab and keys with Ctrl, ⌘, or Alt are never captured,
// so Tab leaves the screen (except in full screen, where TrsScreen keeps it) and the browser's
// shortcuts work. Blur releases every key. The debug
// keys (5C Ruling 10: F5, F6, F7, F9, F10, F11) never reach the matrix: they bubble on to
// utils/running/debug-keys, whose pattern this one matches. F8 is not a debug key and passes.
//
// The matrix maps a key by the character it types and adds the TRS-80's SHIFT itself where that
// character is a shifted TRS-80 key (" is SHIFT+2). The TRS-80's : and @ are unshifted keys, but a
// US keyboard types them with Shift, and the held Shift would turn : into *. So while a character
// key is down the physical Shift is lifted from the matrix, and put back when the last one is
// released with Shift still held. Shift alone, or with the arrows or the space bar, is the TRS-80's.
//
// This is the one use of emu's escape hatch, `m.system.keyboard` (the matrix), in the site.
import type { Machine } from '@fugloy/emu';

/** The function keys the debugger owns, as utils/running/debug-keys lists them; the TRS-80 keyboard map uses none. */
const DEBUG_KEY = /^F(?:5|6|7|9|10|11)$/;

/** Listens on `el` for keys; returns a function that stops listening. */
export function attachKeyboard(el: HTMLElement, getMachine: () => Machine | null): () => void {
  const matrix = () => getMachine()?.system.keyboard ?? null;
  /** The physical Shift keys held, and the character keys held, by `e.code`. */
  const shifts = new Set<string>();
  const chars = new Set<string>();
  const onDown = (e: KeyboardEvent): void => {
    if (e.key === 'Tab' || e.ctrlKey || e.metaKey || e.altKey || DEBUG_KEY.test(e.key)) return;
    const k = matrix();
    if (k === null) return;
    if (e.key === 'Shift') {
      shifts.add(e.code);
      if (chars.size === 0) k.keyDown(e.key, e.code);
      e.preventDefault();
      return;
    }
    const char = e.key.length === 1 && e.key !== ' ';
    if (char) for (const code of shifts) k.keyUp(code);
    const mapped = k.keyDown(e.key, e.code);
    if (mapped) e.preventDefault();
    if (!char) return;
    if (mapped) chars.add(e.code);
    else if (chars.size === 0) for (const code of shifts) k.keyDown('Shift', code); // not a TRS-80 key: Shift stays as it was
  };
  const onUp = (e: KeyboardEvent): void => {
    if (DEBUG_KEY.test(e.key)) return;
    const k = matrix();
    const wasShift = shifts.delete(e.code);
    const wasChar = chars.delete(e.code);
    if (k === null) return;
    if (k.keyUp(e.code) || wasShift) e.preventDefault();
    if (wasChar && chars.size === 0) for (const code of shifts) k.keyDown('Shift', code);
  };
  const forget = (): void => {
    shifts.clear();
    chars.clear();
    matrix()?.reset();
  };
  const onBlur = forget;
  el.addEventListener('keydown', onDown);
  el.addEventListener('keyup', onUp);
  el.addEventListener('blur', onBlur);
  return () => {
    el.removeEventListener('keydown', onDown);
    el.removeEventListener('keyup', onUp);
    el.removeEventListener('blur', onBlur);
    forget();
  };
}
