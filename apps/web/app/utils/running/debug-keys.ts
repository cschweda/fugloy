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
// They act inside `data-own-keys` panels, in CodeMirror's content, on buttons and checkboxes, and
// on the TRS-80 screen (whose keyboard leaves these keys alone). They wait in a text-entry field
// (TEXTAREA, SELECT, contenteditable other than the editor, and INPUT of type text, search, number,
// email, url, tel or password), under an open dialog, and when something on the way already handled
// the key. While a program is running or paused, F5, Shift+F5 and Ctrl/⌘+F5 are swallowed
// everywhere, fields and dialogs included, so no reload ever ends it (outside fields Shift+F5
// stops it). Shift+F10 (the listing's context menu) and Alt+any are the browser's. The
// announcements are announce.ts's speakAnnouncements, installed apart from this chunk.
import type { Debug } from '../../composables/useDebug';

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

/** INPUT types that take typed text; a checkbox, radio, button or file input never uses F-keys. */
const TEXT_TYPES: ReadonlySet<string> = new Set(['text', 'search', 'number', 'email', 'url', 'tel', 'password']);

/**
 * A text-entry field, where the keys wait (after utils/keys' isTyping, copied, not imported). The
 * editor's contenteditable is not one: the keys act there (Ruling 10).
 */
export function inField(target: EventTarget | null): boolean {
  const el = target as { tagName?: unknown; type?: unknown; isContentEditable?: unknown; closest?: (s: string) => Element | null } | null;
  if (el === null || typeof el.tagName !== 'string') return false;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName === 'INPUT') return TEXT_TYPES.has(typeof el.type === 'string' && el.type !== '' ? el.type.toLowerCase() : 'text');
  return el.isContentEditable === true && (typeof el.closest !== 'function' || el.closest('.cm-editor') === null);
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
  // No reload of any kind under a program (F5, Shift+F5, Ctrl/⌘+F5).
  const reload = e.key === 'F5' && underWay;
  if (inField(e.target) || dialogOpen()) {
    if (reload) e.preventDefault();
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
      if (reload) e.preventDefault();
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
  if (installs.length === 1) document.addEventListener('keydown', onKeydown);
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    installs.splice(installs.indexOf(entry), 1);
    if (installs.length === 0) document.removeEventListener('keydown', onKeydown);
  };
}
