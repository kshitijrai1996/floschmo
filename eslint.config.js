import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
        __APP_VERSION__: 'readonly', // injected by Vite (see vite.config.js)
      },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // The scatter plot reads its <svg> ref only inside mouse handlers (to turn
    // screen coordinates into plot coordinates). The rule cannot see through
    // the handlers created inside .map() and reports a false positive.
    files: ['src/ScatterPlot.jsx'],
    rules: { 'react-hooks/refs': 'off' },
  },
])
