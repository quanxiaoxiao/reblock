import globals from 'globals';
import pluginJs from '@eslint/js';
import tseslint from 'typescript-eslint';

/** @type {import('eslint').Linter.Config[]} */
export default [
  // Base configuration
  {
    files: ['**/*.{js,mjs,cjs,ts}'],
    languageOptions: { globals: globals.node },
  },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='require']",
          message: 'Use ES module import syntax instead of require()',
        },
        {
          selector: "ImportExpression",
          message: 'Use static import statements at the top of the file instead of dynamic import()',
        },
      ],
    },
  },
  // Disable TypeScript rules for plain JS files
  {
    files: ['scripts/**/*.mjs'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      // FIXME: Scripts currently use dynamic imports, remove this override after refactoring to TypeScript
      'no-restricted-syntax': 'off',
      // Scripts must import from src/, not dist/
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/dist/**', '../dist/**', './dist/**'],
              message: 'Scripts must import from src/ directory. Use: await import("../src/...")',
            },
          ],
        },
      ],
    },
  },
  {
    ignores: ['node_modules/**', 'dist/**'],
  },
];
