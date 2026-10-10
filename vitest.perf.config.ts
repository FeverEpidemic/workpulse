import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// T24 performance measurement: real local Supabase, one worker, never part of `pnpm test`. Run it alone.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/perf/**/*.test.ts"],
    pool: "threads",
    maxWorkers: 1,
    reporters: ["default"],
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
