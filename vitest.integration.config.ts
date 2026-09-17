import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    pool: "threads",
    maxWorkers: 1,
    reporters: ["default"],
    testTimeout: 45_000,
    hookTimeout: 45_000,
  },
});
