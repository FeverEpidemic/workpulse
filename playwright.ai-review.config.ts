import { defineConfig, devices } from "@playwright/test";

const PORT = 3008;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// The web server must never see AI endpoint/model/key configuration; only the test-spawned worker child
// gets the explicit fake provider. Provider variables are stripped here as well as in the helper.
const webEnv = Object.fromEntries(
  Object.entries(process.env as Record<string, string>).filter(
    ([key]) => !key.startsWith("WORKPULSE_AI_") && !key.startsWith("WORKPULSE_OPENAI_"),
  ),
);

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "ai-review.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env["CI"]),
  reporter: [["list"]],
  timeout: 360_000,
  use: {
    baseURL: BASE_URL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "on-first-retry",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: `node_modules\\.bin\\next.CMD build && node_modules\\.bin\\next.CMD start --port ${PORT}`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      ...webEnv,
      WORKPULSE_SITE_URL: BASE_URL,
    },
  },
});
