import { execFile } from "node:child_process";
import { existsSync } from "node:fs";

export type WorkerScenario =
  | "valid" | "with_skills" | "malformed" | "unavailable" | "no_potential" | "refusal";

const AI_ENV_PREFIXES = ["WORKPULSE_AI_", "WORKPULSE_OPENAI_"];

function childEnv(scenario: WorkerScenario): NodeJS.ProcessEnv {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (AI_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    env[key] = value;
  }
  // The fake adapter is refused outside development/test, so the child is marked test explicitly.
  env["NODE_ENV"] = "test";
  env["WORKPULSE_AI_MODE"] = "fake";
  env["WORKPULSE_AI_FAKE_SCENARIO"] = scenario;
  return env as NodeJS.ProcessEnv;
}

function runOnce(scenario: WorkerScenario): Promise<{ aiJobsClaimed: number }> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ["workers/run.ts", "--once"], { env: childEnv(scenario), timeout: 60_000 }, (error, stdout) => {
      const line = stdout.trim().split("\n").filter(Boolean).at(-1) ?? "";
      let summary: { aiJobsClaimed?: number } | null = null;
      try { summary = JSON.parse(line) as { aiJobsClaimed?: number }; } catch { summary = null; }
      // Exit code 1 only means the evidence pass had no scanner; the AI pass result is what matters here.
      if (summary === null) return reject(new Error(`AI worker produced no summary${error ? " (process failed)" : ""}`));
      resolve({ aiJobsClaimed: summary.aiJobsClaimed ?? 0 });
    });
  });
}

/** Drain the AI queue with the explicit fake provider; returns how many jobs were claimed in total. */
export async function drainAiWorker(scenario: WorkerScenario = "valid"): Promise<number> {
  let total = 0;
  for (let round = 0; round < 5; round += 1) {
    const { aiJobsClaimed } = await runOnce(scenario);
    if (aiJobsClaimed === 0) return total;
    total += aiJobsClaimed;
  }
  return total;
}
