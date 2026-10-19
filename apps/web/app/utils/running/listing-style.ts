// The listing follows the run (phase 5C Rulings 5 and 7), with no change to the listing components
// and nothing on the first screen: one <style id="fg-running-line"> in document.head, whose rules
// key on the rows' data-addr, so they apply to whichever rows the virtualised listing has drawn.
//
// - Rules: `.fg-listing :is(.fg-row-code,.fg-row-data)[data-addr="A"]` for the running line, its
//   trail, the paused line (a solid band and a 3 px bar, and ▶ in the line-number column), the ROM
//   caller, and the breakpoints (● in the line-number column). The colours are Source ✎'s, laid
//   over the row's own background (cursor, selection) rather than replacing it.
// - The text is rewritten only when it changes; the element is removed when there is nothing to
//   show (stopped, closed, not the running program) and when the follower is uninstalled.
// - Stated gap: rows that share a run address (a relocated block and the code it overwrites) all light.
// - Scrolling goes through the page's scrollTo (the `:scroll-listing` prop on Run ▶), which moves
//   neither the cursor nor focus: on each pause and step, and, with Follow on, while running at most
//   4 times a second and only once the line's row has left view.
import { watch } from 'vue';
import type { Debug, ListingMarks } from '../../composables/useDebug';

export const LISTING_STYLE_ID = 'fg-running-line';
/** The fastest Follow scrolls the listing while running. */
export const LISTING_FOLLOW_MS = 250;

const ROW = '.fg-listing :is(.fg-row-code,.fg-row-data)';
const sel = (addr: number): string => `${ROW}[data-addr="${addr}"]`;
const band = (rgba: string): string => `background-image:linear-gradient(${rgba},${rgba})`;

/** Each class's look, as in Source ✎ (components/source/CodeEditor's theme). */
const LOOKS: Record<string, string> = {
  'fg-run-paused': `${band('rgba(255,166,87,0.22)')};box-shadow:inset 3px 0 0 var(--fg-string)`,
  'fg-run-now': band('rgba(126,231,135,0.24)'),
  'fg-run-stopped': `${band('rgba(255,161,152,0.16)')};box-shadow:inset 3px 0 0 var(--fg-error)`,
  'fg-run-out': `${band('rgba(121,192,255,0.12)')};box-shadow:inset 3px 0 0 var(--fg-register)`,
  'fg-run-trail-1': band('rgba(126,231,135,0.17)'),
  'fg-run-trail-2': band('rgba(126,231,135,0.13)'),
  'fg-run-trail-3': band('rgba(126,231,135,0.09)'),
  'fg-run-trail-4': band('rgba(126,231,135,0.06)'),
  'fg-run-trail-5': band('rgba(126,231,135,0.04)'),
};
/** Where two lines share an address, the earlier class in this order wins. */
const ORDER = Object.keys(LOOKS);

/** The style text for a set of marks; empty when there is nothing to show. */
export function listingCss(l: ListingMarks): string {
  const best = new Map<number, string>();
  for (const mk of l.marks) {
    const had = best.get(mk.addr);
    if (LOOKS[mk.class] !== undefined && (had === undefined || ORDER.indexOf(mk.class) < ORDER.indexOf(had))) best.set(mk.addr, mk.class);
  }
  let css = '';
  for (const [addr, cls] of best) css += `${sel(addr)}{${LOOKS[cls]}}`;
  const breaks = new Set(l.breaks);
  const marker = (addr: number, text: string, colour: string): string => `${sel(addr)} .fg-col-line::before{content:"${text}";float:left;color:var(${colour})}`;
  for (const addr of breaks) if (best.get(addr) !== 'fg-run-paused') css += marker(addr, '●', '--fg-error');
  // ▶ on the paused line: a cue that is not colour alone. Red when the row holds a breakpoint (whether
  // the breakpoint or a step stopped there), whose ● gives way to it; orange otherwise.
  for (const [addr, cls] of best) if (cls === 'fg-run-paused') css += marker(addr, '▶', breaks.has(addr) ? '--fg-error' : '--fg-string');
  return css;
}

let writes = 0;
/** How many times the style's text has been written (the tests count them). */
export const listingStyleWrites = (): number => writes;

/** Sets the style's text, only when it differs; removes the element for null or nothing. */
export function writeListingStyle(css: string | null): void {
  let el = document.getElementById(LISTING_STYLE_ID);
  if (css === null || css === '') {
    el?.remove();
    return;
  }
  if (el === null) {
    el = document.createElement('style');
    el.id = LISTING_STYLE_ID;
    document.head.append(el);
  }
  if (el.textContent === css) return;
  el.textContent = css;
  writes++;
}

/** The listing on the page, displayed or not; null when there is none. */
const listingElement = (): HTMLElement | null => document.querySelector<HTMLElement>('.fg-listing');
const displayed = (el: HTMLElement): boolean => typeof el.checkVisibility !== 'function' || el.checkVisibility();

/** Whether a code or data row at `addr` is drawn and wholly inside the listing's view. */
function rowInView(listing: HTMLElement, addr: number): boolean {
  const box = listing.getBoundingClientRect();
  for (const row of listing.querySelectorAll<HTMLElement>(`[data-addr="${addr}"]`)) {
    if (!row.classList.contains('fg-row-code') && !row.classList.contains('fg-row-data')) continue;
    const r = row.getBoundingClientRect();
    if (r.top >= box.top && r.bottom <= box.bottom) return true;
  }
  return false;
}

/**
 * Keeps the listing's style in step with `debug.listing`, and scrolls the listing through `scroll`
 * (the page's scrollTo) as Ruling 7 says. A pause while the listing is hidden (another left tab)
 * keeps its row and scrolls there once the listing shows, unless the program moves on first, as
 * Source ✎ does. Returns the uninstall, which also removes the style.
 */
export function installListingFollow(debug: Debug, scroll: (addr: number) => void, opts: { now?: () => number } = {}): () => void {
  const now = opts.now ?? (() => performance.now());
  let followAt = -Infinity;
  let pending: number | null = null;
  let observer: IntersectionObserver | null = null;
  const unobserve = (): void => {
    observer?.disconnect();
    observer = null;
  };
  const clearPending = (): void => {
    pending = null;
    unobserve();
  };
  /** Scrolls once `el` shows (happy with any observer that reports it intersecting). */
  function whenShown(el: HTMLElement): void {
    unobserve();
    if (typeof IntersectionObserver !== 'function') return;
    observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting) || pending === null) return;
      const addr = pending;
      clearPending();
      scroll(addr);
    });
    observer.observe(el);
  }
  /** Follow, while running: at most 4 times a second, and only once the row has left view. */
  function follow(l: ListingMarks | null): void {
    if (l === null || !debug.follow.value || debug.mode.value !== 'running') return;
    const addr = l.marks.find((m) => m.class === 'fg-run-now')?.addr;
    const at = now();
    if (addr === undefined || at - followAt < LISTING_FOLLOW_MS) return;
    const listing = listingElement();
    if (listing === null || !displayed(listing) || rowInView(listing, addr)) return;
    followAt = at;
    scroll(addr);
  }
  const stops = [
    watch(debug.listing, (l) => writeListingStyle(l === null ? null : listingCss(l)), { immediate: true }),
    // A pause or a step: its row into view (scrollTo leaves a row already in full view alone).
    watch(debug.reveal, (r) => {
      if (r === null || r.line === null || !debug.listingFollows.value) return;
      const addr = debug.listingAddr(r.line);
      if (addr === null) return;
      const el = listingElement();
      if (el !== null && !displayed(el)) {
        pending = addr;
        whenShown(el);
        return;
      }
      clearPending();
      scroll(addr);
    }),
    // A scroll waiting for the listing to show is stale once the program moves on.
    watch(debug.mode, (m) => {
      if (m !== 'paused') clearPending();
    }),
    watch(debug.listing, follow),
    // Follow switched on: one check now, not only when the line next moves.
    watch(debug.follow, (on) => {
      if (on) follow(debug.listing.value);
    }),
  ];
  return () => {
    for (const stop of stops) stop();
    clearPending();
    writeListingStyle(null);
  };
}
