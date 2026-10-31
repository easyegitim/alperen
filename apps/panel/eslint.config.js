import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/**', '.next/**', '.next-live-test/**', 'out/**', 'public/**', 'next-env.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // window.React / window.ReactDOM yalnız lib/ds-loader.tsx'te açılır (ADR-0008)
      'no-restricted-properties': [
        'error',
        { object: 'window', property: 'React', message: 'window.React yalnız lib/ds-loader.tsx içinde açılır.' },
        { object: 'window', property: 'ReactDOM', message: 'window.ReactDOM yalnız lib/ds-loader.tsx içinde açılır.' },
      ],
    },
  },
  {
    files: ['lib/ds-loader.tsx', 'test/**/*.{ts,tsx}'],
    rules: { 'no-restricted-properties': 'off' },
  },
  {
    files: ['scripts/**/*.mjs', 'next.config.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
);
