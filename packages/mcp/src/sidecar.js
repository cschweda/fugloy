/**
 * The sidecar label file (Ruling 6, docs/fugloy-mcp-spec.md §8): `<program>.fugloy.json` beside
 * the program, in the emu spec §8 format. When there is none beside the program, one in the
 * config's fixtures folder is read instead, but writes still go beside the program.
 *
 * - `load` reads it: its labels become the session's, and the file as read is kept as the base
 *   that `coverage export` merges into. A file that is not JSON, breaks a rule of §8, was
 *   written for another program (its `sha256` differs), or is a symbolic link is ignored,
 *   reported, and never overwritten.
 * - `label` and `unlabel` rewrite it at once: the file as it now stands (or a skeleton naming
 *   the program and its blocks) with the session's labels in place of its own. Coverage, callers,
 *   and sessions are left alone, so nothing is counted twice when `coverage export` runs later.
 * - `coverage export` merges the session (`m.debug.labelFile`, coverage and callers since load,
 *   one session record) into the base read at load, by the §8 rule. Exporting again replaces
 *   this session's contribution rather than adding it twice.
 * - Every write first checks the file on disk is still what the server last read or wrote there
 *   (absent, if it has neither), so edits made by hand after load are never overwritten, and
 *   never writes through a symbolic link.
 *
 * These are the only files the server writes (MCP spec §7).
 */
import { lstatSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { mergeLabelFiles, parseLabelFile } from '@fugloy/emu';

/**
 * @typedef {any} LabelFile the §8 object, as `parseLabelFile` checks it
 * @typedef {import('./session.js').Label} Label
 * @typedef {{ path: string, readFrom: string | null, base: LabelFile | null, file: LabelFile | null, ignored: string | null, text: string | null }} SidecarState
 *   `path` is where writes go (beside the program); `readFrom` the file load read, if any;
 *   `text` what the server expects at `path` now (null: no file there)
 */

/** `/games/RAIDERS.CMD` → `/games/RAIDERS.fugloy.json`. */
export const sidecarPath = (/** @type {string} */ programPath) => join(dirname(programPath), `${basename(programPath, extname(programPath))}.fugloy.json`);

/** Map 0, page 0: the only space a Model III has. */
const home = (/** @type {{ map?: number, page?: number }} */ l) => (l.map ?? 0) === 0 && (l.page ?? 0) === 0;

/** The lstat of `path`, or null when nothing (not even a dangling link) is there. */
function lstatOf(/** @type {string} */ path) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

/**
 * Whether two paths name the same existing file, by device and inode (so a case variant on a
 * case-insensitive volume, or a path through a linked folder, is caught).
 * @param {string} a
 * @param {string | null | undefined} b
 */
export function sameFile(a, b) {
  if (b === null || b === undefined) return false;
  if (a === b) return true;
  try {
    const x = statSync(a);
    const y = statSync(b);
    return x.dev === y.dev && x.ino === y.ino;
  } catch {
    return false;
  }
}

/** `RaIdErS` → `rAiDeRs`. */
const swapCase = (/** @type {string} */ s) => [...s].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join('');

/** Whether the folder `dir` is on a volume that ignores case: some entry of it is found again by its case-swapped name. */
function foldsCase(/** @type {string} */ dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return false;
  }
  const entry = entries.find((e) => swapCase(e) !== e);
  return entry !== undefined && sameFile(join(dir, entry), join(dir, swapCase(entry)));
}

/**
 * Whether two paths name the same file, existing or not: `sameFile`, or else the same folder (by
 * identity) and names that differ only in case on a volume that ignores case. So a case variant
 * of the sidecar's path is the sidecar before the sidecar exists.
 * @param {string} a
 * @param {string | null | undefined} b
 */
export function samePath(a, b) {
  if (b === null || b === undefined) return false;
  if (sameFile(a, b)) return true;
  if (basename(a).toLowerCase() !== basename(b).toLowerCase() || !sameFile(dirname(a), dirname(b))) return false;
  return basename(a) === basename(b) || foldsCase(dirname(a));
}

/**
 * Why the existing file at `path` is not a label file (a clause), or null when it is one, so
 * `coverage export` may replace it without `overwrite`.
 * @param {string} path
 */
export function notLabelFile(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    return `it could not be read (${err instanceof Error ? err.message : String(err)})`;
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return 'it is not JSON';
  }
  const { file, errors } = parseLabelFile(json);
  return file === null ? `it is not a label file (${errors[0] ?? 'it breaks the format'})` : null;
}

/** Refuse a path that is a symbolic link (dangling or not): the server never writes through one. */
export function refuseLink(/** @type {string} */ path) {
  if (lstatOf(path)?.isSymbolicLink()) throw new Error(`${path} is a symbolic link; the server does not write through links (replace it with a file, or remove it).`);
}

/**
 * Check a sidecar's text against §8 and the program.
 * @param {string} text
 * @param {string} programSha256
 * @returns {{ file: LabelFile } | { ignored: string }}
 */
function checkText(text, programSha256) {
  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return { ignored: `it is not JSON (${err instanceof Error ? err.message : String(err)})` };
  }
  const { file, errors } = parseLabelFile(json);
  if (file === null) {
    const more = errors.length > 3 ? `; and ${errors.length - 3} more` : '';
    return { ignored: `it is not a valid label file (${errors.slice(0, 3).join('; ')}${more})` };
  }
  const sha = file.program.sha256;
  if (sha !== undefined && sha !== programSha256) {
    return { ignored: `it was written for another program (its sha256 is ${sha.slice(0, 12)}…, this program's is ${programSha256.slice(0, 12)}…)` };
  }
  return { file };
}

/**
 * Read the sidecar of the program at `programPath`, whose SHA-256 is `programSha256`.
 * @param {string} programPath
 * @param {string} programSha256
 * @param {{ fixtures?: string }} [where] a fixtures folder to look in when there is none beside the program
 * @returns {null | { path: string, file: LabelFile, labels: Label[], text: string } | { path: string, ignored: string }}
 *   null when there is no sidecar; `path` is the file read; `labels` are its labels for map 0, page 0
 */
export function readSidecar(programPath, programSha256, { fixtures } = {}) {
  const beside = sidecarPath(programPath);
  const candidates = [beside, ...(fixtures === undefined ? [] : [join(fixtures, basename(beside))])];
  const path = candidates.find((p) => lstatOf(p) !== null);
  if (path === undefined) return null;
  if (lstatOf(path)?.isSymbolicLink()) return { path, ignored: 'it is a symbolic link (the server neither reads nor writes through links; replace it with a file)' };
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    return { path, ignored: `it could not be read (${err instanceof Error ? err.message : String(err)})` };
  }
  const checked = checkText(text, programSha256);
  if ('ignored' in checked) return { path, ignored: checked.ignored };
  return { path, file: checked.file, labels: checked.file.labels.filter(home).map((/** @type {Label} */ l) => ({ ...l })), text };
}

/**
 * The session's sidecar state after `load` found `found` (readSidecar's result) for the program at `programPath`.
 * @param {string} programPath
 * @param {ReturnType<typeof readSidecar>} found
 * @returns {SidecarState}
 */
export function sidecarState(programPath, found) {
  const path = sidecarPath(programPath);
  if (found === null) return { path, readFrom: null, base: null, file: null, ignored: null, text: null };
  if ('ignored' in found) return { path, readFrom: found.path, base: null, file: null, ignored: found.ignored, text: null };
  // A file read from the fixtures folder is the base; nothing is beside the program yet.
  const here = found.path === path;
  return { path, readFrom: found.path, base: found.file, file: here ? found.file : null, ignored: null, text: here ? found.text : null };
}

/** The `Sidecar:` line of `load`'s manifest. */
export function sidecarLine(/** @type {SidecarState} */ s) {
  if (s.ignored !== null) return `Sidecar: ${s.readFrom} ignored: ${s.ignored}; label and coverage export leave it as it is`;
  if (s.base === null) return `Sidecar: none yet; label writes ${s.path}`;
  const n = s.base.labels.length;
  const k = s.base.sessions.length;
  const where = s.readFrom === s.path ? '' : `; writes go to ${s.path}, beside the program`;
  return `Sidecar: ${s.readFrom}: ${n} ${n === 1 ? 'label' : 'labels'}, ${k === 0 ? 'no recorded sessions' : `${k} recorded ${k === 1 ? 'session' : 'sessions'}`}${where}`;
}

/** Why the sidecar cannot be written, as a clause, or null. */
export function sidecarRefusal(/** @type {SidecarState} */ s) {
  return s.ignored === null ? null : `the sidecar ${s.readFrom} was ignored at load (${s.ignored})`;
}

/** A label as §8 writes it, whatever shape the session holds it in. */
function asFileLabel(/** @type {Label} */ l) {
  /** @type {any} */
  const out = { addr: l.addr, name: l.name, kind: l.kind ?? 'code' };
  if (l.size !== undefined) out.size = l.size;
  out.source = l.source ?? 'user';
  if (l.evidence !== undefined) out.evidence = l.evidence;
  if (l.note !== undefined) out.note = l.note;
  for (const k of ['map', 'page']) if (/** @type {any} */ (l)[k] !== undefined) out[k] = /** @type {any} */ (l)[k];
  return out;
}

/** The session's labels for the file: its own, plus the base's labels for other maps and pages, sorted. */
function fileLabels(/** @type {import('./session.js').Session} */ session) {
  const other = session.sidecar?.base?.labels.filter((l) => !home(l)) ?? [];
  return [...session.labels.values(), ...other]
    .map(asFileLabel)
    .sort((x, y) => x.addr - y.addr || (x.map ?? 0) - (y.map ?? 0) || (x.page ?? 0) - (y.page ?? 0));
}

/** The session as §8 says it: coverage and callers since load, the loaded blocks, one session record. */
const current = (/** @type {import('./session.js').Session} */ session) =>
  session.requireMachine().debug.labelFile({ name: /** @type {any} */ (session.program).name });

/** A file naming the program and its blocks, with no labels, coverage, callers, or sessions. */
function skeleton(/** @type {import('./session.js').Session} */ session) {
  return { ...current(session), labels: [], coverage: {}, callers: {}, sessions: [] };
}

/** Write `file` as JSON, two-space indented, ending in a newline, never through a link. Throws a sentence. Returns the text written. */
export function writeLabelJson(/** @type {string} */ path, /** @type {object} */ file) {
  refuseLink(path);
  const text = `${JSON.stringify(file, null, 2)}\n`;
  try {
    writeFileSync(path, text);
  } catch (err) {
    throw new Error(`${path} could not be written: ${err instanceof Error ? err.message.replace(/\.$/, '') : String(err)}.`);
  }
  return text;
}

/**
 * Write `file` to the sidecar, after checking the file on disk is still what the server last
 * read or wrote there. Throws a sentence otherwise.
 * @param {import('./session.js').Session} session
 * @param {LabelFile} file
 */
export function writeSidecarFile(session, file) {
  const s = /** @type {SidecarState} */ (session.sidecar);
  const refusal = sidecarRefusal(s);
  if (refusal !== null) throw new Error(`${refusal}, so it was not overwritten`);
  refuseLink(s.path);
  let now = null;
  if (lstatOf(s.path) !== null) {
    try {
      now = readFileSync(s.path, 'utf8');
    } catch (err) {
      throw new Error(`the sidecar ${s.path} could not be read before writing (${err instanceof Error ? err.message : String(err)}), so it was not overwritten`);
    }
  }
  if (now !== s.text) {
    const checked = now === null ? null : checkText(now, /** @type {any} */ (session.program).sha256);
    const state = now === null ? 'was removed' : checked !== null && 'ignored' in checked ? `changed, and ${checked.ignored}` : 'changed';
    throw new Error(`the sidecar ${s.path} ${s.text === null && now !== null ? 'appeared' : state} on disk since the server last read or wrote it, so it was not overwritten; load the program again to pick up the edits`);
  }
  s.text = writeLabelJson(s.path, file);
  s.file = file;
}

/**
 * Rewrite the sidecar with the session's labels (`label`, `unlabel`). Throws a sentence when the
 * sidecar was ignored at load, changed on disk, or cannot be written.
 * @param {import('./session.js').Session} session
 * @returns {string} the path written
 */
export function writeSidecar(session) {
  const s = /** @type {SidecarState} */ (session.sidecar);
  writeSidecarFile(session, { ...(s.file ?? s.base ?? skeleton(session)), labels: fileLabels(session) });
  return s.path;
}

/**
 * The full §8 file for `coverage export`: the session merged into the base read at load, labels
 * as the session holds them.
 * @param {import('./session.js').Session} session
 * @returns {LabelFile}
 */
export function exportFile(session) {
  const s = /** @type {SidecarState} */ (session.sidecar);
  const base = { ...(s.base ?? skeleton(session)), labels: fileLabels(session) };
  return mergeLabelFiles(base, current(session));
}

/**
 * After an export to the sidecar (written with `writeSidecarFile`): the labels it gained (the
 * observed call targets) are the session's too, so a later `label` keeps them.
 * @param {import('./session.js').Session} session
 * @param {LabelFile} file
 */
export function adoptExport(session, file) {
  session.labels = new Map(file.labels.filter(home).map((l) => [l.addr, { ...l }]));
}
