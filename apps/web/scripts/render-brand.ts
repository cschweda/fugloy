// Renders the brand images from docs/images/og-image.svg with Playwright's Chromium:
//   docs/images/og-image.png        the social card, 1200x630
//   apps/web/public/favicon.svg     the card's o-slash tile, alone
//   apps/web/public/favicon.ico     16, 32 and 48 px (PNG-compressed entries)
//   apps/web/public/apple-touch-icon.png   180 px, the tile on a full square
// Run by hand (`pnpm --filter @fugloy/web render-brand`) after editing the card; the
// results are committed, and prepare-assets copies the card into public/.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const publicDir = join(here, '..', 'public');
const cardSvg = readFileSync(join(root, 'docs', 'images', 'og-image.svg'), 'utf8');

// The tile is the first <g transform="translate(72 64)"> in the card: two rects and the glyph.
const tile = /<g transform="translate\(72 64\)">([\s\S]*?)\n<\/g>/.exec(cardSvg)?.[1];
const gradients = /<linearGradient id="iconFill"[\s\S]*?<\/linearGradient>\s*<linearGradient id="iconSheen"[\s\S]*?<\/linearGradient>/.exec(cardSvg)?.[0];
if (tile === undefined || gradients === undefined) throw new Error('og-image.svg no longer has the o-slash tile');

const tileSvg = (size: number, bleed: boolean): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 96 96"><defs>${gradients}</defs>${bleed ? tile.replace(/rx="24"/g, 'rx="0"') : tile}</svg>`;

mkdirSync(publicDir, { recursive: true });
writeFileSync(join(publicDir, 'favicon.svg'), `${tileSvg(96, false).replace(/ width="96" height="96"/, '')}\n`);

const browser = await chromium.launch();
async function png(svg: string, w: number, h: number): Promise<Buffer> {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.setContent(`<!doctype html><body style="margin:0;background:transparent">${svg}</body>`);
  const out = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
  await page.close();
  return out;
}

writeFileSync(join(root, 'docs', 'images', 'og-image.png'), await png(cardSvg, 1200, 630));
writeFileSync(join(publicDir, 'apple-touch-icon.png'), await png(tileSvg(180, true), 180, 180));

// ICO: a 6-byte header, one 16-byte directory entry per image, then the PNGs.
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map((s) => png(tileSvg(s, false), s, s)));
const head = Buffer.alloc(6 + 16 * sizes.length);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(sizes.length, 4);
let offset = head.length;
sizes.forEach((s, i) => {
  const at = 6 + 16 * i;
  head[at] = s;
  head[at + 1] = s;
  head.writeUInt16LE(1, at + 4);
  head.writeUInt16LE(32, at + 6);
  head.writeUInt32LE(images[i]!.length, at + 8);
  head.writeUInt32LE(offset, at + 12);
  offset += images[i]!.length;
});
writeFileSync(join(publicDir, 'favicon.ico'), Buffer.concat([head, ...images]));
await browser.close();
console.log('render-brand: og-image.png, favicon.svg, favicon.ico, apple-touch-icon.png');
