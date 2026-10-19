// The browser checks' hook (window.__fugloyTest), set by app/pages/index.vue only in a build made
// with NUXT_PUBLIC_E2E=1. One declaration for the page and the Playwright specs, so they cannot drift.
interface FugloyTestHook {
  rowCount: () => number;
  scrollToAddr: (addr: number) => void;
  setCursor: (addr: number | null) => void;
  rerender: (kind: 'tables' | 'names') => void;
  load: (bytes: number[], name: string, hints?: string, base?: number) => void;
  /** The open program's loaded bytes, in address order. */
  loadedBytes: () => number[];
  /** Presses Run ▶. */
  run: () => Promise<void>;
  /** The running machine's screen as text rows (m.video.text()); empty with no machine. */
  screenText: () => string[];
  runnerState: () => string;
  /** Pauses the running program (5C). */
  pause: () => void;
  /** The debugger's mode: idle, running, paused or stopped. */
  debugMode: () => string;
  /** What the listing's <style> lights, by address; null when the listing does not follow, or nothing runs. */
  listingMarks: () => { marks: { addr: number; class: string }[]; breaks: number[] } | null;
  /** The running-line update's cost per frame over `ms` milliseconds; throws when no frame ran. */
  frameCost: (ms: number) => Promise<{ frames: number; mean: number; max: number }>;
}

interface Window {
  /** Drives the workbench from the Playwright checks (test/e2e). Takes only bytes it is handed; fetches nothing. */
  __fugloyTest?: FugloyTestHook;
}
