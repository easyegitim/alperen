import { defineConfig, devices } from '@playwright/test';
import { BRIDGE_URL, JOURNEY_WEB_URL } from './e2e/journey/config.mjs';

// P1 yolculuğu (e2e/p1-journey.spec.ts; OGRENMEN_LIVE=1, apps/web/check.sh): gerçek Postgres (geçici veritabanı) +
// Supabase uyumlu yerel köprü + gerçek worker (pg-boss) + `next dev`; LLM her yerde sahte. Yığını tek süreç açar ve
// kapatır (e2e/journey/stack.ts; SIGTERM'de geçici veritabanı silinir). JOURNEY_REUSE=1 geliştirmede açık yığını kullanır.
export default defineConfig({
  testDir: './e2e',
  testMatch: /p[12]-(journey|deneme)\.spec\.ts/,
  outputDir: 'test-results/journey-out',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 300_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: JOURNEY_WEB_URL,
    locale: 'tr-TR',
    timezoneId: 'Europe/Istanbul',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
    navigationTimeout: 90_000,
    actionTimeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'bun e2e/journey/stack.ts',
      url: `${BRIDGE_URL}/__ready`,
      reuseExistingServer: !!process.env.JOURNEY_REUSE,
      timeout: 300_000,
      stdout: 'pipe',
      gracefulShutdown: { signal: 'SIGTERM', timeout: 15_000 },
    },
  ],
});
