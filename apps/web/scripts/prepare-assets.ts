// Copies what the site serves from elsewhere in the repo into apps/web/public/ (both are
// gitignored there): the public-domain example programs (.cmd, .hints, .III) from
// examples/<game>/ into examples/<game>/, and the social card docs/images/og-image.png
// as og-image.png, so the card has one source.
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, '..', '..', '..', 'examples');
const target = join(here, '..', 'public', 'examples');
const wanted = new Set(['.cmd', '.hints', '.iii']);

rmSync(target, { recursive: true, force: true });
let copied = 0;
if (existsSync(source)) {
  for (const game of readdirSync(source)) {
    const dir = join(source, game);
    if (!statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir)) {
      if (!wanted.has(extname(file).toLowerCase())) continue;
      mkdirSync(join(target, game), { recursive: true });
      cpSync(join(dir, file), join(target, game, file));
      copied++;
    }
  }
}

const card = join(here, '..', '..', '..', 'docs', 'images', 'og-image.png');
if (!existsSync(card)) throw new Error(`prepare-assets: the social card is missing: ${card}`);
copyFileSync(card, join(here, '..', 'public', 'og-image.png'));
console.log(`prepare-assets: copied ${copied} example files to ${target} and og-image.png to public/`);
