import { defineConfig, devices } from "@playwright/test";
const PORT = 3004;
const BASE_URL = `http://127.0.0.1:${PORT}`;
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: ["evidence-api.spec.ts", "evidence-ui.spec.ts", "activity-ui.spec.ts", "projects-ui.spec.ts", "achievements-ui.spec.ts"],
  fullyParallel: false, workers: 1, forbidOnly: Boolean(process.env.CI), reporter: [["list"]], timeout: 300_000,
  use: { baseURL: BASE_URL, actionTimeout: 15_000, navigationTimeout: 30_000, trace: "on-first-retry", ...devices["Desktop Chrome"] },
  webServer: { command: `node_modules\\.bin\\next.CMD build && node_modules\\.bin\\next.CMD start --port ${PORT}`, url: `${BASE_URL}/api/health`, reuseExistingServer: false, timeout: 180_000, env: { ...(process.env as Record<string, string>), WORKPULSE_SITE_URL: BASE_URL } },
});
