/**
 * @fugloy/runtime/player: the parts of the browser player (M2) that need no browser, for a host that runs
 * a port itself, and `play`, the worker's loop. The page (page.js), the worker's own wiring (the end of
 * worker.js) and index.html are the files a served player loads; @fugloy/recomp's `pnpm play` copies them.
 */
export { BEHIND_LIMIT_MS, FRAME_RATE, MAX_WAIT_MS, createClock, frameHook, frameLength } from './frame.js';
export { LEAD_S, MAX_LATENCY_S, createAudioSchedule, samples } from './sound.js';
export { BROWSER_KEYS, KeyTracker, MIN_HOLD_FRAMES } from './keys.js';
export { START, begin, play } from './worker.js';
