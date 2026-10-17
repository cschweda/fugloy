import { fugloyAliases } from './aliases';

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  ssr: true,
  nitro: { preset: 'static' },
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
