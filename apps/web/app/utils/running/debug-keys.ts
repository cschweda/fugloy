// The debug keys (phase 5C Ruling 10): one document listener, installed while Source ✎ or Run ▶ is
// mounted (each installs; the listener goes with the last). Lazy (utils/running/), so none of it is
// on the first screen; it copies the few lines it needs from utils/keys rather than importing it.
//
// | Key          | Action                               | Claimed when                         |
// | F5           | Continue; Run when idle or stopped   | always (swallowed while running)     |
// | F6           | Pause                                | running                              |
// | Shift+F5     | Stop                                 | running or paused                    |
// | F9           | Toggle the cursor line's breakpoint  | focus in the editor (or the listing) |
// | F10          | Step Over                            | running or paused                    |
// | F11, F7      | Step                                 | running or paused                    |
// | Ctrl/⌘+F10   | Run to Here                          | running or paused                    |
//
// They act inside `data-own-keys` panels, in CodeMirror's content, and on the TRS-80 screen (whose
// keyboard leaves these keys alone). They wait in INPUT, TEXTAREA and SELECT, under an open dialog,
// and when something on the way already handled the key; but a plain F5 is still swallowed there
// while a program is under way, so a reload never ends it. Shift+F10 (the listing's context menu),
// Alt+any, and Ctrl/⌘+F5 are the browser's. The first install also routes the coordinator's
// announcements to the page's one status region (announce.ts), a step's after 150 ms.
import { effectScope, watch } from 'vue';
import type { EffectScope } from 'vue';
import type { Debug } from '../../composables/useDebug';
import { announcer, STEP_DEBOUNCE_MS } from './announce';

export type FocusTarget = 'source' | 'listing';

export interface DebugKeyOptions {
  /** Run ▶ (F5 when nothing is running). */
  runNow(): void;
  /** Stop (Shift+F5). */
  stop(): void;
  /** Where focus is, or was last, among the editor and the listing: Run to Here's line comes from there (Ruling 9). */
  focusTarget(): FocusTarget | null;
  /** The source line under that cursor (null when there is none). */
  cursorLine?(where: FocusTarget): number | null;
  /** run.message: a sentence when a key cannot act. */
  say(text: string): void;
}

/** Run to Here with no line to run to. */
export const NO_RUN_TO_LINE = 'Run to Here runs to the line under the cursor in Source ✎. Put the cursor on a line with an instruction there, then press Run to Here again.';

interface Install {
  debug: Debug;
  opts: DebugKeyOptions;
}
const installs: Install[] = [];
let scope: EffectScope | null = null;

/** Copied from utils/keys (isTyping without contenteditable, which the editor is, and modalOpen). */
function inField(target: EventTarget | null): boolean {
  const tag = (target as { tagName?: unknown } | null)?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
const dialogOpen = (): boolean => document.querySelector('dialog[open]') !== null;

/** The editor or the listing, if the key press comes from inside one. */
function placeOf(target: EventTarget | null): FocusTarget | null {
  const el = target as { closest?: (s: string) => Element | null } | null;
  if (el === null || typeof el.closest !== 'function') return null;
  if (el.closest('.cm-editor') !== null) return 'source';
  if (el.closest('.fg-listing') !== null) return 'listing';
  return null;
}

/** The first install that answers. */
function ask<T>(f: (i: Install) => T | null | undefined): T | null {
  for (const i of installs) {
    const v = f(i);
    if (v !== null && v !== undefined) return v;
  }
  return null;
}

/** The cursor line at `where` (else where focus was last), from whichever tab knows it. */
function cursorAt(where: FocusTarget | null): number | null {
  const at = where ?? ask((i) => i.opts.focusTarget());
  return at === null ? null : ask((i) => i.opts.cursorLine?.(at));
}

/**
 * Run to Here (Ctrl/⌘+F10, and Run ▶'s button): to the cursor line in Source ✎, or the listing's
 * if focus was last there. Returns the sentence it said when there is no line to run to.
 */
export function runToHere(debug: Debug, opts: Pick<DebugKeyOptions, 'say'>, where: FocusTarget | null = null): string | null {
  const line = cursorAt(where);
  if (line === null) {
    opts.say(NO_RUN_TO_LINE);
    return NO_RUN_TO_LINE;
  }
  debug.runToLine(line);
  return null;
}

function onKeydown(e: KeyboardEvent): void {
  const top = installs[0];
  if (top === undefined || e.altKey || !/^F(?:5|6|7|9|10|11)$/.test(e.key)) return;
  const { debug, opts } = top;
  const mode = debug.mode.value;
  const underWay = mode === 'running' || mode === 'paused';
  const ctrl = e.ctrlKey || e.metaKey;
  const plain = !ctrl && !e.shiftKey;
  if (e.defaultPrevented) return;
  if (inField(e.target) || dialogOpen()) {
    if (e.key === 'F5' && plain && underWay) e.preventDefault();
    return;
  }
  const claim = (act: () => void): void => {
    e.preventDefault();
    act();
  };
  switch (e.key) {
    case 'F5':
      if (plain) {
        if (mode === 'running') return e.preventDefault();
        // Source ✎'s Run (the one that knows a cursor) also shows Run ▶; Run ▶'s own runs in place.
        return claim(mode === 'paused' ? () => debug.continue() : () => (ask((i) => (i.opts.cursorLine === undefined ? null : i.opts)) ?? opts).runNow());
      }
      if (e.shiftKey && !ctrl && underWay) return claim(() => opts.stop());
      return;
    case 'F6':
      if (plain && mode === 'running') claim(() => debug.pause());
      return;
    case 'F9': {
      if (!plain) return;
      const where = placeOf(e.target);
      const line = where === null ? null : cursorAt(where);
      if (line !== null) claim(() => debug.toggleBreakpoint(line));
      return;
    }
    case 'F10':
      if (e.shiftKey || !underWay) return;
      if (ctrl) return claim(() => void runToHere(debug, opts, placeOf(e.target)));
      return claim(() => debug.stepOver());
    case 'F11':
    case 'F7':
      if (plain && underWay) claim(() => debug.step());
      return;
  }
}

/** Installs the debug keys for `debug` (refcounted: one listener however many tabs); returns the uninstall. */
export function installDebugKeys(debug: Debug, opts: DebugKeyOptions): () => void {
  const entry: Install = { debug, opts };
  installs.push(entry);
  if (installs.length === 1) {
    document.addEventListener('keydown', onKeydown);
    const say = announcer();
    scope = effectScope(true);
    // Sync: every sentence reaches the announcer, which debounces the steps itself.
    scope.run(() =>
      watch(
        debug.announcement,
        (a) => {
          if (a !== null) say.say(a.text, a.step ? { debounce: STEP_DEBOUNCE_MS } : undefined);
        },
        { flush: 'sync' },
      ),
    );
  }
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    installs.splice(installs.indexOf(entry), 1);
    if (installs.length > 0) return;
    document.removeEventListener('keydown', onKeydown);
    scope?.stop();
    scope = null;
  };
}
