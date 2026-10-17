// Back up and Restore: one JSON file with the user's own work (every saved hint
// file and each program's machine and DOS), to carry between machines. Never
// manuals, ROMs or programs. The logic lives here so the top bar menu and the
// Manuals page share it.
import type { Prefs, Store } from './store';

export interface BackupProgram {
  hash: string;
  name: string;
  /** The hint file's text. */
  hints: string;
  prefs?: Prefs;
}

export interface Backup {
  fugloyBackup: 1;
  exportedAt: string;
  programs: BackupProgram[];
}

export async function makeBackup(store: Store): Promise<string> {
  const programs: BackupProgram[] = [];
  for (const h of await store.allHints()) {
    const prefs = await store.getPrefs(h.hash);
    programs.push({ hash: h.hash, name: h.name, hints: h.text, ...(prefs === undefined ? {} : { prefs }) });
  }
  const backup: Backup = { fugloyBackup: 1, exportedAt: new Date().toISOString(), programs };
  return `${JSON.stringify(backup, null, 2)}\n`;
}

export class BackupError extends Error {}

const isPrefs = (v: unknown): v is Prefs => typeof v === 'object' && v !== null && 'machine' in v && 'dos' in v && typeof (v as Prefs).dos === 'string';

/** Parses and checks a backup file; throws BackupError saying what is wrong. */
export function parseBackup(json: string): Backup {
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    throw new BackupError('this is not a Fugløy backup file (it is not JSON).');
  }
  const b = v as Partial<Backup> | null;
  if (b === null || typeof b !== 'object' || b.fugloyBackup !== 1 || !Array.isArray(b.programs)) {
    throw new BackupError('this is not a Fugløy backup file (version 1).');
  }
  for (const p of b.programs) {
    if (typeof p !== 'object' || p === null || typeof p.hash !== 'string' || typeof p.name !== 'string' || typeof p.hints !== 'string' || (p.prefs !== undefined && !isPrefs(p.prefs))) {
      throw new BackupError('this backup file is damaged (a program entry is malformed).');
    }
  }
  return b as Backup;
}

/**
 * Merges a backup into the store. A program the store lacks is added; one it
 * has with different hints is replaced only if `confirm` (given the program's
 * name) says yes; one with identical hints is skipped.
 */
export async function restoreBackup(store: Store, json: string, confirm: (name: string) => Promise<boolean>): Promise<{ added: number; replaced: number; skipped: number }> {
  const backup = parseBackup(json);
  const result = { added: 0, replaced: 0, skipped: 0 };
  for (const p of backup.programs) {
    const have = await store.getHints(p.hash);
    if (have !== undefined) {
      if (have.text === p.hints) {
        // Same work; still take settings the store lacks.
        if (p.prefs !== undefined && (await store.getPrefs(p.hash)) === undefined) await store.putPrefs(p.hash, p.prefs);
        result.skipped++;
        continue;
      }
      if (!(await confirm(have.name))) {
        result.skipped++;
        continue;
      }
      result.replaced++;
    } else result.added++;
    await store.putHints(p.hash, { name: p.name, text: p.hints });
    if (p.prefs !== undefined) await store.putPrefs(p.hash, p.prefs);
  }
  return result;
}
