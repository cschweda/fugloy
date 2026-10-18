/**
 * `coverage`: what the program's bytes did since load (docs/fugloy-mcp-spec.md §5, Knowledge;
 * Ruling 3: coverage is on from the load). A loaded byte is code when it was executed as an
 * instruction or its operand, data when it was read or written and never executed, and never
 * seen otherwise. `export` writes the full §8 file, merged with the sidecar's earlier coverage
 * and with a session record appended (Ruling 6, src/sidecar.js).
 */
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { COVERAGE, decodeRle } from '@fugloy/emu';
import { z } from 'zod';
import { hex4 } from '../args.js';
import { adoptExport, exportFile, notLabelFile, refuseLink, sameFile, samePath, sidecarRefusal, writeLabelJson, writeSidecarFile } from '../sidecar.js';

const CODE = COVERAGE.EXEC | COVERAGE.OPERAND;
const DATA = COVERAGE.READ | COVERAGE.WRITE;
const KIND_TEXT = { code: 'code', data: 'data', unseen: 'never seen' };

/** `1 byte`, `47 bytes`. */
const bytes = (/** @type {number} */ n) => `${n.toLocaleString('en-US')} ${n === 1 ? 'byte' : 'bytes'}`;
const plural = (/** @type {number} */ n, /** @type {string} */ one, /** @type {string} */ many) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/**
 * The landed blocks of the program's manifest, and a mask of the addresses they cover.
 * @param {import('../session.js').Program} program
 */
function loadedBlocks(program) {
  const blocks = /** @type {any} */ (program.manifest).blocks.filter((/** @type {any} */ b) => !b.predicted).map((/** @type {any} */ b) => ({ addr: b.addr, len: b.len }));
  const mask = new Uint8Array(0x10000);
  for (const b of blocks) for (let i = 0; i < b.len; i++) mask[(b.addr + i) & 0xffff] = 1;
  return { blocks, mask };
}

/**
 * Classify every loaded byte from `isCode`/`isData`, into ranges of one kind over contiguous
 * loaded addresses, with counts inside and outside the blocks.
 * @param {Uint8Array} mask
 * @param {(a: number) => boolean} isCode
 * @param {(a: number) => boolean} isData
 */
function classify(mask, isCode, isData) {
  /** @type {{ addr: number, len: number, kind: 'code' | 'data' | 'unseen' }[]} */
  const ranges = [];
  const n = { loaded: 0, executed: 0, data: 0, unseen: 0, outside: { executed: 0, data: 0 } };
  for (let a = 0; a <= 0xffff; a++) {
    const kind = isCode(a) ? 'code' : isData(a) ? 'data' : 'unseen';
    if (!mask[a]) {
      if (kind === 'code') n.outside.executed++;
      else if (kind === 'data') n.outside.data++;
      continue;
    }
    n.loaded++;
    if (kind === 'code') n.executed++;
    else if (kind === 'data') n.data++;
    else n.unseen++;
    const last = ranges.at(-1);
    if (last !== undefined && last.kind === kind && last.addr + last.len === a) last.len++;
    else ranges.push({ addr: a, len: 1, kind });
  }
  return { ...n, ranges, codeRanges: ranges.filter((r) => r.kind === 'code').length, dataRanges: ranges.filter((r) => r.kind === 'data').length };
}

/** The line that says the coverage is mixed with an earlier program's. */
export const sharedNote = (/** @type {import('../session.js').Program} */ p) =>
  `Note: ${p.name} was loaded with reset: false after ${p.sharesCoverageWith}, so the coverage since load includes ${p.sharesCoverageWith}'s.`;

const pct = (/** @type {number} */ part, /** @type {number} */ whole) => `${((part / whole) * 100).toFixed(1)}%`;
const span = (/** @type {{ addr: number, len: number }} */ b) => `${hex4(b.addr)}–${hex4((b.addr + b.len - 1) & 0xffff)}`;

/** How many spans the `Loaded:` line names before it counts the rest. */
const SPANS = 4;

/** The loaded addresses as contiguous spans (adjacent blocks run together), for the `Loaded:` line. */
function spans(/** @type {Uint8Array} */ mask) {
  /** @type {{ addr: number, len: number }[]} */
  const out = [];
  for (let a = 0; a <= 0xffff; a++) {
    if (!mask[a]) continue;
    const last = out.at(-1);
    if (last !== undefined && last.addr + last.len === a) last.len++;
    else out.push({ addr: a, len: 1 });
  }
  const named = out.slice(0, SPANS).map(span).join(', ');
  return out.length > SPANS ? `${named}, and ${out.length - SPANS} more` : named;
}

export default {
  name: 'coverage',
  description:
    'What the loaded program\'s bytes did since load (recorded from the load; nothing needs turning on). mode "summary" (default): the share of loaded bytes executed, and how many code ranges (executed) and data ranges (read or written, never executed) there are. mode "ranges": the loaded blocks as a table of code, data, and never-seen ranges. format: "json" gives either as JSON. mode "export": write the full label and coverage file (emu spec §8) that Fugløy\'s disassembler reads, merged with the coverage of earlier sessions in the sidecar file, with this session appended, to path or, by default, the sidecar <program>.fugloy.json beside the program. An existing file at path that is not a label file is not replaced unless overwrite is true.',
  inputSchema: {
    mode: z.enum(['summary', 'ranges', 'export']).optional().describe('"summary" (default), "ranges", or "export"'),
    path: z.string().optional().describe('For mode "export": the file to write (default: the sidecar beside the program)'),
    format: z.enum(['text', 'json']).optional().describe('For "summary" and "ranges": "text" (default) or "json"'),
    overwrite: z.boolean().optional().describe('For mode "export" with path: replace a file there that is not a label file (default false; a label file is always replaced)'),
  },
  /**
   * @param {import('../session.js').Session} session
   * @param {{ mode?: 'summary' | 'ranges' | 'export', path?: string, format?: 'text' | 'json', overwrite?: boolean }} args
   */
  handler(session, { mode = 'summary', path, format = 'text', overwrite = false }) {
    const { m, program, sidecar } = session.requireProgram();
    if (path !== undefined && mode !== 'export') throw new Error('path is only for mode "export".');
    if (overwrite && mode !== 'export') throw new Error('overwrite is only for mode "export".');
    const { blocks, mask } = loadedBlocks(program);
    if (mode === 'export') return exportTo(session, path, mask, overwrite);

    const bits = m.debug.coverage.bits;
    // Why there are no blocks: a disk image's sectors land as the machine runs; ASCII BASIC is typed in.
    const why = /** @type {any} */ (program.manifest).format === 'dsk'
      ? 'a disk image is read into memory by the ROM and the disk\'s own loader as the machine runs, not loaded as blocks, so what it ran counts as outside them'
      : 'an ASCII BASIC program is typed in through the ROM, not loaded as blocks';
    const c = classify(mask, (a) => (bits[a] & CODE) !== 0, (a) => (bits[a] & DATA) !== 0);
    if (format === 'json') return JSON.stringify({ loaded: c.loaded, blocks, executed: c.executed, data: c.data, unseen: c.unseen, codeRanges: c.codeRanges, dataRanges: c.dataRanges, outside: c.outside, ranges: c.ranges }, null, 2);
    if (mode === 'ranges') {
      if (c.ranges.length === 0) return `Nothing is loaded yet (${why}).`;
      const lines = [`Ranges in the loaded blocks (${c.ranges.length}):`, 'start  end    bytes  kind'];
      for (const r of c.ranges) lines.push(`${hex4(r.addr)}  ${hex4(r.addr + r.len - 1)}  ${r.len.toLocaleString('en-US').padStart(5)}  ${KIND_TEXT[r.kind]}`);
      return lines.join('\n');
    }
    const lines = ['Coverage since load (this session):'];
    if (c.loaded === 0) lines.push(`Loaded: no blocks (${why})`);
    else {
      lines.push(
        `Loaded: ${bytes(c.loaded)} in ${plural(blocks.length, 'block', 'blocks')} (${spans(mask)})`,
        `Executed: ${bytes(c.executed)} (${pct(c.executed, c.loaded)}) in ${plural(c.codeRanges, 'code range', 'code ranges')}`,
        `Data: ${bytes(c.data)} read or written and never executed, in ${plural(c.dataRanges, 'data range', 'data ranges')}`,
        `Never seen: ${bytes(c.unseen)}`,
      );
    }
    lines.push(`Outside the loaded blocks: ${bytes(c.outside.executed)} executed, ${c.outside.data.toLocaleString('en-US')} read or written`);
    // The Model 4 keeps coverage per memory map and page (emu spec §8); `bits` is the one in force.
    const keys = m.debug.coverage.keys;
    if (keys.length > 1) {
      const mem = /** @type {{ map: number, page: number }} */ (m.mem.map);
      lines.push(`Maps: coverage is kept per memory map and page (${keys.join(', ')}); these counts are of map ${mem.map}, page ${mem.page}, the one in force, and coverage mode "export" writes each`);
    }
    if (program.sharesCoverageWith !== undefined) lines.push(sharedNote(program));
    if (sidecar.ignored !== null) lines.push(`Sidecar: ${sidecar.readFrom} was ignored at load (${sidecar.ignored})`);
    else if (sidecar.file === null && sidecar.base === null) lines.push(`Sidecar: none yet (coverage mode "export" writes ${sidecar.path})`);
    else {
      const k = (sidecar.file ?? sidecar.base).sessions.length;
      lines.push(`Sidecar: ${sidecar.path}, ${k === 0 ? 'no recorded sessions' : plural(k, 'recorded session', 'recorded sessions')} (coverage mode "export" merges this one in)`);
    }
    return lines.join('\n');
  },
};

/**
 * `coverage export`: write the merged file to `path` or the sidecar.
 * @param {import('../session.js').Session} session
 * @param {string | undefined} path
 * @param {Uint8Array} mask the loaded addresses
 * @param {boolean} overwrite replace a file at `path` that is not a label file
 */
function exportTo(session, path, mask, overwrite) {
  const { program, sidecar } = session.requireProgram();
  if (program.sharesCoverageWith !== undefined) {
    throw new Error(`The coverage on this machine includes ${program.sharesCoverageWith}, loaded before ${program.name} with reset: false, so it is not ${program.name}'s to export; load ${program.name} again with reset (the default), run it, then export.`);
  }
  if (path !== undefined && path.trim() === '') throw new Error('path is empty; give the file to export to, or leave path out to write the sidecar.');
  const given = path === undefined ? sidecar.path : resolve(process.cwd(), path);
  refuseLink(given);
  if (existsSync(given) && statSync(given).isDirectory()) throw new Error(`${given} is a folder; give a file path to export to.`);
  // By identity, not spelling: a case variant on a case-insensitive volume, or a path through a
  // linked folder, names the same file (the sidecar's even before it exists).
  if (sameFile(given, program.path)) throw new Error(`${given} is the program itself; give another path to export to.`);
  if (Object.values(session.config.roms).some((rom) => sameFile(given, rom))) throw new Error(`${given} is the ROM; give another path to export to.`);
  const toSidecar = samePath(given, sidecar.path);
  const target = toSidecar ? sidecar.path : given;
  const refusal = sidecarRefusal(sidecar);
  if (refusal !== null && (toSidecar || sameFile(target, sidecar.readFrom))) {
    throw new Error(`The ${refusal.replace(/^the /, '')}, so it is not overwritten; give path to export elsewhere, or fix or remove it and load again.`);
  }
  const replaced = !toSidecar && existsSync(target);
  if (replaced && !overwrite) {
    const why = notLabelFile(target);
    if (why !== null) throw new Error(`${target} exists and ${why}, so it is not overwritten; give another path, or pass overwrite: true to replace it.`);
  }
  const file = exportFile(session);
  if (toSidecar) {
    try {
      writeSidecarFile(session, file);
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      throw new Error(`${text[0].toUpperCase()}${text.slice(1)}.`);
    }
    adoptExport(session, file);
  } else writeLabelJson(target, file);

  const earlier = file.sessions.length - 1;
  const cov = file.coverage['0:0'];
  const exec = decodeRle(cov.exec);
  const operand = decodeRle(cov.operand);
  let loaded = 0;
  let executed = 0;
  for (let a = 0; a <= 0xffff; a++) {
    if (!mask[a]) continue;
    loaded++;
    if (exec[a] || operand[a]) executed++;
  }
  const lines = [
    `Wrote ${target}: ${plural(file.labels.length, 'label', 'labels')}, ${plural(file.sessions.length, 'session', 'sessions')}${earlier > 0 ? ` (${earlier} earlier, merged)` : ''}`,
  ];
  if (loaded > 0) lines.push(`Executed in the loaded blocks, all sessions: ${bytes(executed)} of ${loaded.toLocaleString('en-US')} (${pct(executed, loaded)})`);
  if (replaced) lines.push(`(it replaced the file that was at ${target})`);
  lines.push('Fugløy reads it with: fugloy <program> --labels <file>');
  return lines.join('\n');
}
