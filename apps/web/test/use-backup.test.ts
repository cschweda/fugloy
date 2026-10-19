import { describe, expect, it, vi } from 'vitest';
import type { Store } from '../app/utils/store';

const order: string[] = [];
const store = {
  getHints: async () => (order.push('read the store'), undefined),
  getPrefs: async () => undefined,
  putHints: async () => void order.push('write the store'),
  putPrefs: async () => undefined,
  allSources: async () => [],
  putSource: async () => void order.push('write a source'),
} as unknown as Store;
vi.mock('../app/composables/usePersistence', () => ({
  usePersistence: () => ({
    start: async () => store,
    flush: async () => void order.push('flush'),
    refresh: async () => void order.push('refresh'),
  }),
}));
// The sources are loaded (the Source tab was opened); the last test unloads them.
let loaded: { flush(): Promise<void>; refresh(): Promise<void> } | null = {
  flush: async () => void order.push('flush sources'),
  refresh: async () => void order.push('refresh sources'),
};
vi.mock('../app/utils/store', async (orig) => ({ ...(await orig<typeof import('../app/utils/store')>()), loadedSources: () => loaded }));
const { useBackup } = await import('../app/composables/useBackup');

describe('useBackup restore', () => {
  it('writes edits still waiting out their delay before it compares the backup with the store', async () => {
    const json = JSON.stringify({ fugloyBackup: 1, exportedAt: '', programs: [{ hash: 'h', name: 'a.hints', hints: 'fugloy-hints 1\n' }] });
    const b = useBackup();
    await b.restore({ text: async () => json } as File);
    expect(order).toEqual(['flush', 'flush sources', 'read the store', 'write the store', 'refresh']);
    expect(b.message.value).toBe('Restored: 1 added, 0 replaced, 0 left as they were.');
  });

  it('says which programs were not restored because their hints do not parse', async () => {
    const json = JSON.stringify({ fugloyBackup: 1, exportedAt: '', programs: [{ hash: 'h', name: 'junk.hints', hints: 'not hints\n' }] });
    const b = useBackup();
    await b.restore({ text: async () => json } as File);
    expect(b.message.value).toMatch(/^Restored: 0 added, 0 replaced, 0 left as they were\. Not restored, because the hints do not parse: junk\.hints \(line 1: .+\)\.$/);
  });

  it('restores sources, says how many, and re-reads them', async () => {
    order.length = 0;
    const json = JSON.stringify({ fugloyBackup: 1, exportedAt: '', programs: [], sources: [{ id: 's1', name: 'a.z', text: ' NOP\n', model: 3, savedAt: 1 }] });
    const b = useBackup();
    await b.restore({ text: async () => json } as File);
    expect(order).toEqual(['flush', 'flush sources', 'write a source', 'refresh', 'refresh sources']);
    expect(b.message.value).toBe('Restored: 0 added, 0 replaced, 0 left as they were. Sources: 1 added, 0 already here.');
  });

  it('with the sources never loaded, restores them to the store without loading them', async () => {
    order.length = 0;
    loaded = null;
    const json = JSON.stringify({ fugloyBackup: 1, exportedAt: '', programs: [], sources: [{ id: 's2', name: 'b.z', text: ' NOP\n', model: 3, savedAt: 1 }] });
    const b = useBackup();
    await b.restore({ text: async () => json } as File);
    expect(order).toEqual(['flush', 'write a source', 'refresh']);
    expect(b.message.value).toBe('Restored: 0 added, 0 replaced, 0 left as they were. Sources: 1 added, 0 already here.');
  });

  it('says a damaged backup is damaged, though utils/backup loads only on the press', async () => {
    const b = useBackup();
    await b.restore({ text: async () => JSON.stringify({ fugloyBackup: 1, exportedAt: '', programs: [], sources: [{ id: 1 }] }) } as File);
    expect(b.message.value).toMatch(/source entry is malformed/);
    expect(b.message.value).not.toMatch(/could not be restored/);
  });
});
