// Back up and Restore for the page: the buttons call these. The work itself is
// in utils/backup (shared with the Manuals page); this adds the download, the
// file read, the confirmation question and the result message. utils/backup loads when a button
// is pressed, and the Source tab's sources are flushed and re-read only if they are loaded (before
// that nothing is unsaved, and they read the store fresh when they load), so neither is on the
// first screen.
import { ref } from 'vue';
import { parseHints } from '@fugloy/disasm';
import { loadedSources, STORE_BLOCKED, storeBlocked } from '../utils/store';
import { usePersistence } from './usePersistence';

const message = ref<string | null>(null);
/** The program a restore is asking about, with the promise its answer settles. */
const question = ref<{ name: string; answer: (yes: boolean) => void } | null>(null);

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;

export function useBackup() {
  const persistence = usePersistence();

  async function store() {
    const s = await persistence.start();
    if (s === null) message.value = storeBlocked() ? STORE_BLOCKED : 'Back up and Restore need browser storage, which is unavailable here.';
    return s;
  }

  async function backUp(): Promise<void> {
    const s = await store();
    if (s === null) return;
    await persistence.flush();
    await loadedSources()?.flush();
    const { makeBackup } = await import('../utils/backup');
    const json = await makeBackup(s);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `fugloy-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    const parsed = JSON.parse(json) as { programs: unknown[]; sources?: unknown[] };
    const n = parsed.sources?.length ?? 0;
    message.value = `Backed up ${plural(parsed.programs.length, 'program')}${n === 0 ? '' : ` and ${plural(n, 'source')}`}. The file holds your hints${n === 0 ? ' and settings' : ', settings and sources'} only: no manuals, ROMs or programs.`;
  }

  async function restore(file: File): Promise<void> {
    const s = await store();
    if (s === null) return;
    try {
      // An edit still waiting out its delay is stored first, so the restore compares against it.
      await persistence.flush();
      await loadedSources()?.flush();
      const { restoreBackup } = await import('../utils/backup');
      const r = await restoreBackup(s, await file.text(), (name) => new Promise((resolve) => (question.value = { name, answer: resolve })), parseHints);
      const rejected = r.rejected.map((x) => `${x.name} (${x.reason})`).join('; ');
      const src = r.sources === undefined ? '' : ` Sources: ${r.sources.added} added, ${r.sources.skipped} already here.`;
      message.value = `Restored: ${r.added} added, ${r.replaced} replaced, ${r.skipped} left as they were.${src}${rejected === '' ? '' : ` Not restored, because the hints do not parse: ${rejected}.`}`;
      await persistence.refresh();
      if (r.sources !== undefined) await loadedSources()?.refresh();
    } catch (err) {
      message.value = err instanceof Error && err.name === 'BackupError' ? err.message : `The backup could not be restored: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  function answer(yes: boolean): void {
    const q = question.value;
    question.value = null;
    q?.answer(yes);
  }

  return { message, question, backUp, restore, answer };
}
