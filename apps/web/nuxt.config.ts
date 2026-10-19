import { copyFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fugloyAliases } from './aliases';
import { unflagLazy } from './lazy-chunks';

// pdf.js's decoders (JBIG2 and JPEG 2000 in wasm, which archive.org scans use),
// standard fonts, CMaps and ICC profiles, served from the site's own assets at
// /pdfjs/ and fetched only when a manual is opened. No CDN.
const pdfjsDir = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const pdfjsAssets = ['wasm', 'standard_fonts', 'cmaps', 'iccs'].map((d) => ({ dir: join(pdfjsDir, d), baseURL: `/pdfjs/${d}`, maxAge: 60 * 60 * 24 * 7 }));

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  modules: ['@nuxt/ui'],
  // JetBrains Mono (the listing's face, SIL OFL 1.1) is self-hosted from @fontsource: Latin only, 400 and 700. No font CDN.
  css: ['@fontsource/jetbrains-mono/latin-400.css', '@fontsource/jetbrains-mono/latin-700.css', '~/assets/css/main.css'],
  ssr: true,
  // The crawler must not follow the About page's link to /pdfjs/LICENSE: the file is copied in after prerendering.
  nitro: { preset: 'static', publicAssets: pdfjsAssets, prerender: { ignore: ['/pdfjs/'] } },
  hooks: {
    // The lazily loaded parts (Source ✎: CodeMirror and asm, plan 5B) are fetched
    // when first opened, never prefetched with the first screen (lazy-chunks.ts;
    // `pnpm --filter @fugloy/web check:prefetch` checks the generated pages).
    'build:manifest'(manifest) {
      unflagLazy(manifest);
    },
    // After the public assets are copied: pdf.js's licence beside its files
    // (Apache-2.0 §4(a); the minified chunk loses its header), and no QuickJS
    // sandbox, since PDF scripting is never enabled.
    async 'nitro:build:public-assets'(nitro) {
      const out = join(nitro.options.output.publicDir, 'pdfjs');
      await copyFile(join(pdfjsDir, 'LICENSE'), join(out, 'LICENSE'));
      for (const f of ['quickjs-eval.js', 'quickjs-eval.wasm']) await rm(join(out, 'wasm', f), { force: true });
    },
  },
  // Dark only; a light theme is not built.
  colorMode: { preference: 'dark', fallback: 'dark' },
  devtools: { enabled: false },
  // Netlify serves each generated page as a directory (/about/), so links carry the slash and take no redirect.
  experimental: { defaults: { nuxtLink: { trailingSlash: 'append' } } },
  typescript: { strict: true },
  alias: fugloyAliases,
  // The Playwright checks' window.__fugloyTest hook (pages/index.vue) is compiled in only when
  // NUXT_PUBLIC_E2E=1, which only playwright.config's web server sets; the site never ships it.
  vite: { define: { __FUGLOY_E2E__: JSON.stringify(process.env.NUXT_PUBLIC_E2E === '1') } },
  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      title: 'Fugløy',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'theme-color', content: '#0d1117' },
      ],
      // Favicons are the card's o-slash tile (scripts/render-brand.ts). usePageSeo sets each page's
      // title, description, canonical URL and social tags; sitemap.xml and robots.txt are in public/.
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'icon', type: 'image/x-icon', sizes: 'any', href: '/favicon.ico' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      ],
    },
  },
});
