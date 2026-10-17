import { defineConfig, devices } from '@playwright/test';

// Browser checks against the generated site. Task 18 wires these into CI; for
// now they run locally with `pnpm --filter @fugloy/web test:e2e`.
export default defineConfig({
  testDir: 'test/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 120_000,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4173', viewport: { width: 1440, height: 900 } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: 'pnpm run generate && tsx scripts/serve-static.ts',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
