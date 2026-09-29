import { execFile } from "node:child_process";
import { existsSync } from "node:fs";

export type ImportWorkerScenario = "valid" | "unavailable" | "import_empty" | "malformed";

const CHILD_ONLY_PREFIXES = ["WORKPULSE_AI_", "WORKPULSE_OPENAI_", "WORKPULSE_DOCX_", "WORKPULSE_GOTENBERG_", "WORKPULSE_SCANNER_", "WORKPULSE_CLAMD_"];

function childEnv(scenario: ImportWorkerScenario): NodeJS.ProcessEnv {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (CHILD_ONLY_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    env[key] = value;
  }
  // Fake AI and the fake DOCX renderer are refused outside development/test.
  env["NODE_ENV"] = "test";
  env["WORKPULSE_AI_MODE"] = "fake";
  env["WORKPULSE_AI_FAKE_SCENARIO"] = scenario;
  env["WORKPULSE_DOCX_RENDERER_MODE"] = "fake";
  // Screening is real: the local ClamAV container from the T10 runbook.
  env["WORKPULSE_SCANNER_MODE"] = "clamav";
  env["WORKPULSE_CLAMD_HOST"] = "127.0.0.1";
  env["WORKPULSE_CLAMD_PORT"] = "13310";
  return env as NodeJS.ProcessEnv;
}

type Summary = { importJobsClaimed?: number; aiJobsClaimed?: number };

function runOnce(scenario: ImportWorkerScenario): Promise<{ claimed: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ["workers/run.ts", "--once"], { env: childEnv(scenario), timeout: 120_000 }, (error, stdout, stderr) => {
      const line = stdout.trim().split("\n").filter(Boolean).at(-1) ?? "";
      let summary: Summary | null = null;
      try { summary = JSON.parse(line) as Summary; } catch { summary = null; }
      if (summary === null) return reject(new Error(`import worker produced no summary${error ? " (process failed)" : ""}`));
      resolve({ claimed: (summary.importJobsClaimed ?? 0) + (summary.aiJobsClaimed ?? 0), stdout: stdout + stderr });
    });
  });
}

/** Drain scan/parse and AI import jobs; returns claimed count and all worker output (for sentinel checks). */
export async function drainImportWorker(scenario: ImportWorkerScenario = "valid"): Promise<{ claimed: number; output: string }> {
  let claimed = 0;
  let output = "";
  for (let round = 0; round < 10; round += 1) {
    const result = await runOnce(scenario);
    output += result.stdout;
    if (result.claimed === 0) break;
    claimed += result.claimed;
  }
  return { claimed, output };
}
