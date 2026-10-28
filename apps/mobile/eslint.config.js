const { defineConfig } = require('eslint/config');
const expo = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expo,
  {
    ignores: ['dist/*', '.expo/*', 'node_modules/*', 'src/illustrations/index.ts', 'src/legal/index.ts'],
  },
]);
