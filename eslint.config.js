// ESLint flat config: custom code-quality rules enforced in the Code Quality stage.
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**', 'reports/**', 'data/**', 'monitoring/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: {
      complexity: ['error', 12],            // flag overly branchy functions
      'max-depth': ['error', 4],
      'max-params': ['error', 4],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  { files: ['public/**/*.js'], languageOptions: { sourceType: 'script', globals: { ...globals.browser } } },
  { files: ['tests/**/*.js'], languageOptions: { globals: { ...globals.jest } } },
];
