import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// T22 PDF QA: real Chromium renderer (workpulse-t21-pdf), no database. Needs WORKPULSE_PDF_GOTENBERG_URL.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/pdf/**/*.test.ts"],
    pool: "threads",
    maxWorkers: 1,
    reporters: ["default"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
