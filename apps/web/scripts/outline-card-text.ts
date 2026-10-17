// Rewrites the listing on the social card (docs/images/og-image.svg) from real `fugloy` output.
// The card's text is outlined glyphs (JetBrains Mono, drawn as <path>s), so it renders the same
// everywhere with no font installed; this script makes the outlines. It writes a tiny raw binary
// (a Model III screen-clear and key-wait loop), runs the CLI on it, turns the first rows of the
// listing into glyph <use>s in the card's colors, and replaces the old listing block and its glyph
// defs. Then run `pnpm --filter @fugloy/web render-brand` for the PNG. See docs/images/README.md.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const svgPath = join(root, 'docs', 'images', 'og-image.svg');
const fontFile = join(here, '..', 'node_modules', '@fontsource', 'jetbrains-mono', 'files', 'jetbrains-mono-latin-400-normal.woff');

// DI / LD SP,7000H / clear the screen with LDIR / wait for a key / back to TRSDOS.
const PROGRAM = [0xf3, 0x31, 0x00, 0x70, 0x21, 0x00, 0x3c, 0x11, 0x01, 0x3c, 0x01, 0xff, 0x03, 0x36, 0x20, 0xed, 0xb0, 0xcd, 0x49, 0x00, 0xfe, 0x0d, 0x20, 0xf9, 0xc3, 0x2d, 0x40];
const COMMAND = 'fugloy start.bin --base 5200';
const ADVANCE = 9.6;
const COLORS = { prompt: '#7fe0a0', text: '#e8eefb', dim: '#6b7a9b', bytes: '#b8a2ff', mnemonic: '#62e3d4', name: '#ffb547' };

const dir = mkdtempSync(join(tmpdir(), 'fugloy-card-'));
writeFileSync(join(dir, 'start.bin'), Buffer.from(PROGRAM));
const listing = execFileSync('node', [join(root, 'packages', 'cli', 'bin', 'fugloy.js'), 'start.bin', '--base', '5200'], { cwd: dir, encoding: 'utf8' })
  .split('\n')
  .filter((l) => !l.startsWith(';') && l.trim() !== '');

const buf = readFileSync(fontFile);
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const defs = new Map<string, string>();
function run(text: string, x: number, y: number, color: string): string {
  let out = '';
  [...text].forEach((ch, i) => {
    if (ch === ' ') return;
    const id = `m16-${ch.charCodeAt(0)}`;
    if (!defs.has(id)) defs.set(id, font.getPath(ch, 0, 0, 16).toPathData(2));
    out += `<use href="#${id}" x="${(x + i * ADVANCE).toFixed(2)}" y="${y}"/>`;
  });
  return out === '' ? '' : `<g fill="${color}">${out}</g>`;
}

const out: string[] = [run('$', 712, 138, COLORS.prompt), run(COMMAND, 731.2, 138, COLORS.text)];
const ROWS = 12;
listing.slice(0, ROWS + 1).forEach((line, i) => {
  const y = 163.5 + 25.5 * i;
  const org = /^\s+(ORG)\s+(\S+)$/.exec(line);
  const label = /^(\w+):$/.exec(line);
  const row = /^([0-9A-F]{4})  ((?:[0-9A-F]{2} ?)+?)\s+([A-Z]+)(?: (\S+))?(?:\s+(; .*))?$/.exec(line);
  if (org) out.push(run('ORG', 788.8, y, COLORS.mnemonic), run(org[2]!, 827.2, y, COLORS.text));
  else if (label) out.push(run(`${label[1]}:`, 712, y, COLORS.name));
  else if (row) {
    const [, addr, bytes, mn, ops, comment] = row;
    out.push(run(addr!, 712, y, COLORS.dim), run(bytes!.trim(), 769.6, y, COLORS.bytes), run(mn!, 904, y, COLORS.mnemonic));
    const x0 = 904 + (mn!.length + 1) * ADVANCE;
    // Operands: a symbol (a name from the tables, or a label) in amber, the rest plain.
    let x = x0;
    for (const part of (ops ?? '').split(/((?:\$[A-Z0-9_]+|[A-Z_][A-Z0-9_]{3,}))/)) {
      if (part === '') continue;
      const isName = /^(?:\$[A-Z0-9_]+|[A-Z_][A-Z0-9_]{3,})$/.test(part) && !/^[0-9A-F]+H$/.test(part);
      out.push(run(part, x, y, isName ? COLORS.name : COLORS.text));
      x += part.length * ADVANCE;
    }
    // A comment only where it fits inside the panel.
    if (comment !== undefined && 1019.2 + comment.length * ADVANCE <= 1112 && x <= 1019.2) out.push(run(comment, 1019.2, y, COLORS.dim));
  } else throw new Error(`outline-card-text: cannot place this listing row: ${line}`);
});

const lines = readFileSync(svgPath, 'utf8').split('\n');
const start = lines.findIndex((l) => l.startsWith(`<g fill="${COLORS.prompt}">`));
const end = lines.findIndex((l) => l.startsWith('<rect x="1009.6"'));
if (start < 0 || end < 0 || end < start) throw new Error('outline-card-text: cannot find the listing block in og-image.svg');
lines.splice(start, end - start, ...out.filter((l) => l !== ''));
let text = lines.join('\n');
text = text.replace(/<path id="m16-\d+" d="[^"]*"\/>\n/g, '');
text = text.replace('</defs>', `${[...defs].map(([id, d]) => `<path id="${id}" d="${d}"/>`).join('\n')}\n</defs>`);
writeFileSync(svgPath, text);
console.log(`outline-card-text: ${listing.length} listing rows, ${defs.size} glyphs`);
