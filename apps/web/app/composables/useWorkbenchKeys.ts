// The workbench's one key handler. Bindings are keyed by `keyId`; a binding
// marked `listing` fires only while the listing (or nothing in particular) has
// focus, so Enter and the arrows keep their usual meaning on buttons, tabs and
// menus elsewhere. Keys wait while a text field has focus or a dialog is open.
import { onBeforeUnmount, onMounted } from 'vue';
import { isTyping, keyId, modalOpen } from '../utils/keys';

export interface KeyBinding {
  run: () => void;
  /** Only while focus is in the listing or on the page itself. */
  listing?: boolean;
}

export function useWorkbenchKeys(opts: {
  keys: Readonly<Record<string, KeyBinding>>;
  /** False while there is nothing to act on (no program open). */
  active: () => boolean;
  /** Whether a key press's target is the listing. */
  inListing: (target: EventTarget | null) => boolean;
}): void {
  function onKeydown(e: KeyboardEvent): void {
    if (!opts.active() || isTyping(e.target) || modalOpen(document) || e.defaultPrevented) return;
    const binding = opts.keys[keyId(e)];
    if (binding === undefined) return;
    if (binding.listing === true && !(e.target === document.body || opts.inListing(e.target))) return;
    e.preventDefault();
    binding.run();
  }
  onMounted(() => document.addEventListener('keydown', onKeydown));
  onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));
}
