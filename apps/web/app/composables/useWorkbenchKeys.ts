// The workbench's one key handler. Bindings are keyed by `keyId`; a binding
// marked `listing` fires only while the listing (or nothing in particular) has
// focus, so Enter and the arrows keep their usual meaning on buttons, tabs and
// menus elsewhere. Keys wait while a text field has focus or a dialog is open,
// and never fire inside a panel marked `data-own-keys` (utils/keys `ownsKeys`).
// A binding marked `anywhere` (Run, Ctrl/⌘+Enter, plan 5B Ruling 8) fires in
// text fields and own-keys panels too, whenever `anywhereActive` allows, unless
// a dialog is open or something on the way (the editor's own keymap) handled it.
import { onBeforeUnmount, onMounted } from 'vue';
import { isTyping, keyId, modalOpen, ownsKeys } from '../utils/keys';

export interface KeyBinding {
  run: () => void;
  /** Only while focus is in the listing or on the page itself. */
  listing?: boolean;
  /** Also in text fields, the editor, and `data-own-keys` panels (and with no program open, while `anywhereActive`). */
  anywhere?: boolean;
}

export function useWorkbenchKeys(opts: {
  keys: Readonly<Record<string, KeyBinding>>;
  /** False while there is nothing to act on (no program open). */
  active: () => boolean;
  /** Whether a key press's target is the listing. */
  inListing: (target: EventTarget | null) => boolean;
  /** When `anywhere` bindings may fire; `active` by default. */
  anywhereActive?: () => boolean;
}): void {
  function onKeydown(e: KeyboardEvent): void {
    const any = opts.keys[keyId(e)];
    if (any?.anywhere === true) {
      if (!(opts.anywhereActive ?? opts.active)() || modalOpen(document) || e.defaultPrevented) return;
      e.preventDefault();
      any.run();
      return;
    }
    if (!opts.active() || isTyping(e.target) || ownsKeys(e.target) || modalOpen(document) || e.defaultPrevented) return;
    const binding = opts.keys[keyId(e)];
    if (binding === undefined) return;
    if (binding.listing === true && !(e.target === document.body || opts.inListing(e.target))) return;
    e.preventDefault();
    binding.run();
  }
  onMounted(() => document.addEventListener('keydown', onKeydown));
  onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));
}
