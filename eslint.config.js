import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // The service worker runs in a worker scope.
    files: ['public/sw.js'],
    languageOptions: { globals: globals.serviceworker },
  },
  {
    // The browser smoke test runs in Node and evaluates code in the page.
    files: ['e2e/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // The engine must stay headless: no UI or DOM imports.
    files: ['src/engine/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['react', 'react-dom', '@xterm/*', 'xterm', '**/ui/**'] },
      ],
    },
  },
);
