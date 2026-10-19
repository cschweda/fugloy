// The first screen's JavaScript, measured the way the phase 5 budget is stated
// (5B's method): in a plain `nuxt generate` output, take index.html's module
// script and every modulepreload (not idle-time prefetches), follow each file's
// static imports (`from"./x.js"`, `import"./x.js"`; never `import("./x.js")`),
// gzip each file at level 9, and print the files and the sum.
//
//   pnpm --filter @fugloy/web generate
//   pnpm --filter @fugloy/web size:first-screen [-- [--page learn|invaders] [<public dir>]]
//
// `--page learn` measures learn/index.html the same way, against LEARN_BUDGET; `--page invaders` (6C)
// measures learn/invaders/index.html, the Space Invaders course's chapter 1, against the same budget.

// The budget is 252,775 B (main a6b7831's 247,655 + 5,120). The script exits 1
// over it, and refuses an E2E build (NUXT_PUBLIC_E2E=1 compiles in the test hook,
// which is not on the site's first screen). It also prints the gzip size of the
// lazy chunks named in LAZY_ENTRIES, read from the same build's client manifest.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const WORKBENCH_BUDGET = 252_775;
// The Learn page's first screen as 6B's last task measured it (LEARN_MEASURED B), rounded up to the next
// 1,024 B, plus 5,120 B (the method 5B used for the workbench's budget).
const LEARN_MEASURED = 215_206;
const LEARN_BUDGET = Math.ceil(LEARN_MEASURED / 1024) * 1024 + 5120;
const args = process.argv.slice(2).filter((a) => a !== '--');
const pageAt = args.indexOf('--page');
const pageName = pageAt === -1 ? 'workbench' : args[pageAt + 1];
if (pageName !== 'workbench' && pageName !== 'learn' && pageName !== 'invaders') {
  console.error('--page takes `learn` or `invaders` (or nothing, for the workbench). Run it again with one of those.');
  process.exit(2);
}
const positional = args.filter((a, i) => a !== '--page' && i !== pageAt + 1);
const BUDGET = pageName === 'workbench' ? WORKBENCH_BUDGET : LEARN_BUDGET;
const entry = { workbench: 'index.html', learn: join('learn', 'index.html'), invaders: join('learn', 'invaders', 'index.html') }[pageName];
const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = resolve(positional[0] ?? join(web, '.output', 'public'));
const LAZY_ENTRIES = ['components/source/SourceTab.vue', 'components/run/RunTab.vue', 'utils/running/debug-keys.ts', 'utils/emulator/kit.ts'];

if (!existsSync(join(pub, entry))) {
  console.error(`No generated site at ${pub}. Run \`pnpm --filter @fugloy/web generate\` first, then measure again.`);
  process.exit(2);
}
const html = readFileSync(join(pub, entry), 'utf8');
const start = new Set();
for (const m of html.matchAll(/<(?:script|link)([^>]*)(?:src|href)="\/_nuxt\/([^"]+\.js)"/g)) if (!/prefetch/.test(m[1])) start.add(m[2]);

const seen = new Set();
const queue = [...start];
while (queue.length > 0) {
  const f = queue.pop();
  if (seen.has(f)) continue;
  seen.add(f);
  const src = readFileSync(join(pub, '_nuxt', f), 'utf8');
  for (const m of src.matchAll(/(?:from|import)\s*["']\.\/([^"']+\.js)["']/g)) queue.push(m[1]);
}

const gz = (f) => gzipSync(readFileSync(join(pub, '_nuxt', f)), { level: 9 }).length;
let raw = 0;
let total = 0;
let e2e = false;
const rows = [];
for (const f of seen) {
  const bytes = readFileSync(join(pub, '_nuxt', f));
  if (bytes.includes('__fugloyTest')) e2e = true;
  const g = gz(f);
  raw += bytes.length;
  total += g;
  rows.push([f, bytes.length, g]);
}
if (e2e) {
  console.error('This is an E2E build (it carries window.__fugloyTest). Run a plain `pnpm --filter @fugloy/web generate`, without NUXT_PUBLIC_E2E, then measure again.');
  process.exit(2);
}
rows.sort((a, b) => b[2] - a[2]);
console.log('file\traw B\tgzip B');
for (const r of rows) console.log(r.join('\t'));
console.log(`${{ workbench: 'Workbench', learn: 'Learn page', invaders: 'Build Space Invaders page' }[pageName]} first screen: ${start.size} listed in ${entry}, ${seen.size} files with their static imports; raw ${raw} B; gzip -9 ${total} B (budget ${BUDGET} B, ${BUDGET - total} B left).`);

// The lazy chunks, when this build's client manifest is at hand (the one Nuxt left last).
const manifestPath = ['node_modules/.cache/nuxt/.nuxt/dist/server/client.manifest.mjs', '.nuxt/dist/server/client.manifest.mjs']
  .map((p) => join(web, p))
  .filter((p) => existsSync(p))
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
if (manifestPath !== undefined && positional[0] === undefined) {
  const manifest = (await import(pathToFileURL(manifestPath).href)).default;
  for (const key of LAZY_ENTRIES) {
    const file = manifest[key]?.file;
    if (file !== undefined && existsSync(join(pub, '_nuxt', file))) console.log(`Lazy: ${key} (${file}) gzip -9 ${gz(file)} B`);
  }
}
if (total > BUDGET) {
  console.error(`The first screen is ${total - BUDGET} B over its ${BUDGET} B budget. Move the new code behind a dynamic import, then measure again.`);
  process.exit(1);
}
