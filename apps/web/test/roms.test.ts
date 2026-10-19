import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { ROM_HASHES } from '@fugloy/emu';
// emu's model table, which index.js does not export (plain JavaScript, so untyped here).
// @ts-expect-error no declarations for this file
import { MODELS } from '../../../packages/emu/src/machine/models.js';
import { createRoms } from '../app/composables/useRoms';
import { ROM_SIZES } from '../app/utils/emulator/rom-ids';
import { openStore, STORE_BLOCKED } from '../app/utils/store';
import type { Store } from '../app/utils/store';

const hashOf = (name: string): string => Object.entries(ROM_HASHES).find(([, n]) => n === name)![0];
const M3 = hashOf('model3-rev-c-2ef8');
// Synthetic files only: no ROM bytes. A file's "hash" is its first line, so a test names it.
const file = (name: string, hash: string, size: number): File => {
  const bytes = new Uint8Array(size);
  bytes.set(new TextEncoder().encode(`${hash}\n`));
  return new File([bytes], name);
};
const hash = async (bytes: Uint8Array): Promise<string> => new TextDecoder().decode(bytes).split('\n')[0]!;

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

describe('useRoms', () => {
  it('knows the sizes each model takes, as emu does', () => {
    for (const m of [1, 3, 4] as const) expect(ROM_SIZES[m]).toEqual([...(MODELS as Record<number, { romSizes: number[] }>)[m]!.romSizes]);
  });

  it('a Model III ROM recognised by its hash goes to model 3, whatever its file name', async () => {
    const r = createRoms({ open, hash });
    expect(await r.add(file('model1.rom', M3, 0x3800))).toEqual({ ok: true, model: 3 });
    expect(r.have(3)).toBe(true);
    expect(r.have(1)).toBe(false);
    expect(r.info(3)).toEqual({ name: 'model1.rom', sha256: M3, recognized: 'model3-rev-c-2ef8' });
    expect((await r.bytes(3))?.length).toBe(0x3800);
    // Kept for the next visit.
    const again = createRoms({ open, hash });
    await again.start();
    expect(again.info(3)?.recognized).toBe('model3-rev-c-2ef8');
    await again.remove(3);
    expect(again.have(3)).toBe(false);
    expect(await again.bytes(3)).toBeNull();
  });

  it('refuses a recognised ROM picked for another model, naming its model', async () => {
    const r = createRoms({ open, hash });
    const res = await r.add(file('x.rom', M3, 0x3800), 1);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toMatch(/x\.rom is the Model III ROM, not a Model I ROM\. Add it for the Model III/);
    expect(r.have(1)).toBe(false);
    expect(r.have(3)).toBe(false);
  });

  it('refuses an unrecognised file of the wrong size, giving the sizes', async () => {
    const r = createRoms({ open, hash });
    const any = await r.add(file('odd.bin', 'unknown', 1000));
    expect(!any.ok && any.reason).toMatch(/odd\.bin is 1,000 bytes.*12,288 bytes.*14,336 or 16,384 bytes/);
    const m1 = await r.add(file('odd.bin', 'unknown', 0x3800), 1);
    expect(!m1.ok && m1.reason).toMatch(/odd\.bin is 14,336 bytes, but a Model I ROM is 12,288 bytes/);
  });

  it('an unrecognised file of the right size needs a model, then is kept as not recognised', async () => {
    const r = createRoms({ open, hash });
    const ask = await r.add(file('mine.rom', 'unknown', 0x4000));
    expect(!ask.ok && ask.reason).toMatch(/Fugløy does not recognise mine\.rom.*Which model/);
    expect(await r.add(file('mine.rom', 'unknown', 0x4000), 4)).toEqual({ ok: true, model: 4 });
    expect(r.info(4)).toEqual({ name: 'mine.rom', sha256: 'unknown', recognized: null });
  });

  it('says why a ROM cannot be kept without storage', async () => {
    const r = createRoms({ open: async () => null, hash });
    const res = await r.add(file('a.rom', M3, 0x3800));
    expect(!res.ok && res.reason).toMatch(/Browser storage is unavailable here/);
    expect(r.unavailable.value).toMatch(/Browser storage is unavailable here/);
  });

  it('refuses a file of no ROM size before reading it', async () => {
    const r = createRoms({ open, hash });
    const huge = { name: 'movie.mp4', size: 3_000_000_000, arrayBuffer: () => { throw new Error('read'); } } as unknown as File;
    const res = await r.add(huge, 3);
    expect(!res.ok && res.reason).toMatch(/movie\.mp4 is 3,000,000,000 bytes, which no TRS-80 ROM is.*14,336 or 16,384 bytes/);
  });

  it('says to close the other tabs when an older tab blocks the database', async () => {
    const r = createRoms({ open: async () => 'blocked', hash });
    const res = await r.add(file('a.rom', M3, 0x3800));
    expect(!res.ok && res.reason).toBe(STORE_BLOCKED);
    expect(r.unavailable.value).toBe(STORE_BLOCKED);
  });
});
