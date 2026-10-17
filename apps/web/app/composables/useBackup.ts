// Back up and Restore for the page: the buttons call these. The work itself is
// in utils/backup (shared with the Manuals page); this adds the download, the
// file read, the confirmation question and the result message.
import { ref } from 'vue';
import { BackupError, makeBackup, restoreBackup } from '../utils/backup';
import { usePersistence } from './usePersistence';

const message = ref<string | null>(null);
/** The program a restore is asking about, with the promise its answer settles. */
const question = ref<{ name: string; answer: (yes: boolean) => void } | null>(null);

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;

export function useBackup() {
  const persistence = usePersistence();

  async function store() {
    const s = await persistence.start();
    if (s === null) message.value = 'Back up and Restore need browser storage, which is unavailable here.';
    return s;
  }

  async function backUp(): Promise<void> {
    const s = await store();
    if (s === null) return;
    await persistence.flush();
    const json = await makeBackup(s);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `fugloy-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    message.value = `Backed up ${plural(JSON.parse(json).programs.length, 'program')}. The file holds your hints and settings only: no manuals, ROMs or programs.`;
  }

  async function restore(file: File): Promise<void> {
    const s = await store();
    if (s === null) return;
    try {
      const r = await restoreBackup(s, await file.text(), (name) => new Promise((resolve) => (question.value = { name, answer: resolve })));
      message.value = `Restored: ${r.added} added, ${r.replaced} replaced, ${r.skipped} left as they were.`;
      await persistence.refresh();
    } catch (err) {
      message.value = err instanceof BackupError ? err.message : `The backup could not be restored: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  function answer(yes: boolean): void {
    const q = question.value;
    question.value = null;
    q?.answer(yes);
  }

  return { message, question, backUp, restore, answer };
}
