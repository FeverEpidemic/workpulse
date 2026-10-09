import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

// Worker-only configuration is removed first so nothing leaks from the test process into the child by accident.
const CHILD_ONLY_PREFIXES = ["WORKPULSE_AI_", "WORKPULSE_OPENAI_", "WORKPULSE_DOCX_", "WORKPULSE_GOTENBERG_", "WORKPULSE_PDF_", "WORKPULSE_SCANNER_", "WORKPULSE_CLAMD_"];
const CONTAINER = process.env["WORKPULSE_TEST_DB_CONTAINER"] ?? "supabase_db_WorkPulse";

function childEnv(): NodeJS.ProcessEnv {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (CHILD_ONLY_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    env[key] = value;
  }
  // The deletion pass needs no renderer; the fake one only satisfies the worker bootstrap and is refused outside test.
  env["NODE_ENV"] = "test";
  env["WORKPULSE_PDF_RENDERER_MODE"] = "fake";
  return env as NodeJS.ProcessEnv;
}

/** Statements run as the database owner, for facts no API role may read (receipts, Storage rows). */
export function sql(statement: string): string {
  return execFileSync(
    "docker",
    ["exec", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", statement],
    { stdio: "pipe", encoding: "utf8" },
  ).trim();
}

export function receiptStatus(userId: string): string {
  return sql(`select coalesce((select status from internal.account_deletions where user_id = '${userId}'::uuid), 'none')`);
}

export function objectCount(userId: string): number {
  return Number(sql(`select count(*) from storage.objects where bucket_id = 'workpulse-private' and starts_with(name, '${userId}/')`));
}

function runOnce(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ["workers/run.ts", "--once"], { env: childEnv(), timeout: 150_000 }, (error, stdout, stderr) => {
      if (!stdout.trim()) return reject(new Error(`worker produced no summary${error ? " (process failed)" : ""}`));
      resolve(stdout + stderr);
    });
  });
}

/** Runs the real worker until the receipt of the user is completed; returns all worker output (for sentinel checks). */
export async function drainUntilCompleted(userId: string, rounds = 12): Promise<{ output: string; rounds: number }> {
  let output = "";
  for (let round = 1; round <= rounds; round += 1) {
    output += await runOnce();
    if (receiptStatus(userId) === "completed") return { output, rounds: round };
  }
  return { output, rounds };
}
