import { defineConfig, devices } from "@playwright/test";

// T25 release matrix: accessibility, layout and keyboard checks against a production build (port 3017; 3000 to 3016
// belong to the earlier gates).
const PORT = 3017;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// The web server never sees AI, document-renderer, PDF-renderer or worker-only configuration. Workers run as child
// processes of the tests (tests/e2e/helpers/export-worker.ts, import-worker.ts, account-deletion-worker.ts).
const webEnv = Object.fromEntries(
  Object.entries(process.env as Record<string, string>).filter(
    ([key]) => !key.startsWith("WORKPULSE_AI_") && !key.startsWith("WORKPULSE_OPENAI_")
      && !key.startsWith("WORKPULSE_DOCX_") && !key.startsWith("WORKPULSE_GOTENBERG_") && !key.startsWith("WORKPULSE_PDF_"),
  ),
);

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: ["release-a11y.spec.ts", "release-keyboard.spec.ts"],
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env["CI"]),
  reporter: [["list"]],
  timeout: 900_000,
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
    timeout: 240_000,
    env: {
      ...webEnv,
      WORKPULSE_SITE_URL: BASE_URL,
    },
  },
});
