import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    setupFiles: ['test/setup.ts'],
    testTimeout: 20000,
    hookTimeout: 600000,
    env: { NEXT_PUBLIC_DATA_SOURCE: 'mock' },
  },
});
