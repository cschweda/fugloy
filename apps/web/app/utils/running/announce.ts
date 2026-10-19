// What the running line says to a screen reader (phase 5C Ruling 12): one visually hidden
// `role="status"` region on `document.body`, outside the panels that `v-show` hides (a hidden live
// region is not read), made on first use. A pause is said at once; a step waits 150 ms
// (`debounce`), so holding F10 says only the last line. The same sentence twice is said twice.
// Each `slot` keeps its own pending sentence, so a screen change and a step never cancel each other.
//
// `speakAnnouncements(debug)` sends the coordinator's sentences here. Run ▶ and Source ✎ install it
// statically (refcounted), apart from the debug keys' chunk, so pauses are spoken even if that
// chunk fails; `announcing` is true while it is installed, and only then does Run ▶ quiet its own
// run message. Lazy (utils/running/): it loads with Source ✎ and Run ▶, never on the first screen.
import { effectScope, ref, watch } from 'vue';
import type { EffectScope, ShallowRef } from 'vue';

/** How long a step's sentence waits for the next step (Ruling 12). */
export const STEP_DEBOUNCE_MS = 150;

export interface Announcer {
  /** Says `text`; with `debounce`, only if nothing else is said in the same `slot` within that many ms. */
  say(text: string, opts?: { debounce?: number; slot?: string }): void;
}

let region: HTMLElement | null = null;
const timers = new Map<string, ReturnType<typeof setTimeout>>();
/** Alternates a trailing no-break space, so the same sentence again is a change a reader speaks. */
let flip = false;

function theRegion(): HTMLElement {
  if (region !== null && region.isConnected) return region;
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-atomic', 'true');
  el.dataset.testid = 'debug-announcer';
  // Visually hidden, still read (the sr-only pattern, inline so it needs no stylesheet).
  Object.assign(el.style, { position: 'absolute', width: '1px', height: '1px', margin: '-1px', padding: '0', border: '0', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' });
  document.body.append(el);
  region = el;
  return el;
}

function write(text: string): void {
  const el = theRegion();
  flip = !flip;
  el.textContent = flip ? text : `${text} `;
}

const shared: Announcer = {
  say(text, opts) {
    const slot = opts?.slot ?? 'main';
    const pending = timers.get(slot);
    if (pending !== undefined) clearTimeout(pending);
    timers.delete(slot);
    const wait = opts?.debounce ?? 0;
    if (wait <= 0) return write(text);
    timers.set(
      slot,
      setTimeout(() => {
        timers.delete(slot);
        write(text);
      }, wait),
    );
  },
};

/** The page's one announcer; its region is made (again, if a test cleared the body) on first use. */
export function announcer(): Announcer {
  theRegion();
  return shared;
}

/** True while the coordinator's sentences reach the announcer. */
export const announcing = ref(false);
let installs = 0;
let scope: EffectScope | null = null;

/** Speaks `debug.announcement` (a step's after 150 ms, in the step slot); refcounted; returns the uninstall, which drops any sentence still waiting once the last install goes. */
export function speakAnnouncements(debug: { announcement: ShallowRef<{ text: string; step: boolean } | null> }): () => void {
  installs++;
  if (installs === 1) {
    const say = announcer();
    scope = effectScope(true);
    // Sync: every sentence reaches the announcer, which debounces the steps itself.
    scope.run(() =>
      watch(
        debug.announcement,
        (a) => {
          if (a !== null) say.say(a.text, a.step ? { debounce: STEP_DEBOUNCE_MS, slot: 'step' } : { slot: 'step' });
        },
        { flush: 'sync' },
      ),
    );
    announcing.value = true;
  }
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    if (--installs > 0) return;
    scope?.stop();
    scope = null;
    announcing.value = false;
    // A step's sentence still waiting would be said after the panels have gone.
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
  };
}
