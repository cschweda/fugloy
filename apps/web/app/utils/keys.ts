/**
 * The workbench's key bindings, in one place. `keyId` names a key press
 * (`g`, `alt+arrowleft`, `ctrl+z`); the page maps ids to actions
 * (composables/useWorkbenchKeys installs them).
 */

/** True while the key press belongs to a text field, which keeps its own keys. Duck-typed so it needs no DOM to test. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as { tagName?: unknown; isContentEditable?: unknown } | null;
  if (el === null || typeof el.tagName !== 'string') return false;
  return el.isContentEditable === true || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/**
 * True when the key press comes from inside a panel that keeps its own keys,
 * marked `data-own-keys` (the Source panel; Task 4's Run panel): the
 * workbench's bindings (G, N, ;, Esc, Ctrl+Z…) never fire there, even on a
 * plain button.
 */
export function ownsKeys(target: EventTarget | null): boolean {
  const el = target as { closest?: unknown } | null;
  return el !== null && typeof el.closest === 'function' && (el as Element).closest('[data-own-keys]') !== null;
}

/** True while a modal dialog is open: the workbench's keys wait until it closes. */
export function modalOpen(root: Pick<Document, 'querySelector'>): boolean {
  return root.querySelector('dialog[open]') !== null;
}

/**
 * `alt+arrowleft`, `g`, `ctrl+shift+z`: modifiers in a fixed order, then the
 * lowercase key. Shift on a bare character is part of the character (`G` is
 * `g`, `:` stays `:`), so it is named only on a named key or beside ctrl or alt.
 */
export function keyId(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): string {
  const ctrl = e.ctrlKey || e.metaKey;
  const mods = [ctrl ? 'ctrl' : '', e.altKey ? 'alt' : '', e.shiftKey && (e.key.length > 1 || ctrl || e.altKey) ? 'shift' : ''].filter(Boolean);
  return [...mods, e.key.toLowerCase()].join('+');
}
