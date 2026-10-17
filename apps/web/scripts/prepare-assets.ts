// Copies the public-domain example programs (.cmd, .hints, .III) from the repo's
// examples/<game>/ into apps/web/public/examples/<game>/ so the site can serve them.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
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
console.log(`prepare-examples: copied ${copied} files to ${target}`);
