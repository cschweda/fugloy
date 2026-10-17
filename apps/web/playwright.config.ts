import { defineConfig, devices } from '@playwright/test';

// Browser checks against the generated site, served statically on :4173 (the web
// server generates it first). Run with `pnpm --filter @fugloy/web test:e2e`; CI's
// `web` job runs them too. The specs import @fugloy/disasm and @fugloy/cli as Node
// resolves them, from dist/, so run `pnpm build` first. Local-only specs skip
// without their gitignored files; FUGLOY_PERF=1 enforces listing-perf's timings.
export default defineConfig({
  testDir: 'test/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 120_000,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4173', viewport: { width: 1440, height: 900 } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    // NUXT_PUBLIC_E2E=1 compiles in window.__fugloyTest, which the specs drive; the site's own build leaves it out.
    command: 'NUXT_PUBLIC_E2E=1 pnpm run generate && tsx scripts/serve-static.ts',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
