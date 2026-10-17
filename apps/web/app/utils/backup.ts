// Back up and Restore: one JSON file with the user's own work (every saved hint
// file and each program's machine and DOS), to carry between machines. Never
// manuals, ROMs or programs. The logic lives here so the top bar menu and the
// Manuals page share it.
import { parseHints } from '@fugloy/disasm';
import type { Prefs, Store } from './store';

export interface BackupProgram {
  hash: string;
  /** The hint file's name; for a program with settings only, the start of its hash. */
  name: string;
  /** The hint file's text; absent for a program with settings but no hints. */
  hints?: string;
  prefs?: Prefs;
}

export interface Backup {
  fugloyBackup: 1;
  exportedAt: string;
  programs: BackupProgram[];
}

export async function makeBackup(store: Store): Promise<string> {
  const programs: BackupProgram[] = [];
  const prefs = new Map((await store.allPrefs()).map((p) => [p.hash, p.prefs]));
  for (const h of await store.allHints()) {
    const p = prefs.get(h.hash);
    prefs.delete(h.hash);
    programs.push({ hash: h.hash, name: h.name, hints: h.text, ...(p === undefined ? {} : { prefs: p }) });
  }
  // Settings for programs with no saved hints go too.
  for (const [hash, p] of prefs) programs.push({ hash, name: hash.slice(0, 12), prefs: p });
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
    if (typeof p !== 'object' || p === null || typeof p.hash !== 'string' || typeof p.name !== 'string' || (p.hints !== undefined && typeof p.hints !== 'string') || (p.prefs !== undefined && !isPrefs(p.prefs))) {
      throw new BackupError('this backup file is damaged (a program entry is malformed).');
    }
  }
  return b as Backup;
}

export interface RestoreResult {
  added: number;
  replaced: number;
  skipped: number;
  /** Programs whose hint text does not parse: not restored (hints or settings), with the first reason. */
  rejected: { name: string; reason: string }[];
}

/**
 * Merges a backup into the store. Work the store lacks is added; work it has that differs
 * is replaced only if `confirm` (given the program's name) says yes; identical work is skipped.
 * A program counts once: rejected, else declined, else replaced, else added, else skipped.
 * Hint text that does not parse is never stored: it is listed in `rejected` and the rest restores.
 */
export async function restoreBackup(store: Store, json: string, confirm: (name: string) => Promise<boolean>): Promise<RestoreResult> {
  const backup = parseBackup(json);
  const result: RestoreResult = { added: 0, replaced: 0, skipped: 0, rejected: [] };
  for (const p of backup.programs) {
    if (p.hints !== undefined) {
      const bad = parseHints(p.hints).errors[0];
      if (bad !== undefined) {
        result.rejected.push({ name: p.name, reason: `line ${bad.line}: ${bad.message}` });
        continue;
      }
    }
    const haveHints = await store.getHints(p.hash);
    const havePrefs = await store.getPrefs(p.hash);
    const name = haveHints?.name ?? p.name;
    let added = false;
    let replaced = false;
    let declined = false;
    if (p.hints !== undefined) {
      if (haveHints === undefined) {
        await store.putHints(p.hash, { name: p.name, text: p.hints });
        added = true;
      } else if (haveHints.text !== p.hints) {
        if (await confirm(name)) {
          await store.putHints(p.hash, { name: p.name, text: p.hints });
          replaced = true;
        } else declined = true;
      }
    }
    if (p.prefs !== undefined && !declined) {
      if (havePrefs === undefined) {
        await store.putPrefs(p.hash, p.prefs);
        added = true;
      } else if (havePrefs.machine !== p.prefs.machine || havePrefs.dos !== p.prefs.dos) {
        // Settings that come with confirmed hints need no second question.
        if (replaced || (await confirm(name))) {
          await store.putPrefs(p.hash, p.prefs);
          replaced = true;
        } else declined = true;
      }
    }
    if (declined) result.skipped++;
    else if (replaced) result.replaced++;
    else if (added) result.added++;
    else result.skipped++;
  }
  return result;
}
