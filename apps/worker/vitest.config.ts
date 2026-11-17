import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/**/*.live.test.ts'],
    environment: 'node',
    env: { OGRENMEN_LLM: 'fake' },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
