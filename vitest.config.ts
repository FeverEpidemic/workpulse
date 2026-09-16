import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  // Next.js owns the app's JSX transform (`jsx: preserve` in tsconfig.json), so the
  // test runner asks the Vite 8 oxc transform for the automatic React runtime instead
  // of inheriting the app tsconfig.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
    pool: "threads",
    maxWorkers: 1,
    reporters: ["default"],
  },
});
