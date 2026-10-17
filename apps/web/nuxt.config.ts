import { fileURLToPath } from 'node:url';

// The site consumes the workspace packages from source, as the root vitest.config.ts
// does, so it needs no prior `pnpm build`.
const src = (name: string): string =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  ssr: true,
  nitro: { preset: 'static' },
  colorMode: { preference: 'dark', fallback: 'dark' },
  devtools: { enabled: false },
  typescript: { strict: true },
  vite: {
    resolve: {
      alias: {
        '@fugloy/z80': src('z80'),
        '@fugloy/disasm': src('disasm'),
      },
    },
  },
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
