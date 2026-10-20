// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from "eslint-plugin-storybook";

import { defineConfig } from "eslint/config";
import next from "eslint-config-next";

export default defineConfig([...next, {
  // Generated or vendored output is never linted.
  ignores: [
    "node_modules/**",
    ".next/**",
    "out/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "storybook-static/**",
    "public/mockServiceWorker.js",
    "supabase/.temp/**",
  ],
}, ...storybook.configs["flat/recommended"]]);
