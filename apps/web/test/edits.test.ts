import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { formatRow, listingRows, openProgram, withHintFile, withHintText, writeHints } from '@fugloy/disasm';
import type { Session } from '@fugloy/disasm';
import { applyEdit, applyHintLines } from '../app/utils/edits';
import type { Edit } from '../app/utils/edits';
import { createWorkbench } from '../app/composables/useWorkbench';
import { createEditing } from '../app/composables/useEditing';

const repo = (path: string): string => fileURLToPath(new URL(`../../../${path}`, import.meta.url));
const MODEL3 = { machine: 3, dos: 'trsdos' } as const;

/** seadrg01 with its committed hints: the game relocated from $5200 to $497F, one block. */
function seaDragon(): Session {
  const s = openProgram(new Uint8Array(readFileSync(repo('examples/sea-dragon/seadrg01.cmd'))), { name: 'seadrg01.cmd', selection: MODEL3 });
  return withHintText(s, readFileSync(repo('examples/sea-dragon/seadrg01.hints'), 'utf8'), 'seadrg01.hints');
}

/** Applies an edit that must succeed and returns the re-analyzed session. */
function edited(s: Session, e: Edit): Session {
  const r = applyEdit(s, e);
  if ('error' in r) throw new Error(r.error);
  return withHintFile(s, r.file, s.hintSource);
}

const errorOf = (s: Session, e: Edit): string => {
  const r = applyEdit(s, e);
  return 'error' in r ? r.error : '(no error)';
};

const rowAt = (s: Session, addr: number, kind = 'code'): string => {
  const row = listingRows(s.analysis).find((r) => r.kind === kind && 'addr' in r && r.addr === addr);
  return row === undefined ? '(no row)' : formatRow(row);
};

describe('applyEdit', () => {
  it('names a loaded address with a block hint at its file offset, and the listing calls it by the name', () => {
    const s = seaDragon();
    const r = applyEdit(s, { op: 'name', addr: 0x4b9e, name: 'INIT' });
    if ('error' in r) throw new Error(r.error);
    const offset = (0x4b9e - 0x497f).toString(16).toUpperCase().padStart(4, '0');
    expect(writeHints(r.file)).toContain(`block 0:$${offset} name INIT`);
    const after = withHintFile(s, r.file, s.hintSource);
    expect(rowAt(after, 0x499a)).toContain('CALL INIT');
  });

  it('refuses a reserved word with its reason, a taken name ignoring case, and a table name', () => {
    const s = seaDragon();
    expect(errorOf(s, { op: 'name', addr: 0x4b9e, name: 'LD' })).toContain('reserved');
    expect(errorOf(s, { op: 'name', addr: 0x4b9e, name: 'L1234' })).toContain('generated label');
    expect(errorOf(s, { op: 'name', addr: 0x4b9e, name: 'MODEPORT' })).toBe('MODEPORT is a ROM/hardware name; choose another');
    const named = edited(s, { op: 'name', addr: 0x9010, name: 'SCORE' });
    expect(errorOf(named, { op: 'name', addr: 0x4b9e, name: 'score' })).toBe('score is already the name of $9010');
    // Renaming an address to its own name again is not a collision.
    expect(errorOf(named, { op: 'name', addr: 0x9010, name: 'Score' })).toBe('(no error)');
  });

  it('names and comments an address the program does not load with `at` hints', () => {
    // $7F00 is inside Sea Dragon's relocated game; $9000 is above everything it loads.
    const s = edited(seaDragon(), { op: 'comment', addr: 0x9000, text: 'top' });
    expect(writeHints(s.hintFile)).toContain('at $9000 comment top');
    const named = edited(s, { op: 'name', addr: 0x9000, name: 'TOP' });
    expect(writeHints(named.hintFile)).toContain('at $9000 name TOP');
    expect(named.applied.rejected).toBe(0);
  });

  it('notes: adds block comment lines in order, replaces them, and an empty list removes them', () => {
    const s0 = seaDragon();
    const s1 = edited(s0, { op: 'notes', addr: 0x4b9e, lines: ['  first\tline ', '', 'third'] });
    expect(s1.analysis.annotations.notes.get(0x4b9e)).toEqual(['first line', '', 'third']);
    const text = writeHints(s1.hintFile);
    expect(text).toMatch(/block 0:\$021F note first line\n.*block 0:\$021F note\n.*block 0:\$021F note third/s);
    const s2 = edited(s1, { op: 'notes', addr: 0x4b9e, lines: ['only', '', ''] });
    expect(s2.analysis.annotations.notes.get(0x4b9e)).toEqual(['only']);
    expect(writeHints(edited(s2, { op: 'notes', addr: 0x4b9e, lines: [] }).hintFile)).toBe(writeHints(s0.hintFile));
  });

  it('notes: refuses an address the program does not load', () => {
    expect(errorOf(seaDragon(), { op: 'notes', addr: 0x9000, lines: ['x'] })).toBe('notes describe loaded code');
  });

  it('refuses to mark an address the program does not load', () => {
    expect(errorOf(seaDragon(), { op: 'mark', from: 0x9000, to: 0x9003, as: 'bytes' })).toMatch(/not loaded/);
    expect(errorOf(seaDragon(), { op: 'table', from: 0x9000, to: 0x9003 })).toMatch(/not loaded/);
  });

  it('marks a range with one directive covering it, and a later mark at the same place replaces it', () => {
    const s = seaDragon();
    const off = (a: number): string => `$${(a - 0x497f).toString(16).toUpperCase().padStart(4, '0')}`;
    const bytes = edited(s, { op: 'mark', from: 0x4b9e, to: 0x4ba1, as: 'bytes' });
    expect(writeHints(bytes.hintFile)).toContain(`block 0:${off(0x4b9e)} bytes $0004`);
    expect(rowAt(bytes, 0x4b9e, 'data')).toContain('DB');
    const words = edited(bytes, { op: 'mark', from: 0x4b9e, to: 0x4ba1, as: 'words' });
    const text = writeHints(words.hintFile);
    expect(text).toContain(`block 0:${off(0x4b9e)} words $0004`);
    expect(text).not.toContain('bytes $0004');
    const table = edited(s, { op: 'table', from: 0x4b9e, to: 0x4ba1 });
    expect(writeHints(table.hintFile)).toContain(`block 0:${off(0x4b9e)} table 2 2`);
  });

  it('an empty comment or name removes the one there', () => {
    const s = seaDragon();
    const commented = edited(s, { op: 'comment', addr: 0x4b9e, text: 'set up the screen' });
    expect(rowAt(commented, 0x4b9e)).toContain('; set up the screen');
    expect(writeHints(edited(commented, { op: 'comment', addr: 0x4b9e, text: '' }).hintFile)).toBe(writeHints(s.hintFile));
    const named = edited(s, { op: 'name', addr: 0x4b9e, name: 'INIT' });
    expect(writeHints(edited(named, { op: 'name', addr: 0x4b9e, name: '' }).hintFile)).toBe(writeHints(s.hintFile));
  });

  it("keys edits by the hint file's own block numbers, and declares a run the file lacks", () => {
    const s = seaDragon();
    const renumbered = withHintText(s, writeHints(s.hintFile).replace(/^block 0/gm, 'block 3'), 'other.hints');
    expect(writeHints(edited(renumbered, { op: 'name', addr: 0x4b9e, name: 'INIT' }).hintFile)).toContain('block 3:$021F name INIT');
    // A hint file with no block for the program's one run gains a declaration for it.
    const empty = withHintText(s, 'fugloy-hints 1\n', 'empty.hints');
    const text = writeHints(edited(empty, { op: 'comment', addr: 0x5200, text: 'loads here' }).hintFile);
    expect(text).toContain('block 0 length $3690 hash d2d65cca12ac798d');
    expect(text).toContain('block 0:$0000 comment loads here');
  });

  it('writes hint files that parse back unchanged', () => {
    let s = seaDragon();
    s = edited(s, { op: 'name', addr: 0x4b9e, name: 'INIT' });
    s = edited(s, { op: 'comment', addr: 0x9000, text: 'top of RAM; free' });
    s = edited(s, { op: 'mark', from: 0x4ba0, to: 0x4ba3, as: 'string' });
    const text = writeHints(s.hintFile);
    const again = withHintText(s, text, 'x.hints');
    expect(writeHints(again.hintFile)).toBe(text);
  });
});

describe('applyHintLines', () => {
  it("adds a proposal's lines to the hint file", () => {
    const s = openProgram(new Uint8Array(readFileSync(repo('examples/sea-dragon/seadrg01.cmd'))), { name: 'seadrg01.cmd', selection: MODEL3 });
    const r = applyHintLines(s, ['block 0:$0000 relocate $497F $3681', 'block 0:$0000 entry']);
    if ('error' in r) throw new Error(r.error);
    expect(writeHints(r.file)).toBe(writeHints(seaDragon().hintFile));
    // Applying them twice adds nothing.
    const twice = applyHintLines(withHintFile(s, r.file), ['block 0:$0000 entry']);
    if ('error' in twice) throw new Error(twice.error);
    expect(twice.file.hints).toHaveLength(2);
  });

  it('says why a line does not parse', () => {
    const r = applyHintLines(seaDragon(), ['block 0:$0000 frobnicate']);
    expect('error' in r && r.error).toContain('frobnicate');
  });
});

describe('useEditing', () => {
  const readExample = async (path: string): Promise<Uint8Array | null> => {
    try {
      return new Uint8Array(readFileSync(repo(`examples/${path}`)));
    } catch {
      return null;
    }
  };

  it('undo after two edits restores the original hint file exactly, and redo brings them back', async () => {
    const wb = createWorkbench({ readExample });
    await wb.openExample('sea-dragon');
    const ed = createEditing(wb);
    const original = writeHints(wb.session.value!.hintFile);
    expect(ed.canUndo.value).toBe(false);
    expect(ed.apply({ op: 'name', addr: 0x4b9e, name: 'INIT' })).toBeNull();
    expect(ed.apply({ op: 'comment', addr: 0x4b9e, text: 'clear the screen' })).toBeNull();
    const twoEdits = writeHints(wb.session.value!.hintFile);
    ed.undo();
    ed.undo();
    expect(writeHints(wb.session.value!.hintFile)).toBe(original);
    expect(ed.canUndo.value).toBe(false);
    expect(ed.canRedo.value).toBe(true);
    ed.redo();
    ed.redo();
    expect(writeHints(wb.session.value!.hintFile)).toBe(twoEdits);
  });

  it('a refused edit leaves the hint file and the history unchanged', async () => {
    const wb = createWorkbench({ readExample });
    await wb.openExample('sea-dragon');
    const ed = createEditing(wb);
    const before = wb.session.value;
    expect(ed.apply({ op: 'name', addr: 0x4b9e, name: 'LD' })).toContain('reserved');
    expect(wb.session.value).toBe(before);
    expect(ed.canUndo.value).toBe(false);
  });

  it('opening another program starts a new history', async () => {
    const wb = createWorkbench({ readExample });
    await wb.openExample('sea-dragon');
    const ed = createEditing(wb);
    ed.apply({ op: 'name', addr: 0x4b9e, name: 'INIT' });
    await wb.openExample('sea-dragon', 'seadrg06.cmd');
    expect(ed.canUndo.value).toBe(false);
  });

  it('keeps the cursor on its address across an edit', async () => {
    const wb = createWorkbench({ readExample });
    await wb.openExample('sea-dragon');
    const ed = createEditing(wb);
    wb.cursor.value = 0x499a;
    ed.apply({ op: 'name', addr: 0x4b9e, name: 'INIT' });
    expect(wb.cursor.value).toBe(0x499a);
  });
});

const ASYLUM = repo('fixtures/real/Asylum (1981)(Frank Corr & William F Denman Jr-Med Systems Software)[CMD]/asylum16.cmd');
const ASYLUM_HINTS = repo('fixtures/hints/asylum16.hints');

describe.skipIf(!existsSync(ASYLUM) || !existsSync(ASYLUM_HINTS))('edit timing (asylum16, when present)', () => {
  it('one rename re-analyzes and re-renders in well under 200 ms', () => {
    const base = withHintText(openProgram(new Uint8Array(readFileSync(ASYLUM)), { name: 'asylum16.cmd', selection: { machine: 1, dos: 'ldos' } }), readFileSync(ASYLUM_HINTS, 'utf8'));
    const code = listingRows(base.analysis).filter((r) => r.kind === 'code');
    const addr = (code[Math.floor(code.length / 2)] as { addr: number }).addr;
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      const s = edited(base, { op: 'name', addr, name: `TIMED_${i}` });
      listingRows(s.analysis);
      times.push(performance.now() - t0);
    }
    const best = Math.min(...times);
    console.log(`asylum16 edit: ${times.map((t) => t.toFixed(1)).join(', ')} ms (best ${best.toFixed(1)})`);
    expect(best).toBeLessThan(200);
  });
});
