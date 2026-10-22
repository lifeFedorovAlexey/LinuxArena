import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      '.arena/**',
      '.quality/**',
      'artifacts/**',
      'engine/target/**',
      'reference/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.mjs'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: globals.node },
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'error' },
    rules: {
      'no-unused-vars': ['error', { args: 'after-used', caughtErrors: 'all', ignoreRestSiblings: true }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-throw-literal': 'error',
      'no-return-assign': 'error',
      'no-promise-executor-return': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-unreachable-loop': 'error',
      'no-warning-comments': ['error', { terms: ['todo', 'fixme', 'hack'], location: 'start' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
    },
  },
  {
    files: ['src/ui/**/*.mjs'],
    languageOptions: {
      globals: {
        ...Object.fromEntries(Object.keys(globals.node).map((name) => [name, 'off'])),
        ...globals.browser,
      },
    },
  },
  {
    files: ['src/core/**/*.mjs'],
    languageOptions: { globals: Object.fromEntries(Object.keys(globals.node).map((name) => [name, 'off'])) },
  },
];
