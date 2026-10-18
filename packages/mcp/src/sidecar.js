/**
 * The sidecar label file (Ruling 6, docs/fugloy-mcp-spec.md §8): `<program>.fugloy.json` beside
 * the program (or, when only there, in the config's fixtures folder), in the emu spec §8 format.
 *
 * - `load` reads it: its labels become the session's, and the file as read is kept as the base
 *   that `coverage export` merges into. A file that is not JSON, breaks a rule of §8, or was
 *   written for another program (its `sha256` differs) is ignored, reported, and never
 *   overwritten.
 * - `label` and `unlabel` rewrite it at once: the file as it now stands (or a skeleton naming
 *   the program and its blocks) with the session's labels in place of its own. Coverage, callers,
 *   and sessions are left alone, so nothing is counted twice when `coverage export` runs later.
 * - `coverage export` merges the session (`m.debug.labelFile`, coverage and callers since load,
 *   one session record) into the base read at load, by the §8 rule. Exporting again replaces
 *   this session's contribution rather than adding it twice.
 *
 * These are the only files the server writes (MCP spec §7).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { mergeLabelFiles, parseLabelFile } from '@fugloy/emu';

/**
 * @typedef {any} LabelFile the §8 object, as `parseLabelFile` checks it
 * @typedef {import('./session.js').Label} Label
 * @typedef {{ path: string, base: LabelFile | null, file: LabelFile | null, ignored: string | null }} SidecarState
 */

/** `/games/RAIDERS.CMD` → `/games/RAIDERS.fugloy.json`. */
export const sidecarPath = (/** @type {string} */ programPath) => join(dirname(programPath), `${basename(programPath, extname(programPath))}.fugloy.json`);

/** Map 0, page 0: the only space a Model III has. */
const home = (/** @type {{ map?: number, page?: number }} */ l) => (l.map ?? 0) === 0 && (l.page ?? 0) === 0;

/**
 * Read the sidecar of the program at `programPath`, whose SHA-256 is `programSha256`.
 * @param {string} programPath
 * @param {string} programSha256
 * @param {{ fixtures?: string }} [where] a fixtures folder to look in when there is none beside the program
 * @returns {null | { path: string, file: LabelFile, labels: Label[] } | { path: string, ignored: string }}
 *   null when there is no sidecar; `labels` are the file's labels for map 0, page 0
 */
export function readSidecar(programPath, programSha256, { fixtures } = {}) {
  const beside = sidecarPath(programPath);
  const candidates = [beside, ...(fixtures === undefined ? [] : [join(fixtures, basename(beside))])];
  const path = candidates.find((p) => existsSync(p));
  if (path === undefined) return null;
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    return { path, ignored: `it could not be read (${err instanceof Error ? err.message : String(err)})` };
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return { path, ignored: `it is not JSON (${err instanceof Error ? err.message : String(err)})` };
  }
  const { file, errors } = parseLabelFile(json);
  if (file === null) {
    const more = errors.length > 3 ? `; and ${errors.length - 3} more` : '';
    return { path, ignored: `it is not a valid label file (${errors.slice(0, 3).join('; ')}${more})` };
  }
  const sha = file.program.sha256;
  if (sha !== undefined && sha !== programSha256) {
    return { path, ignored: `it was written for another program (its sha256 is ${sha.slice(0, 12)}…, this program's is ${programSha256.slice(0, 12)}…)` };
  }
  return { path, file, labels: file.labels.filter(home).map((l) => ({ ...l })) };
}

/** The `Sidecar:` line of `load`'s manifest. */
export function sidecarLine(/** @type {SidecarState} */ s) {
  if (s.ignored !== null) return `Sidecar: ${s.path} ignored: ${s.ignored}; label and coverage export leave it as it is`;
  if (s.base === null) return `Sidecar: none yet; label writes ${s.path}`;
  const n = s.base.labels.length;
  const k = s.base.sessions.length;
  return `Sidecar: ${s.path}: ${n} ${n === 1 ? 'label' : 'labels'}, ${k === 0 ? 'no recorded sessions' : `${k} recorded ${k === 1 ? 'session' : 'sessions'}`}`;
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

/** Write `file` as JSON, two-space indented, ending in a newline. Throws a sentence. */
export function writeLabelJson(/** @type {string} */ path, /** @type {object} */ file) {
  try {
    writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
  } catch (err) {
    throw new Error(`${path} could not be written: ${err instanceof Error ? err.message.replace(/\.$/, '') : String(err)}.`);
  }
}

/**
 * Rewrite the sidecar with the session's labels (`label`, `unlabel`). Throws a sentence when the
 * sidecar was ignored at load or cannot be written.
 * @param {import('./session.js').Session} session
 * @returns {string} the path written
 */
export function writeSidecar(session) {
  const s = /** @type {SidecarState} */ (session.sidecar);
  if (s.ignored !== null) throw new Error(`the sidecar ${s.path} was ignored at load (${s.ignored}), so it was not overwritten`);
  const file = { ...(s.file ?? skeleton(session)), labels: fileLabels(session) };
  writeLabelJson(s.path, file);
  s.file = file;
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
 * After an export to the sidecar: the file on disk is the export, and the labels it gained (the
 * observed call targets) are the session's too, so a later `label` keeps them.
 * @param {import('./session.js').Session} session
 * @param {LabelFile} file
 */
export function adoptExport(session, file) {
  const s = /** @type {SidecarState} */ (session.sidecar);
  s.file = file;
  session.labels = new Map(file.labels.filter(home).map((l) => [l.addr, { ...l }]));
}
