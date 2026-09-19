import { defineConfig, devices } from "@playwright/test";

const PORT = 3001;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "activity-ui.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env["CI"]),
  reporter: [["list"]],
  timeout: 300_000,
  use: {
    baseURL: BASE_URL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "on-first-retry",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: `pnpm build && pnpm start --port ${PORT}`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      ...(process.env as Record<string, string>),
      WORKPULSE_SITE_URL: BASE_URL,
    },
  },
});
