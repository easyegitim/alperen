import { defineConfig } from 'vitest/config';

// Veritabanı entegrasyon testleri: OGRENMEN_LIVE=1 ve yerel Postgres gerekir (check.sh denetler). Her dosya kendi
// geçici veritabanını kurar ve siler (src/testing/tempDb.ts); LLM her zaman sahte taşımadır.
export default defineConfig({
  test: {
    include: ['test/**/*.db.test.ts'],
    environment: 'node',
    env: { OGRENMEN_LLM: 'fake' },
    testTimeout: 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
