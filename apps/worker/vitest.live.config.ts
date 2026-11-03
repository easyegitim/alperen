import { defineConfig } from 'vitest/config';

// Canlı testler: OGRENMEN_LIVE=1 ve DATABASE_URL (yerel Postgres) gerekir; check.sh denetler.
export default defineConfig({
  test: {
    include: ['test/**/*.live.test.ts'],
    environment: 'node',
    env: { OGRENMEN_LLM: 'fake' },
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
