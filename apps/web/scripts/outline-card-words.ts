// Rewrites the words on the social card (docs/images/og-image.svg): the formats line under the
// TRS-80 line, the tagline, the green line of verbs, the footer's list of parts, and the SVG's
// <title> and <desc>. The card's text is outlined glyphs, so it renders the same everywhere with
// no font installed; this script makes the outlines from Inter (the tagline) and JetBrains Mono
// (the rest), in the sizes, colours and places the card already uses. Each line is the group
// <g id="card-…"> in the SVG; the wordmark, the o-slash tile, the TRS-80 line, the ">" before the
// verbs, fugloy.dev and the listing (outline-card-text.ts) are left alone. To change the wording,
// edit WORDS below, run this, then `pnpm --filter @fugloy/web render-brand`. See docs/images/README.md.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const svgPath = join(root, 'docs', 'images', 'og-image.svg');
const fonts = join(here, '..', 'node_modules', '@fontsource');

const TITLE = 'Fugløy — a Z80 toolkit for the TRS-80';
const DESC =
  'Dark card with the Fugløy wordmark, the tagline "A Z80 toolkit for the TRS-80", the line "disassemble · explain · emulate · label", ' +
  'the parts (disassembler, web workbench, Explain tutor, emulator, MCP server), and a pass 1 listing of a short Model III routine with its ROM, video, and DOS addresses named.';

interface Line {
  id: string;
  text: string;
  font: 'inter-500' | 'mono-400' | 'mono-500';
  size: number;
  x: number;
  y: number;
  /** Extra space after each glyph, in px (the tagline is set slightly tight). */
  tracking?: number;
  /** The line must end left of this x, or it runs into the panel or fugloy.dev. */
  maxX: number;
}

const WORDS: Line[] = [
  { id: 'card-formats', text: 'Z80 · .CMD · .BAS · .CAS · ROM', font: 'mono-400', size: 16, x: 192, y: 134, maxX: 660 },
  { id: 'card-tagline', text: 'A Z80 toolkit for the TRS-80', font: 'inter-500', size: 30, x: 72, y: 372, tracking: -0.2, maxX: 660 },
  { id: 'card-verbs', text: 'disassemble · explain · emulate · label', font: 'mono-500', size: 19, x: 94, y: 430, maxX: 660 },
  { id: 'card-parts', text: 'disassembler · web workbench · Explain tutor · emulator · MCP server', font: 'mono-400', size: 16, x: 72, y: 566, maxX: 1000 },
];

const FILES = {
  'inter-500': join(fonts, 'inter', 'files', 'inter-latin-500-normal.woff'),
  'mono-400': join(fonts, 'jetbrains-mono', 'files', 'jetbrains-mono-latin-400-normal.woff'),
  'mono-500': join(fonts, 'jetbrains-mono', 'files', 'jetbrains-mono-latin-500-normal.woff'),
};
const loaded = new Map<string, opentype.Font>();
function font(name: keyof typeof FILES): opentype.Font {
  if (!loaded.has(name)) {
    const buf = readFileSync(FILES[name]);
    loaded.set(name, opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
  }
  return loaded.get(name)!;
}

const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let svg = readFileSync(svgPath, 'utf8');
const defs = new Map<string, string>();
for (const line of WORDS) {
  const f = font(line.font);
  const scale = line.size / f.unitsPerEm;
  const glyphs = [...line.text].map((ch) => f.charToGlyph(ch)); // no shaping: Inter's GSUB trips opentype.js, and the card wants no ligatures
  let x = line.x;
  let uses = '';
  glyphs.forEach((g, i) => {
    const id = `w-${line.font}-${line.size}-${g.index}`;
    if (g.path.commands.length > 0) {
      if (!defs.has(id)) defs.set(id, g.getPath(0, 0, line.size).toPathData(2));
      uses += `<use href="#${id}" x="${x.toFixed(2)}" y="${line.y}"/>`;
    }
    const kern = i + 1 < glyphs.length ? f.getKerningValue(g, glyphs[i + 1]!) : 0;
    x += (g.advanceWidth! + kern) * scale + (line.tracking ?? 0);
  });
  if (x > line.maxX) throw new Error(`outline-card-words: "${line.text}" ends at x=${x.toFixed(1)}, past ${line.maxX}`);
  const group = new RegExp(`<g id="${line.id}" fill="([^"]*)">[\\s\\S]*?</g>`);
  const m = group.exec(svg);
  if (m === null) throw new Error(`outline-card-words: og-image.svg has no <g id="${line.id}">`);
  svg = svg.replace(group, `<g id="${line.id}" fill="${m[1]}">${uses}</g>`);
  console.log(`outline-card-words: ${line.id} ends at x=${x.toFixed(1)}`);
}

svg = svg.replace(/<title id="t">[^<]*<\/title>/, `<title id="t">${escape(TITLE)}</title>`);
svg = svg.replace(/<desc id="d">[^<]*<\/desc>/, `<desc id="d">${escape(DESC)}</desc>`);
// Replace this script's glyph defs, then drop any glyph def nothing uses any more.
svg = svg.replace(/<path id="w-[^"]*" d="[^"]*"\/>\n/g, '');
svg = svg.replace('</defs>', `${[...defs].map(([id, d]) => `<path id="${id}" d="${d}"/>`).join('\n')}\n</defs>`);
svg = svg.replace(/<path id="([^"]+)" d="[^"]*"\/>\n/g, (all, id: string) => (svg.includes(`#${id}"`) ? all : ''));
writeFileSync(svgPath, svg);
console.log(`outline-card-words: ${defs.size} glyphs`);
