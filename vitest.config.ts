import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import path from 'node:path';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
const dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
export default defineConfig({
  // Next.js owns the app's JSX transform (`jsx: preserve` in tsconfig.json), so the
  // test runner asks the Vite 8 oxc transform for the automatic React runtime instead
  // of inheriting the app tsconfig.
  oxc: {
    jsx: {
      runtime: "automatic"
    }
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  test: {
    reporters: ["default"],
    projects: [{
      extends: true,
      test: {
        environment: "node",
        include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
        pool: "threads",
        maxWorkers: 1
      }
    }, {
      extends: true,
      plugins: [
      // The plugin will run tests for the stories defined in your Storybook config
      // See options at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon#storybooktest
      storybookTest({
        configDir: path.join(dirname, '.storybook')
      })],
      test: {
        name: 'storybook',
        browser: {
          enabled: true,
          headless: true,
          provider: playwright({}),
          instances: [{
            browser: 'chromium'
          }]
        }
      }
    }]
  }
});