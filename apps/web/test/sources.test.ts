import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createSources, SOURCE_SAVE_DELAY_MS } from '../app/composables/useSources';
import { openStore } from '../app/utils/store';
import type { Store } from '../app/utils/store';

const STARTER = readFileSync(fileURLToPath(new URL('../../../packages/asm/examples/clear-screen.z', import.meta.url)), 'utf8');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const opened: Store[] = [];
const open = async (): Promise<Store | null> => {
  const s = await openStore();
  if (s !== null) opened.push(s);
  return s;
};
afterEach(async () => {
  for (const s of opened.splice(0)) s.db.close();
  await new Promise((r) => (indexedDB.deleteDatabase('fugloy').onsuccess = r));
});

describe('useSources', () => {
  it('a new source is the starter, on the Model III, and becomes the current one', async () => {
    const s = createSources({ open });
    const src = await s.create();
    expect(src.text).toBe(STARTER);
    expect(src.model).toBe(3);
    expect(src.name).toBe('clear-screen.z');
    expect(s.current.value?.id).toBe(src.id);
    expect(s.list.value.map((x) => x.id)).toEqual([src.id]);
    // Kept: a second visit finds it, still current.
    const again = createSources({ open });
    await again.start();
    expect(again.current.value).toEqual(src);
  });

  it('takes a name, a text and a model, and suffixes a name already taken', async () => {
    const s = createSources({ open });
    const a = await s.create({ name: 'mine.z', text: ' NOP\n', model: 1 });
    expect(a).toMatchObject({ name: 'mine.z', text: ' NOP\n', model: 1 });
    const b = await s.create({ name: 'mine.z', text: ' HALT\n' });
    expect(b.name).toBe('mine-2.z');
    expect(b.model).toBe(3);
  });

  it('autosaves an edit 500 ms after the last one', async () => {
    const s = createSources({ open });
    const src = await s.create();
    s.update(src.id, { text: 'one' });
    await sleep(SOURCE_SAVE_DELAY_MS / 2);
    s.update(src.id, { text: 'two' });
    expect(s.current.value?.text).toBe('two');
    await sleep(SOURCE_SAVE_DELAY_MS / 2 + 100);
    // The second edit restarted the wait: nothing written yet.
    expect((await opened[0]!.allSources())[0]!.text).toBe(STARTER);
    await sleep(SOURCE_SAVE_DELAY_MS);
    expect((await opened[0]!.allSources())[0]!.text).toBe('two');
  });

  it('flush writes a waiting edit at once', async () => {
    const s = createSources({ open });
    const src = await s.create();
    s.update(src.id, { text: 'now', model: 4 });
    await s.flush();
    expect(await opened[0]!.allSources()).toEqual([expect.objectContaining({ id: src.id, text: 'now', model: 4 })]);
  });

  it('selects, renames and removes, and refuses an empty or taken name with a sentence', async () => {
    const s = createSources({ open });
    const a = await s.create({ name: 'a.z' });
    const b = await s.create({ name: 'b.z' });
    expect(s.current.value?.id).toBe(b.id);
    await s.select(a.id);
    expect(s.current.value?.id).toBe(a.id);
    expect(await s.rename(a.id, 'first.z')).toBeNull();
    expect(s.current.value?.name).toBe('first.z');
    expect(await s.rename(a.id, '  ')).toMatch(/^A source needs a name/);
    expect(await s.rename(a.id, 'b.z')).toMatch(/b\.z is already the name of another source/);
    await s.remove(a.id);
    expect(s.list.value.map((x) => x.name)).toEqual(['b.z']);
    expect(s.current.value?.id).toBe(b.id);
    const again = createSources({ open });
    await again.start();
    expect(again.list.value.map((x) => x.name)).toEqual(['b.z']);
    expect(again.current.value?.id).toBe(b.id);
  });

  it('works without storage, and says why nothing is kept', async () => {
    const s = createSources({ open: async () => null });
    const src = await s.create({ text: 'x' });
    s.update(src.id, { text: 'y' });
    await s.flush();
    expect(s.current.value?.text).toBe('y');
    expect(s.unavailable.value).toMatch(/Browser storage is unavailable here.*source/);
  });
});
