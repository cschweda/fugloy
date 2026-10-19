// What the running line says to a screen reader (phase 5C Ruling 12): one visually hidden
// `role="status"` region on `document.body`, outside the panels that `v-show` hides (a hidden live
// region is not read), made on first use. A pause is said at once; a step waits 150 ms
// (`debounce`), so holding F10 says only the last line. The same sentence twice is said twice.
// Lazy (utils/running/): it loads with Source ✎ and Run ▶, never on the first screen.

/** How long a step's sentence waits for the next step (Ruling 12). */
export const STEP_DEBOUNCE_MS = 150;

export interface Announcer {
  /** Says `text`; with `debounce`, only if nothing else is said within that many ms. */
  say(text: string, opts?: { debounce?: number }): void;
}

let region: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
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
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const wait = opts?.debounce ?? 0;
    if (wait <= 0) return write(text);
    timer = setTimeout(() => {
      timer = null;
      write(text);
    }, wait);
  },
};

/** The page's one announcer; its region is made (again, if a test cleared the body) on first use. */
export function announcer(): Announcer {
  theRegion();
  return shared;
}
