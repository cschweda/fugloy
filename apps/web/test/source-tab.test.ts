// @vitest-environment happy-dom
// The Source tab: the CodeMirror editor, the list of problems under it, and the
// toolbar over the user's sources (plan 5B, Task 3). Sources live in memory
// here (no storage), through the real createSources.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { EditorView } from '@codemirror/view';
import { createSources } from '../app/composables/useSources';
import type { Sources } from '../app/composables/useSources';

const STARTER = '\tORG\t7000H\nSTART:\tLD\tHL,3C00H\nWAIT:\tJR\tWAIT\n\tEND\tSTART\n';
const BROKEN = '\tORG\t7000H\n\tLDA\n\tPUSH\tA\n\tEND\n';

let sources: Sources;
vi.mock('../app/composables/useSources', async (orig) => ({
  ...(await orig<typeof import('../app/composables/useSources')>()),
  useSources: () => sources,
}));
const downloads: { filename: string; text: string }[] = [];
vi.mock('../app/utils/exports', () => ({
  download: (f: { filename: string; bytes: Uint8Array }) => downloads.push({ filename: f.filename, text: new TextDecoder().decode(f.bytes) }),
}));
const { default: SourceTab } = await import('../app/components/source/SourceTab.vue');

let w: VueWrapper | null = null;

async function open(): Promise<{ w: VueWrapper; view: () => EditorView }> {
  const host = document.createElement('div');
  document.body.append(host);
  w = mount(SourceTab, { attachTo: host });
  await flushPromises();
  await flushPromises();
  const view = (): EditorView => EditorView.findFromDOM(w!.get('.cm-editor').element as HTMLElement)!;
  return { w, view };
}

/** Types over the whole document, as a user would. */
function typeAll(view: EditorView, text: string): void {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, userEvent: 'input.type' });
}

// happy-dom fires selectionchange synchronously when CodeMirror sets the DOM
// selection inside its own update, which CodeMirror refuses; browsers fire it
// later. Stop it before it reaches CodeMirror's listener on the document.
const stopSelectionChange = (e: Event): void => e.stopImmediatePropagation();
window.addEventListener('selectionchange', stopSelectionChange, true);

beforeEach(() => {
  sources = createSources({ open: async () => null, starter: async () => STARTER });
  downloads.length = 0;
});
afterEach(() => {
  w?.unmount();
  w = null;
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('the Source tab', () => {
  it('opens on the starter when there is no source yet, in an editor screen readers can name', async () => {
    const { w, view } = await open();
    expect(sources.list.value.map((s) => s.name)).toEqual(['clear-screen.z']);
    expect(view().state.doc.toString()).toBe(STARTER);
    expect(w.get('.cm-content').attributes('aria-label')).toContain('clear-screen.z');
    expect(w.get('[data-testid="source-diags"]').text()).toContain('No problems');
  });

  it('refreshes the marks 250 ms after typing stops, and lists each as severity, line and message', async () => {
    const { w, view } = await open();
    vi.useFakeTimers();
    typeAll(view(), BROKEN);
    await vi.advanceTimersByTimeAsync(249);
    expect(w.findAll('[data-testid="source-diag"]')).toHaveLength(0);
    typeAll(view(), `${BROKEN}\n`);
    await vi.advanceTimersByTimeAsync(249);
    expect(w.findAll('[data-testid="source-diag"]')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    const items = w.findAll('[data-testid="source-diag"]');
    expect(items).toHaveLength(2);
    expect(items[0]!.text()).toMatch(/Error.*Line 2.*Unknown instruction LDA/);
    expect(items[1]!.text()).toMatch(/Error.*Line 3.*PUSH works on register pairs/);
    expect(w.get('[data-testid="source-diag-count"]').text()).toBe('2 errors');
    // The marks are in the editor too.
    expect(w.findAll('.cm-lintRange-error').length).toBeGreaterThan(0);
    // And the text went to the source, which saves it.
    expect(sources.current.value?.text).toBe(`${BROKEN}\n`);
  });

  it('reveals the line when a problem is clicked, and its Fix button applies the fix', async () => {
    const { w, view } = await open();
    vi.useFakeTimers();
    typeAll(view(), BROKEN);
    await vi.advanceTimersByTimeAsync(250);
    await w.findAll('[data-testid="source-diag-go"]')[1]!.trigger('click');
    const v = view();
    expect(v.state.doc.lineAt(v.state.selection.main.head).number).toBe(3);
    // LDA has no exact rewrite, so no Fix button; PUSH A has one.
    const fixes = w.findAll('[data-testid="source-diag-fix"]');
    expect(fixes).toHaveLength(1);
    expect(fixes[0]!.attributes('aria-label')).toBe('Fix line 3: write PUSH AF');
    await fixes[0]!.trigger('click');
    expect(v.state.doc.toString()).toBe('\tORG\t7000H\n\tLDA\n\tPUSH AF\n\tEND\n');
    // The list follows at once after a fix, without waiting.
    await vi.advanceTimersByTimeAsync(0);
    expect(w.findAll('[data-testid="source-diag"]')).toHaveLength(1);
    expect((w.emitted('fix') ?? []).length).toBe(1);
  });

  it('refuses a list fix made before the latest typing, refreshes the list, and keeps the focus in the editor', async () => {
    const { w, view } = await open();
    vi.useFakeTimers();
    typeAll(view(), BROKEN);
    await vi.advanceTimersByTimeAsync(250);
    // Within the 250 ms, line 3 changes under the stale list: its Fix must not land on the new text.
    const v = view();
    const line3 = v.state.doc.line(3);
    v.dispatch({ changes: { from: line3.from, to: line3.to, insert: '\tPOP\tA' }, userEvent: 'input.type' });
    await w.get('[data-testid="source-diag-fix"]').trigger('click');
    expect(v.state.doc.line(3).text).toBe('\tPOP\tA');
    expect(w.emitted('fix')).toBeUndefined();
    // The list is brought up to date at once (POP A is the same 8080 slip).
    expect(w.findAll('[data-testid="source-diag"]').map((d) => d.text())).toEqual([expect.stringContaining('LDA'), expect.stringContaining('POP works on register pairs')]);
    expect(document.activeElement).toBe(v.contentDOM);
    // A fresh fix applies, and the focus is in the editor, not on the removed button.
    await w.get('[data-testid="source-diag-fix"]').trigger('click');
    expect(v.state.doc.line(3).text).toBe('\tPOP AF');
    expect(document.activeElement).toBe(v.contentDOM);
  });

  it('emits run on Ctrl+Enter in the editor, without inserting a line', async () => {
    const { w, view } = await open();
    const before = view().state.doc.toString();
    view().contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(w.emitted('run')).toHaveLength(1);
    expect(view().state.doc.toString()).toBe(before);
  });
});

describe('the Source toolbar', () => {
  it('makes a new source, and switches between them with the select', async () => {
    const { w, view } = await open();
    await w.get('[data-testid="source-new"]').trigger('click');
    await flushPromises();
    // In name order (useSources), so the list stays still while typing.
    expect(sources.list.value.map((s) => s.name)).toEqual(['clear-screen-2.z', 'clear-screen.z']);
    expect(sources.current.value?.name).toBe('clear-screen-2.z');
    typeAll(view(), '; second\n');
    const first = sources.list.value.find((s) => s.name === 'clear-screen.z')!;
    const select = w.get<HTMLSelectElement>('[data-testid="source-pick"]');
    expect(select.findAll('option').map((o) => o.text())).toEqual(['clear-screen-2.z', 'clear-screen.z']);
    await select.setValue(first.id);
    await flushPromises();
    expect(sources.current.value?.id).toBe(first.id);
    expect(view().state.doc.toString()).toBe(STARTER);
    expect(w.get('.cm-content').attributes('aria-label')).toContain('clear-screen.z');
  });

  it('renames, and says why when a name is refused', async () => {
    const { w } = await open();
    await w.get('[data-testid="source-new"]').trigger('click');
    await flushPromises();
    await w.get('[data-testid="source-rename"]').trigger('click');
    const input = w.get<HTMLInputElement>('[data-testid="source-rename-input"]');
    expect(input.element.value).toBe('clear-screen-2.z');
    await input.setValue('clear-screen.z');
    await w.get('[data-testid="source-rename-form"]').trigger('submit');
    await flushPromises();
    expect(w.get('[data-testid="source-rename-error"]').text()).toBe('clear-screen.z is already the name of another source. Pick a different name.');
    await input.setValue('game.z');
    await w.get('[data-testid="source-rename-form"]').trigger('submit');
    await flushPromises();
    expect(w.find('[data-testid="source-rename-form"]').exists()).toBe(false);
    expect(sources.current.value?.name).toBe('game.z');
  });

  it('deletes only after a confirm', async () => {
    const { w } = await open();
    await w.get('[data-testid="source-new"]').trigger('click');
    await flushPromises();
    await w.get('[data-testid="source-delete"]').trigger('click');
    await flushPromises();
    const dialog = w.get('[data-testid="source-delete-dialog"]');
    expect((dialog.element as HTMLDialogElement).open).toBe(true);
    expect(dialog.text()).toContain('clear-screen-2.z');
    // Cancel keeps it.
    await dialog.findAll('button')[0]!.trigger('click');
    await flushPromises();
    expect(sources.list.value).toHaveLength(2);
    await w.get('[data-testid="source-delete"]').trigger('click');
    await flushPromises();
    await w.get('[data-testid="source-delete-dialog"]').findAll('button')[1]!.trigger('click');
    await flushPromises();
    expect(sources.list.value.map((s) => s.name)).toEqual(['clear-screen.z']);
    expect(sources.current.value?.name).toBe('clear-screen.z');
  });

  it("shows Open as source's reassembly note above its own source only", async () => {
    const { useOpenAsSource } = await import('../app/composables/useOpenAsSource');
    const { w } = await open();
    const first = sources.current.value!;
    const note = 'This source assembles to different bytes from EDFORM.CMD, first at $7000, so Run will not run the original exactly. Compare that line with the Listing before you rely on it.';
    useOpenAsSource().note.value = { sourceId: first.id, text: note };
    await flushPromises();
    expect(w.get('[data-testid="source-open-note"]').text()).toBe(note);
    await sources.create({ name: 'other.z', text: STARTER });
    await flushPromises();
    expect(w.find('[data-testid="source-open-note"]').exists()).toBe(false);
    useOpenAsSource().note.value = null;
  });

  it('downloads the source as a .z file', async () => {
    const { w, view } = await open();
    typeAll(view(), '; mine\n');
    await w.get('[data-testid="source-download"]').trigger('click');
    expect(downloads).toEqual([{ filename: 'clear-screen.z', text: '; mine\n' }]);
    await w.get('[data-testid="source-rename"]').trigger('click');
    await w.get('[data-testid="source-rename-input"]').setValue('game');
    await w.get('[data-testid="source-rename-form"]').trigger('submit');
    await flushPromises();
    await w.get('[data-testid="source-download"]').trigger('click');
    expect(downloads[1]?.filename).toBe('game.z');
  });

  it("lists a Run's ROM notes as warnings while the text is the one Run assembled, and reveals a line without taking the focus", async () => {
    const { w, view } = await open();
    const note = { line: 2, column: 1, endColumn: 5, severity: 'warning' as const, message: 'Line 2 points HL at $0000, inside the ROM space.' };
    await w.setProps({ report: { text: STARTER, diagnostics: [], notes: [note] } });
    await flushPromises();
    expect(w.findAll('[data-testid="source-diag"]').map((d) => d.text())).toEqual([expect.stringMatching(/^Warning\s*Line 2\s*Line 2 points HL/)]);
    expect(w.get('[data-testid="source-diag-count"]').text()).toBe('1 warning');
    (document.activeElement as HTMLElement | null)?.blur();
    (w.vm as unknown as { showLine(n: number): void }).showLine(3);
    expect(view().state.doc.lineAt(view().state.selection.main.head).number).toBe(3);
    expect(view().hasFocus).toBe(false);
    // Typing makes the notes stale: the next check drops them.
    vi.useFakeTimers();
    view().dispatch({ changes: { from: view().state.doc.length, insert: '\n' }, userEvent: 'input.type' });
    await vi.advanceTimersByTimeAsync(250);
    expect(w.findAll('[data-testid="source-diag"]')).toHaveLength(0);
  });
});
