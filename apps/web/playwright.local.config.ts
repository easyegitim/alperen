import { defineConfig, devices } from '@playwright/test';

// Yerel deneme dumanı (e2e/local-smoke.spec.ts): açık `bun run local` yığınına (scripts/dev-local/up.ts) bağlanır;
// sunucu başlatmaz. Kalıcı ogrenmen_dev veritabanındaki demo hesaplarla koşar. Kullanım (yığın açıkken):
//   cd apps/web && bunx playwright test -c playwright.local.config.ts
const BASE = process.env.LOCAL_WEB_URL || 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: './e2e',
  testMatch: /local-smoke\.spec\.ts/,
  outputDir: 'test-results/local-out',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 240_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: BASE,
    locale: 'tr-TR',
    timezoneId: 'Europe/Istanbul',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
    navigationTimeout: 120_000,
    actionTimeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
