import { defineConfig, devices } from '@playwright/test';
import { FAKE_ANON_KEY, FAKE_PORT, FAKE_URL, WEB_PORT, WEB_URL } from './e2e/fixtures.mjs';

// E2E (çakışan koşular birbirinin sunucusuna bağlanmasın diye sunucular her koşuda yeniden açılır; E2E_REUSE=1 ile geliştirmede yeniden kullanılır): sahte Supabase (e2e/fake-supabase.mjs) + üretim derlemesi (.next-e2e; `bun run build:e2e`) üzerinde `next start`.
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  // P1 yolculuğu kendi yığınıyla (gerçek Postgres + worker) ayrı yapılandırmada koşar: playwright.journey.config.ts
  testIgnore: ['**/p1-journey.spec.ts', '**/p2-deneme.spec.ts', '**/p3-icerik.spec.ts', '**/p4-tarz.spec.ts', '**/p5-ders.spec.ts', '**/p6-veli.spec.ts'],
  outputDir: 'test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: WEB_URL,
    locale: 'tr-TR',
    timezoneId: 'Europe/Istanbul',
    trace: 'off',
    screenshot: 'off',
    serviceWorkers: 'block',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node e2e/fake-supabase.mjs',
      url: `http://127.0.0.1:${FAKE_PORT}/__health`,
      reuseExistingServer: !!process.env.E2E_REUSE,
      timeout: 15_000,
    },
    {
      command: `node node_modules/next/dist/bin/next start -p ${WEB_PORT} -H 127.0.0.1`,
      url: `${WEB_URL}/api/health`,
      reuseExistingServer: !!process.env.E2E_REUSE,
      timeout: 60_000,
      env: {
        NEXT_DIST_DIR: '.next-e2e',
        NEXT_PUBLIC_SUPABASE_URL: FAKE_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: FAKE_ANON_KEY,
        NEXT_PUBLIC_SITE_URL: WEB_URL,
        // Koç sohbeti: sahte LLM + süreç içi sohbet deposu (src/server/chat/memory-store.ts; yalnız fake ile açılır).
        OGRENMEN_LLM: 'fake',
        OGRENMEN_CHAT_STORE: 'memory',
        // Veli sohbeti bellek deposu (src/server/parent/store.ts): örnek çocuğa ek olarak sahte Supabase'in öğrencisi.
        OGRENMEN_PARENT_MEMORY_CHILDREN: '10000000-0000-4000-8000-000000000001',
      },
    },
  ],
});
