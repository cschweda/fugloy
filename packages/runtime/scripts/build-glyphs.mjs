// Converts xtrs's trs_chars.c, the TRS-80 character generators (Timothy P. Mann; the Model III
// sets read from real character generator ROMs by Todd P. Cromwell III), into the screen's glyph
// table, src/glyphs.generated.js, which the renderer (src/screen.js) draws with, for the workbench
// (apps/web, phase 5D) and for a port's player (M2). It keeps four of xtrs's sets:
//
//   CG 1  the Model I's stock generator (6x12; 00H-7FH)
//   CG 2  the Model I's replacement generator, sold with the lowercase kit (6x12; 00H-7FH)
//   CG 4  the Model III's, with the katakana alternate set (8x12; 00H-FFH)
//   CG 8  the Model 4's, with the international alternate set (8x12; 00H-FFH)
//
// Run by hand, on trs_chars.c and xtrs's LICENSE from the pinned commit. `pnpm xtrs:install` clones
// xtrs at that commit into tools/xtrs/src, which holds both, and is the default directory:
//
//   node packages/runtime/scripts/build-glyphs.mjs [<dir holding both>]
//
// or fetch the two files by hand into a directory of their own:
//
//   curl -fLO https://raw.githubusercontent.com/TimothyPMann/xtrs/<COMMIT>/trs_chars.c
//   curl -fLO https://raw.githubusercontent.com/TimothyPMann/xtrs/<COMMIT>/LICENSE
//
// Neither file is committed. The converter checks each one's SHA-256 against the constants below,
// refuses a LICENSE without Timothy P. Mann's notice (trs_chars.c itself carries none; xtrs's
// LICENSE covers the whole program), and writes the notice into the generated file.
//
// xtrs stores each pixel row with the leftmost pixel in bit 0 (of an 8-wide row, or of the 6-wide
// field of a Model I row, whose bit 5 is its rightmost pixel). The table stores every row with the
// leftmost pixel in bit 7, as the renderer reads it.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const COMMIT = '3a2180c063811a715faa28d39a94739c33e0abd0';
export const RAW = `https://raw.githubusercontent.com/TimothyPMann/xtrs/${COMMIT}`;
export const CHARS_SHA256 = '1b8bbb9d63a8d598e58f64e831fc11a08f61a82e5c2eb0f631e5cc7be1464166';
export const LICENSE_SHA256 = '614367e2793a12214343dcd4fc95fc75e32fe943f103bb0c9c946070f94e4c93';
const NOTICE = 'Copyright (c) 1996-2020, Timothy P. Mann';
const HEIGHT = 12;

/** Where `pnpm xtrs:install` leaves xtrs's source at the pinned commit: the default directory. */
export const XTRS_SRC = fileURLToPath(new URL('../../../tools/xtrs/src/', import.meta.url));
/** The generated module. */
export const TARGET = fileURLToPath(new URL('../src/glyphs.generated.js', import.meta.url));

/** The sets kept, by name in the table, with their xtrs CG number and cell width. */
export const SETS = /** @type {const} */ ([
  { name: 'CG_MODEL1', key: 'model1', cg: 1, width: 6 },
  { name: 'CG_MODEL1_LOWERCASE', key: 'model1Lowercase', cg: 2, width: 6 },
  { name: 'CG_MODEL3', key: 'model3', cg: 4, width: 8 },
  { name: 'CG_MODEL4', key: 'model4', cg: 8, width: 8 },
]);

/** @typedef {import('../src/glyphs.generated.js').GlyphSet} GlyphSet */

/**
 * trs_chars.c's `trs_char_data` as charset, then character, then its 12 row bytes as written in
 * the file (leftmost pixel in bit 0). Comments are skipped.
 * @param {string} text
 * @returns {number[][][]}
 */
export function parseTrsChars(text) {
  const body = text.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const start = body.indexOf('{');
  if (start < 0) throw new Error('This file has no character data (no opening brace).');
  /** @type {number[][][]} */
  const sets = [];
  let depth = 0;
  /** @type {number[][]} */
  let set = [];
  /** @type {number[]} */
  let char = [];
  for (const tok of body.slice(start).match(/\{|\}|0x[0-9a-fA-F]+/g) ?? []) {
    if (tok === '{') {
      depth++;
      if (depth === 2) set = [];
      else if (depth === 3) char = [];
      else if (depth > 3) throw new Error('The character data nests deeper than charset, character, row.');
    } else if (tok === '}') {
      if (depth === 3) {
        if (char.length !== HEIGHT) throw new Error(`Character ${set.length} of charset ${sets.length} has ${char.length} rows, not ${HEIGHT}.`);
        set.push(char);
      } else if (depth === 2) sets.push(set);
      depth--;
      if (depth === 0) break;
    } else {
      if (depth !== 3) throw new Error(`A byte (${tok}) sits outside a character.`);
      char.push(parseInt(tok, 16));
    }
  }
  return sets;
}

/**
 * One charset as a table of 256 characters, each row reversed and left-aligned (bit 7 leftmost).
 * @param {number[][]} raw
 * @param {6 | 8} width
 * @returns {GlyphSet}
 */
export function toGlyphSet(raw, width) {
  if (raw.length > 256) throw new Error(`A charset has ${raw.length} characters; a TRS-80 generator has at most 256.`);
  const rows = new Uint8Array(256 * HEIGHT);
  raw.forEach((char, code) =>
    char.forEach((b, y) => {
      if (b >> width !== 0) throw new Error(`Character ${code.toString(16)}H row ${y} (${b.toString(16)}H) has pixels outside its ${width}-pixel cell.`);
      let r = 0;
      for (let x = 0; x < width; x++) if ((b >> x) & 1) r |= 0x80 >> x;
      rows[code * HEIGHT + y] = r;
    }),
  );
  return { width, height: HEIGHT, rows };
}

/** @param {Uint8Array} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** @param {Uint8Array} bytes */
const hex = (bytes) => Buffer.from(bytes).toString('hex');

/**
 * The generated module's text from trs_chars.c's and LICENSE's bytes.
 * @param {Uint8Array} chars
 * @param {Uint8Array} license
 * @returns {string}
 */
export function buildTable(chars, license) {
  const licenseText = Buffer.from(license).toString('utf8');
  if (!licenseText.includes(NOTICE)) throw new Error(`This LICENSE lacks the notice "${NOTICE}", so Fugløy will not use the file. Fetch it from ${RAW}/LICENSE.`);
  if (sha256(chars) !== CHARS_SHA256) throw new Error(`This trs_chars.c's SHA-256 is ${sha256(chars)}, not the pinned file's ${CHARS_SHA256}. Fetch it from ${RAW}/trs_chars.c.`);
  if (sha256(license) !== LICENSE_SHA256) throw new Error(`This LICENSE's SHA-256 is ${sha256(license)}, not the pinned file's ${LICENSE_SHA256}. Fetch it from ${RAW}/LICENSE.`);
  const charsets = parseTrsChars(Buffer.from(chars).toString('latin1'));
  const source = {
    url: `${RAW}/trs_chars.c`,
    sha256: CHARS_SHA256,
    commit: COMMIT,
    sets: Object.fromEntries(SETS.map((s) => [s.key, s.cg])),
  };
  const lines = [
    '// Generated by packages/runtime/scripts/build-glyphs.mjs; do not edit. Rebuild it from the file below.',
    '//',
    "// The TRS-80 screen's glyphs (src/screen.js draws with them): the TRS-80 character generators from",
    "// xtrs's trs_chars.c",
    `//   ${source.url}`,
    `//   SHA-256 ${source.sha256}`,
    '// CG 1 (the Model I, stock), CG 2 (the Model I with the lowercase kit), CG 4 (the Model III,',
    '// katakana alternates), and CG 8 (the Model 4, international alternates). Each row has its',
    '// leftmost pixel in bit 7; characters a set lacks (80H-FFH on the Model I) are blank.',
    '//',
    "// xtrs's licence (its LICENSE file at the same commit), which this file's data is under:",
    '//',
    ...licenseText.trimEnd().split('\n').map((l) => `//   ${l}`.trimEnd()),
    '',
    '/** @param {string} hex */',
    'const bytes = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));',
    '',
    '/**',
    ' * @typedef {object} GlyphSet',
    ' * @property {6 | 8} width',
    ' * @property {12} height',
    ' * @property {Uint8Array} rows 256 characters x 12 bytes, one per pixel row, the leftmost pixel in bit 7.',
    ' */',
    '',
    `export const GLYPH_SOURCE = Object.freeze(${JSON.stringify(source, null, 2)});`,
    '',
    ...SETS.flatMap((s) => {
      const raw = charsets[s.cg];
      if (raw === undefined) throw new Error(`trs_chars.c has no CG ${s.cg}.`);
      const set = toGlyphSet(raw, s.width);
      return [
        '/** @type {GlyphSet} */',
        `export const ${s.name} = {`,
        `  width: ${s.width},`,
        `  height: ${HEIGHT},`,
        '  rows: bytes(',
        ...(hex(set.rows).match(/.{1,96}/g) ?? []).map((chunk, i, all) => `    '${chunk}'${i < all.length - 1 ? ' +' : ','}`),
        '  ),',
        '};',
        '',
      ];
    }),
  ];
  return lines.join('\n');
}

function main() {
  const dir = process.argv[2] ?? XTRS_SRC;
  let chars, license;
  try {
    chars = readFileSync(join(dir, 'trs_chars.c'));
    license = readFileSync(join(dir, 'LICENSE'));
  } catch {
    console.error(`usage: node scripts/build-glyphs.mjs [<directory holding trs_chars.c and LICENSE>]\n${dir} lacks them; run \`pnpm xtrs:install\`, or fetch both from ${RAW}/.`);
    process.exit(2);
  }
  writeFileSync(TARGET, buildTable(chars, license));
  console.log(`wrote ${TARGET}`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();
