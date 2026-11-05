import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
