import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BackupError, makeBackup, restoreBackup } from '../app/utils/backup';
import { openStore } from '../app/utils/store';
import type { Store } from '../app/utils/store';

const open: Store[] = [];
const wipe = (): Promise<unknown> => new Promise((r) => (indexedDB.deleteDatabase('fugloy').onsuccess = r));
/** A new empty database (any earlier one is closed and deleted first). */
const fresh = async (): Promise<Store> => {
  for (const s of open.splice(0)) s.db.close();
  await wipe();
  const s = (await openStore())!;
  open.push(s);
  return s;
};
let a: Store;
beforeEach(async () => {
  a = await fresh();
});
afterEach(async () => {
  for (const s of open.splice(0)) s.db.close();
  await wipe();
});

const HINTS = 'fugloy-hints 1\nblock 0 length $0010 hash 0123456789abcdef\nblock 0:$0000 name START\n';

describe('backup', () => {
  it('round-trips into an empty store with identical hints and prefs, and never carries manuals', async () => {
    await a.putHints('h1', { name: 'one.hints', text: HINTS });
    await a.putPrefs('h1', { machine: 1, dos: 'ldos' });
    await a.putHints('h2', { name: 'two.hints', text: 'fugloy-hints 1\n' });
    // A manual in the store never reaches the file.
    const tx = a.db.transaction('manuals', 'readwrite');
    tx.objectStore('manuals').put(new Uint8Array([1, 2, 3]), 'm');
    await new Promise((r) => (tx.oncomplete = r));
    const json = await makeBackup(a);
    expect(JSON.parse(json).fugloyBackup).toBe(1);
    expect(json).not.toContain('manual');
    const before = await a.allHints();
    const b = await fresh();
    const r = await restoreBackup(b, json, async () => true);
    expect(r).toEqual({ added: 2, replaced: 0, skipped: 0, rejected: [] });
    expect(await b.allHints()).toEqual(before);
    expect(await b.getPrefs('h1')).toEqual({ machine: 1, dos: 'ldos' });
    expect(await b.getPrefs('h2')).toBeUndefined();
  });

  it('asks before replacing a program present in both, naming it, and keeps the saved copy on no', async () => {
    await a.putHints('h1', { name: 'one.hints', text: HINTS });
    const json = await makeBackup(a);
    await a.putHints('h1', { name: 'one.hints', text: `${HINTS}block 0:$0001 comment mine\n` });
    const asked: string[] = [];
    const no = await restoreBackup(a, json, async (name) => (asked.push(name), false));
    expect(asked).toEqual(['one.hints']);
    expect(no).toEqual({ added: 0, replaced: 0, skipped: 1, rejected: [] });
    expect((await a.getHints('h1'))!.text).toContain('comment mine');
    const yes = await restoreBackup(a, json, async () => true);
    expect(yes).toEqual({ added: 0, replaced: 1, skipped: 0, rejected: [] });
    expect((await a.getHints('h1'))!.text).toBe(HINTS);
  });

  it('carries settings for a program that has no hints, and round-trips them', async () => {
    await a.putPrefs('p9', { machine: 1, dos: 'ldos' });
    await a.putHints('h1', { name: 'one.hints', text: HINTS });
    const json = await makeBackup(a);
    const programs = JSON.parse(json).programs;
    expect(programs.map((p: { hash: string }) => p.hash).sort()).toEqual(['h1', 'p9']);
    expect(programs.find((p: { hash: string }) => p.hash === 'p9').hints).toBeUndefined();
    const b = await fresh();
    expect(await restoreBackup(b, json, async () => true)).toEqual({ added: 2, replaced: 0, skipped: 0, rejected: [] });
    expect(await b.getPrefs('p9')).toEqual({ machine: 1, dos: 'ldos' });
    expect(await b.getHints('p9')).toBeUndefined();
  });

  it('does not ask about identical work', async () => {
    await a.putHints('h1', { name: 'one.hints', text: HINTS });
    const json = await makeBackup(a);
    const r = await restoreBackup(a, json, async () => { throw new Error('should not ask'); });
    expect(r.skipped).toBe(1);
  });

  it('rejects files that are not backups', async () => {
    await expect(restoreBackup(a, 'nope', async () => true)).rejects.toBeInstanceOf(BackupError);
    await expect(restoreBackup(a, '{"fugloyBackup":2,"programs":[]}', async () => true)).rejects.toBeInstanceOf(BackupError);
    await expect(restoreBackup(a, '{"fugloyBackup":1,"programs":[{"hash":1}]}', async () => true)).rejects.toBeInstanceOf(BackupError);
  });

  it('reports hint text that does not parse, does not store it, and restores the rest', async () => {
    const json = JSON.stringify({
      fugloyBackup: 1,
      exportedAt: '',
      programs: [
        { hash: 'bad', name: 'junk.hints', hints: 'fugloy-hints 1\nthis line is junk\n', prefs: { machine: 1, dos: 'ldos' } },
        { hash: 'h1', name: 'one.hints', hints: HINTS },
      ],
    });
    const r = await restoreBackup(a, json, async () => true);
    expect(r.added).toBe(1);
    expect(r.rejected).toEqual([{ name: 'junk.hints', reason: 'line 2: unexpected line' }]);
    expect(await a.getHints('bad')).toBeUndefined();
    expect(await a.getPrefs('bad')).toBeUndefined();
    expect((await a.getHints('h1'))!.text).toBe(HINTS);
  });
});
