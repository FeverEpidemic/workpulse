import { defineConfig, devices } from "@playwright/test";

const PORT = 3015;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// The web server never sees AI, document-renderer, PDF-renderer or worker-only configuration: account deletion asks the
// database and Auth only. The worker runs as a child process of the tests (tests/e2e/helpers/account-deletion-worker.ts).
const webEnv = Object.fromEntries(
  Object.entries(process.env as Record<string, string>).filter(
    ([key]) => !key.startsWith("WORKPULSE_AI_") && !key.startsWith("WORKPULSE_OPENAI_")
      && !key.startsWith("WORKPULSE_DOCX_") && !key.startsWith("WORKPULSE_GOTENBERG_") && !key.startsWith("WORKPULSE_PDF_"),
  ),
);

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "account-deletion.spec.ts",
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
    timeout: 180_000,
    env: {
      ...webEnv,
      WORKPULSE_SITE_URL: BASE_URL,
    },
  },
});
