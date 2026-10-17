import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fugloyAliases } from './aliases';

// pdf.js's decoders (JBIG2 and JPEG 2000 in wasm, which archive.org scans use),
// standard fonts, CMaps and ICC profiles, served from the site's own assets at
// /pdfjs/ and fetched only when a manual is opened. No CDN.
const pdfjsDir = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const pdfjsAssets = ['wasm', 'standard_fonts', 'cmaps', 'iccs'].map((d) => ({ dir: join(pdfjsDir, d), baseURL: `/pdfjs/${d}`, maxAge: 60 * 60 * 24 * 7 }));

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  ssr: true,
  nitro: { preset: 'static', publicAssets: pdfjsAssets },
  // Dark only; a light theme is not built.
  colorMode: { preference: 'dark', fallback: 'dark' },
  devtools: { enabled: false },
  typescript: { strict: true },
  alias: fugloyAliases,
  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      title: 'Fugløy',
      meta: [
        { name: 'description', content: 'A TRS-80 Model I/III disassembler that runs in your browser.' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      ],
    },
  },
});
