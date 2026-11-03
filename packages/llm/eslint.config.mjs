// Yalın ESLint: TypeScript önerileri + geçide özgü yasaklar (örnekleme parametreleri, zorlanmış tool_choice).
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
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: "Property[key.name=/^(temperature|top_p|top_k)$/]", message: 'temperature/top_p/top_k gönderilmez (PLAN-v2 §5).' },
        { selector: "Property[key.name='tool_choice']", message: 'tool_choice zorlanmaz (Opus/Sonnet 5.5 400 döner).' },
        { selector: "Property[key.name='budget_tokens']", message: 'budget_tokens 5.5 modellerinde 400 döner.' },
      ],
    },
  },
  {
    files: ['eslint.config.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
  },
);
