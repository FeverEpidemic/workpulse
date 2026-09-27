import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Opt-in live provider smoke (T13 Fase 6). Never part of `pnpm test`; skipped unless WORKPULSE_AI_LIVE=1.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/live/**/*.test.ts"],
    pool: "threads",
    maxWorkers: 1,
    reporters: ["default"],
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
});
