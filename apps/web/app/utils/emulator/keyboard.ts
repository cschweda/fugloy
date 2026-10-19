// The screen's keyboard (phase 5B Ruling 9). Keys reach the emulated machine only through the
// screen element, so only while it has focus; typing in the editor, inputs, or dialogs never does.
// They go through the matrix's own browser mapping (keyDown(e.key, e.code), keyUp(e.code)), and
// only a mapped key's default is prevented. Tab and keys with Ctrl, ⌘, or Alt are never captured,
// so Tab leaves the screen and the browser's shortcuts work. Blur releases every key.
//
// This is the one use of emu's escape hatch, `m.system.keyboard` (the matrix), in the site.
import type { Machine } from '@fugloy/emu';

/** Listens on `el` for keys; returns a function that stops listening. */
export function attachKeyboard(el: HTMLElement, getMachine: () => Machine | null): () => void {
  const matrix = () => getMachine()?.system.keyboard ?? null;
  const onDown = (e: KeyboardEvent): void => {
    if (e.key === 'Tab' || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = matrix();
    if (k !== null && k.keyDown(e.key, e.code)) e.preventDefault();
  };
  const onUp = (e: KeyboardEvent): void => {
    const k = matrix();
    if (k !== null && k.keyUp(e.code)) e.preventDefault();
  };
  const onBlur = (): void => matrix()?.reset();
  el.addEventListener('keydown', onDown);
  el.addEventListener('keyup', onUp);
  el.addEventListener('blur', onBlur);
  return () => {
    el.removeEventListener('keydown', onDown);
    el.removeEventListener('keyup', onUp);
    el.removeEventListener('blur', onBlur);
    matrix()?.reset();
  };
}
