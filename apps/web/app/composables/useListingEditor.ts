// The listing's editing UI: the marking keys, the inline editor N and ; open
// under the cursor row, the right-click menu, and the message a refused edit
// leaves under the listing. The edits themselves go through useEditing, so
// each is a hint-file change. The page hands in the listing and how to move
// the cursor; this returns the key bindings to merge into the page's map.
import { computed, nextTick, ref } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import { summarizeRoutine } from '@fugloy/disasm';
import { editTargets, markRange } from '../utils/edit-targets';
import type { EditTarget } from '../utils/edit-targets';
import type { Edit, MarkKind } from '../utils/edits';
import type { MenuItem } from '../components/listing/RowMenu.vue';
import type { InlineChoice } from '../components/listing/InlineEdit.vue';
import { useEditing } from './useEditing';
import { useWorkbench } from './useWorkbench';
import type { KeyBinding } from './useWorkbenchKeys';

/** What the editor needs of ListingView. */
export interface ListingHandle {
  scrollToAddr(addr: number): void;
  cursorRect(): DOMRect | null;
  focus(): void;
}

export interface Inline {
  op: 'name' | 'comment';
  targets: EditTarget[];
  addr: number;
  text: string;
  error: string | null;
  left: number;
  top: number;
}

export interface Notes {
  /** The address the comment goes above while `scope` is `line`: the cursor row. */
  line: number;
  /** The routine start and name, when the cursor is inside a routine that starts elsewhere; the comment can go above it. */
  routine: { start: number; name: string } | null;
  scope: 'routine' | 'line';
  title: string;
  text: string;
  /** What the field started with, so a scope switch can tell an edited draft from the prefill. */
  prefill: string;
  /** Existing lines Use as comment kept above the summary. */
  keeps: number;
  error: string | null;
  left: number;
  top: number;
}

const $a = (addr: number): string => `$${addr.toString(16).toUpperCase().padStart(4, '0')}`;

export function useListingEditor(opts: {
  listing: Ref<ListingHandle | null>;
  /** Moves the cursor to a row, as a click on it would; the menu uses it for a right-click outside the selection. */
  select: (addr: number) => void;
  /** Shows the listing (the left page's Listing tab). */
  showListing: () => void;
}) {
  const wb = useWorkbench();
  const { session, rows, cursor, selection } = wb;
  const ed = useEditing();
  const editMessage = ref<string | null>(null);

  function edit(e: Edit): void {
    editMessage.value = ed.apply(e);
  }

  /** A proposal's hint lines, from the Program tab's Apply. */
  function applyHintLines(lines: string[]): void {
    editMessage.value = ed.applyLines(lines);
  }

  /** C, D, W, S on the selection (or the cursor row); T declares a jump table there. */
  function mark(as: MarkKind | 'table'): void {
    const r = markRange(rows.value, cursor.value, selection.value);
    if (r === null) return;
    edit(as === 'table' ? { op: 'table', ...r } : { op: 'mark', as, ...r });
  }

  function undo(): void {
    editMessage.value = null;
    ed.undo();
  }

  function redo(): void {
    editMessage.value = null;
    ed.redo();
  }

  // The inline editor.
  const inline = ref<Inline | null>(null);

  /** What the field starts with: the address's user name, or its comment. */
  function inlineText(op: Inline['op'], addr: number): string {
    const s = session.value;
    if (s === null) return '';
    if (op === 'comment') return s.analysis.annotations.comments.get(addr) ?? '';
    const sym = s.analysis.symbols.get(addr);
    return sym?.source === 'user' ? sym.name : '';
  }

  const inlinePlaceholder = computed(() => {
    const i = inline.value;
    if (i === null) return '';
    if (i.op === 'comment') return 'a comment (empty removes it)';
    const sym = session.value?.analysis.symbols.get(i.addr);
    return sym === undefined || sym.source === 'user' ? 'a name (empty removes it)' : `a name for ${sym.name}`;
  });

  const inlineChoices: ComputedRef<InlineChoice[]> = computed(() =>
    (inline.value?.targets ?? []).map((t) => ({ value: t.addr, label: `${$a(t.addr)} (${t.what === 'row' ? 'this row' : 'operand'})` })),
  );

  const inlineChoice = computed({
    get: () => inline.value?.addr ?? 0,
    set: (addr: number) => {
      const i = inline.value;
      if (i !== null) inline.value = { ...i, addr, text: inlineText(i.op, addr), error: null };
    },
  });

  const inlineValue = computed({
    get: () => inline.value?.text ?? '',
    set: (text: string) => {
      if (inline.value !== null) inline.value = { ...inline.value, text, error: null };
    },
  });

  /** Where the cursor row's text starts on screen, after scrolling it into view. */
  async function cursorPlace(): Promise<{ left: number; bottom: number } | null> {
    const at = cursor.value;
    if (at === null) return null;
    opts.listing.value?.scrollToAddr(at);
    // One tick for the scroll, one for the rows it renders.
    await nextTick();
    await nextTick();
    const r = opts.listing.value?.cursorRect();
    return r === null || r === undefined ? null : { left: r.left, bottom: r.bottom };
  }

  async function openInline(op: Inline['op']): Promise<void> {
    const s = session.value;
    const at = cursor.value;
    if (s === null || at === null) return;
    closeMenu(false);
    opts.showListing();
    editMessage.value = null;
    const place = await cursorPlace();
    if (place === null) return;
    inline.value = { op, targets: editTargets(s, at), addr: at, text: inlineText(op, at), error: null, left: place.left, top: place.bottom + 2 };
  }

  function closeInline(): void {
    if (inline.value === null) return;
    inline.value = null;
    void nextTick(() => opts.listing.value?.focus());
  }

  /** Applies the inline edit; a refused one keeps the editor open with the reason, and the hint file as it was. */
  function submitInline(): void {
    const i = inline.value;
    if (i === null) return;
    const error = ed.apply(i.op === 'name' ? { op: 'name', addr: i.addr, name: i.text } : { op: 'comment', addr: i.addr, text: i.text });
    if (error !== null) {
      inline.value = { ...i, error };
      return;
    }
    editMessage.value = null;
    closeInline();
  }

  // The Block comment box.
  const notes = ref<Notes | null>(null);

  const notesAddr = (n: Notes): number => (n.routine !== null && n.scope === 'routine' ? n.routine.start : n.line);
  const notesText = (addr: number): string => (session.value?.analysis.annotations.notes.get(addr) ?? []).join('\n');

  /** `:` opens it at the cursor; Use as comment passes the routine's summary and opens it above the routine's start. */
  async function openNotes(use?: { start: number; name: string; text: string }): Promise<void> {
    const s = session.value;
    const at = cursor.value;
    if (s === null || at === null) return;
    closeMenu(false);
    inline.value = null;
    opts.showListing();
    editMessage.value = null;
    const place = await cursorPlace();
    if (place === null) return;
    const where = { left: place.left, top: place.bottom + 2, error: null };
    if (use !== undefined) {
      // Notes already there stay first; Save keeps them unless they are deleted.
      const kept = s.analysis.annotations.notes.get(use.start) ?? [];
      const text = kept.length === 0 ? use.text : `${kept.join('\n')}\n\n${use.text}`;
      notes.value = { ...where, line: use.start, routine: null, scope: 'line', title: `Block comment above the routine ${use.name}`, text, prefill: text, keeps: kept.length };
      return;
    }
    const r = summarizeRoutine(s, at);
    const routine = r !== null && r.start !== at ? { start: r.start, name: r.name } : null;
    const scope = routine === null ? 'line' : 'routine';
    const addr = routine === null ? at : routine.start;
    notes.value = { ...where, line: at, routine, scope, title: `Block comment above ${$a(addr)}`, text: notesText(addr), prefill: notesText(addr), keeps: 0 };
  }

  const notesValue = computed({
    get: () => notes.value?.text ?? '',
    set: (text: string) => {
      if (notes.value !== null) notes.value = { ...notes.value, text, error: null };
    },
  });

  const notesScope = computed({
    get: () => notes.value?.scope ?? 'line',
    set: (scope: 'routine' | 'line') => {
      const n = notes.value;
      if (n === null) return;
      const next = { ...n, scope, error: null };
      const addr = notesAddr(next);
      // A draft the user has edited stays; only an untouched prefill is swapped for the other address's notes.
      const untouched = n.text === n.prefill;
      notes.value = { ...next, title: `Block comment above ${$a(addr)}`, text: untouched ? notesText(addr) : n.text, prefill: notesText(addr) };
    },
  });

  function closeNotes(): void {
    if (notes.value === null) return;
    notes.value = null;
    void nextTick(() => opts.listing.value?.focus());
  }

  function submitNotes(): void {
    const n = notes.value;
    if (n === null) return;
    const error = ed.apply({ op: 'notes', addr: notesAddr(n), lines: n.text.split(/\r?\n/) });
    if (error !== null) {
      notes.value = { ...n, error };
      return;
    }
    editMessage.value = null;
    closeNotes();
  }

  // The right-click menu.
  const menu = ref<{ x: number; y: number } | null>(null);
  const isMac = ref(false);
  const MENU_ACTIONS: Record<string, () => void> = {
    code: () => mark('code'),
    bytes: () => mark('bytes'),
    words: () => mark('words'),
    string: () => mark('string'),
    table: () => mark('table'),
    name: () => void openInline('name'),
    comment: () => void openInline('comment'),
    notes: () => void openNotes(),
    undo,
    redo,
  };
  const menuItems = computed<MenuItem[]>(() => [
    { id: 'code', label: 'Code', keys: 'C', accel: 'c' },
    { id: 'bytes', label: 'Bytes', keys: 'D', accel: 'd' },
    { id: 'words', label: 'Words', keys: 'W', accel: 'w' },
    { id: 'string', label: 'String', keys: 'S', accel: 's' },
    { id: 'table', label: 'Jump table', keys: 'T', accel: 't' },
    { id: 'name', label: 'Rename…', keys: 'N', accel: 'n', rule: true },
    { id: 'comment', label: 'Comment…', keys: ';', accel: ';' },
    { id: 'notes', label: 'Block comment…', keys: ':', accel: ':' },
    { id: 'undo', label: 'Undo', keys: isMac.value ? '⌘Z' : 'Ctrl+Z', disabled: !ed.canUndo.value, rule: true },
    { id: 'redo', label: 'Redo', keys: isMac.value ? '⇧⌘Z' : 'Ctrl+Y', disabled: !ed.canRedo.value },
  ]);

  function openMenu(x: number, y: number): void {
    inline.value = null;
    menu.value = { x, y };
  }

  function closeMenu(refocus = true): void {
    if (menu.value === null) return;
    menu.value = null;
    if (refocus) void nextTick(() => opts.listing.value?.focus());
  }

  function pickMenu(id: string): void {
    // Rename and Comment move focus to the inline editor instead.
    closeMenu(id !== 'name' && id !== 'comment' && id !== 'notes');
    MENU_ACTIONS[id]?.();
  }

  /** A right-click on a row: outside the selection, it moves the cursor there first. */
  function onContext(addr: number, x: number, y: number): void {
    const sel = selection.value;
    if (sel === null || addr < sel.from || addr > sel.to) opts.select(addr);
    openMenu(x, y);
  }

  /** The ContextMenu key or Shift+F10: the menu opens on the cursor row. */
  async function menuAtCursor(): Promise<void> {
    const place = await cursorPlace();
    if (place !== null) openMenu(place.left, place.bottom);
  }

  const keys: Record<string, KeyBinding> = {
    c: { run: () => mark('code') },
    d: { run: () => mark('bytes') },
    w: { run: () => mark('words') },
    s: { run: () => mark('string') },
    t: { run: () => mark('table') },
    n: { run: () => void openInline('name') },
    ';': { run: () => void openInline('comment') },
    ':': { run: () => void openNotes() },
    'ctrl+z': { run: undo },
    'ctrl+shift+z': { run: redo },
    'ctrl+y': { run: redo },
    contextmenu: { run: () => void menuAtCursor(), listing: true },
    'shift+f10': { run: () => void menuAtCursor(), listing: true },
  };

  return {
    editMessage,
    applyHintLines,
    inline,
    inlineValue,
    inlineChoice,
    inlineChoices,
    inlinePlaceholder,
    submitInline,
    closeInline,
    notes,
    notesValue,
    notesScope,
    openNotes,
    submitNotes,
    closeNotes,
    menu,
    menuItems,
    isMac,
    pickMenu,
    closeMenu,
    onContext,
    menuAtCursor,
    keys,
    /** True while the menu or the inline editor has the keys. */
    busy: computed(() => menu.value !== null || inline.value !== null || notes.value !== null),
  };
}
