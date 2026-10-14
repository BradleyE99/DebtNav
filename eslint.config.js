import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules', 'playwright-report', 'test-results'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'e2e/**/*.ts'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['scripts/**/*.mjs', '*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
  {
    // Tests may poke malformed values into typed structures on purpose.
    files: ['src/**/*.test.{ts,tsx}'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    // The calculation engine must stay pure: no UI, storage, or network imports.
    files: ['src/engine/**/*.ts', 'src/policy/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['react', 'react-dom', '**/ui/**', '**/data/**', '**/state/**', '**/integrations/**'] }],
      'no-restricted-globals': ['error', 'window', 'document', 'localStorage', 'fetch'],
    },
  },
);
