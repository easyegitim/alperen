// ESLint düz yapılandırma (BLUEPRINT §5.11): cevap anahtarı içe alımı yasak, hizmet rolü / JWT gizi adı
// yasak, console.log içinde display_name|text_raw yasak, çalışma anında Ajv derlemesi yasak.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const restrictedImports = {
  paths: [
    { name: '@ogrenmen/contracts/answer-key', message: 'Worker cevap anahtarı modülünü içe alamaz (yalnız pipelines).' },
    { name: '@ogrenmen/contracts', message: 'Kök dışa aktarım çalışma anında Ajv derler; @ogrenmen/contracts/validators kullan.' },
    { name: 'ajv', message: 'Worker\'da Ajv derlenmez (10 ms CPU); önceden derlenmiş doğrulayıcı kullan.' },
  ],
  patterns: [{ group: ['ajv/*', '**/answer-key*'], message: 'Worker\'da Ajv ve cevap anahtarı yok.' }],
};

const restrictedSyntax = [
  { selector: 'Literal[value=/service_role/i]', message: 'service_role Worker kodunda geçemez.' },
  { selector: 'Literal[value=/SUPABASE_JWT_SECRET/]', message: 'JWT gizi Worker kodunda geçemez.' },
  { selector: 'TemplateElement[value.raw=/service_role|SUPABASE_JWT_SECRET/i]', message: 'service_role / JWT gizi Worker kodunda geçemez.' },
  { selector: 'Identifier[name=/service_role|SUPABASE_JWT_SECRET/i]', message: 'service_role / JWT gizi Worker kodunda geçemez.' },
  {
    selector: "CallExpression[callee.object.name='console'][callee.property.name='log'] :matches(Identifier[name=/display_name|text_raw/], Literal[value=/display_name|text_raw/], TemplateElement[value.raw=/display_name|text_raw/])",
    message: 'console.log içinde display_name / text_raw yasak (loglar yalnız public_ref ve chat_hash taşır).',
  },
  { selector: "NewExpression[callee.name='Ajv']", message: 'Worker\'da new Ajv( yok; @ogrenmen/contracts/validators kullan.' },
];

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '.wrangler/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', restrictedImports],
      'no-restricted-syntax': ['error', ...restrictedSyntax],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      // Testler sahte cevap anahtarını (test/fakes/key-oracle.ts) ve ham alanları okuyabilir.
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
