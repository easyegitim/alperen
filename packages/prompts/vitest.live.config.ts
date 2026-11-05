import { defineConfig } from 'vitest/config';

// Canlı testler: count_tokens (ANTHROPIC_API_KEY) ve geçici veritabanında prompt_versions eşitlemesi (OGRENMEN_DATABASE_URL).
export default defineConfig({
  test: {
    include: ['test/**/*.live.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
  },
});
