// Yalın ESLint: TypeScript önerileri. Prompt metninin kendi kuralları (ünlem, emoji, baskı dili, araç adı) test/lint.test.ts'te.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
    },
  },
  {
    files: ['eslint.config.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
  },
);
