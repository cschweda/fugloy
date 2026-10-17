import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditing } from '../app/composables/useEditing';
import { createPersistence } from '../app/composables/usePersistence';
import { createWorkbench } from '../app/composables/useWorkbench';
import { openStore } from '../app/utils/store';
import type { Store } from '../app/utils/store';

const readExample = async (path: string): Promise<Uint8Array | null> => {
  try {
    return new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../examples/${path}`, import.meta.url))));
  } catch {
    return null;
  }
};
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => boolean | Promise<boolean>): Promise<void> => {
  for (let i = 0; i < 100; i++) {
    if (await f()) return;
    await sleep(20);
  }
  throw new Error('timed out');
};

let opened: Store | null = null;
const rig = async (open = openStore) => {
  const wb = createWorkbench({ readExample });
  const p = createPersistence(wb, async () => (opened = await open()));
  await p.start();
  return { wb, p, ed: createEditing(wb) };
};
afterEach(async () => {
  opened?.db.close();
  opened = null;
  await new Promise((r) => (indexedDB.deleteDatabase('fugloy').onsuccess = r));
});

describe('usePersistence', () => {
  it('saves an edit after the delay, and the saved rename beats the committed hints on the next open', async () => {
    const a = await rig();
    await a.wb.openExample('sea-dragon');
    await until(() => a.p.status.value === 'saved'); // the committed hints save once
    expect(a.ed.apply({ op: 'name', addr: 0x4b9e, name: 'INIT' })).toBeNull();
    expect(a.p.status.value).toBe('unsaved');
    await until(() => a.p.status.value === 'saved');
    // A second visit: same store, new workbench.
    const b = createWorkbench({ readExample });
    const p2 = createPersistence(b, async () => opened);
    await b.openExample('sea-dragon');
    await until(() => b.session.value!.analysis.symbols.list().some((s) => s.name === 'INIT'));
    expect(p2.status.value).toBe('saved');
  });

  it('counts undo as a change', async () => {
    const a = await rig();
    await a.wb.openExample('sea-dragon');
    await until(() => a.p.status.value === 'saved');
    a.ed.apply({ op: 'name', addr: 0x4b9e, name: 'INIT' });
    await until(() => a.p.status.value === 'saved');
    a.ed.undo();
    expect(a.p.status.value).toBe('unsaved');
    await until(() => a.p.status.value === 'saved');
    expect(opened && (await opened.allHints())[0]!.text).not.toContain('INIT');
  });

  it('says no hints yet for a program without hints, and saves nothing', async () => {
    const a = await rig();
    await a.wb.openExample('sea-dragon', 'seadrg03.cmd');
    await sleep(100);
    expect(a.p.status.value).toBe('no hints yet');
    expect(await opened!.allHints()).toEqual([]);
  });

  it('offers seadrg01 hints for seadrg02 and carries them over', async () => {
    const a = await rig();
    await a.wb.openExample('sea-dragon');
    await until(() => a.p.status.value === 'saved');
    await a.wb.openExample('sea-dragon', 'seadrg02.cmd');
    await until(() => a.p.carry.value !== null);
    expect(a.p.carry.value!.name).toBe('seadrg01.hints');
    a.p.acceptCarry();
    expect(a.wb.session.value!.applied.matched).toHaveLength(1);
    expect(a.wb.session.value!.hintFile.hints.length).toBeGreaterThan(0);
    await until(() => a.p.status.value === 'saved');
    expect((await opened!.allHints()).map((h) => h.name).sort()).toEqual(['seadrg01.hints', 'seadrg01.hints']);
  });

  it('keeps the machine the user picked, over the manifest', async () => {
    const a = await rig();
    await a.wb.openExample('sea-dragon');
    await until(() => a.p.status.value === 'saved');
    a.wb.setSelection({ machine: 1, dos: 'ldos' });
    await until(async () => (await opened!.getPrefs(a.wb.session.value!.hash)) !== undefined);
    const b = createWorkbench({ readExample });
    createPersistence(b, async () => opened);
    await b.openExample('sea-dragon');
    await until(() => b.session.value!.selection?.machine === 1);
    expect(b.session.value!.selection?.dos).toBe('ldos');
  });

  it('with no storage, still opens and edits, and says it is not saved', async () => {
    const a = await rig(async () => null);
    await a.wb.openExample('sea-dragon');
    expect(a.ed.apply({ op: 'name', addr: 0x4b9e, name: 'INIT' })).toBeNull();
    expect(a.p.status.value).toBe('not saved (storage unavailable)');
    expect(a.wb.session.value!.analysis.symbols.list().some((s) => s.name === 'INIT')).toBe(true);
  });

  it('loadHints refuses hints for another program and applies a matching file as one undoable step', async () => {
    const a = await rig();
    await a.wb.openExample('sea-dragon', 'seadrg03.cmd');
    const hints = new TextDecoder().decode((await readExample('sea-dragon/seadrg01.hints'))!);
    expect(a.ed.loadHints(hints, 'x.hints')).toBe('these hints are for another program (no block matched)');
    await a.wb.openExample('sea-dragon', 'seadrg02.cmd');
    expect(a.ed.loadHints(hints, 'x.hints')).toBeNull();
    expect(a.wb.session.value!.hintSource).toBe('x.hints');
    expect(a.wb.session.value!.hintFile.hints.length).toBeGreaterThan(0);
    a.ed.undo();
    expect(a.wb.session.value!.hintFile.hints).toHaveLength(0);
  });
});

describe('usePersistence prefs', () => {
  it('does not save settings just for opening a program', async () => {
    const a = await rig();
    await a.wb.openExample('sea-dragon');
    await until(() => a.p.status.value === 'saved');
    await a.wb.openExample('sea-dragon', 'seadrg02.cmd');
    await sleep(150);
    expect(await opened!.getPrefs(a.wb.session.value!.hash)).toBeUndefined();
    expect(await opened!.getPrefs((await opened!.allHints())[0]!.hash)).toBeUndefined();
  });
});
