import { defineConfig } from 'vitest/config';

// Canlı testler: OGRENMEN_LIVE=1 ve ANTHROPIC_API_KEY gerekir (check.sh denetler); gerçek API'ye gider.
export default defineConfig({
  test: {
    include: ['test/**/*.live.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
  },
});
