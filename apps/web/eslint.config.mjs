// ESLint 9 düz yapılandırma: Next.js çekirdek + TypeScript kuralları (eslint-config-next 16).
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next*/**', 'node_modules/**', 'public/sw.js', 'public/swe-worker-*.js', 'next-env.d.ts', 'test-results/**', 'playwright-report/**']),
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['scripts/**/*.mjs', 'e2e/**/*.mjs', '*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly' } },
  },
]);
