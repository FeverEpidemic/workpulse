import { setTimeout as delay } from "node:timers/promises";
import { createSupabaseEvidenceWorkerGateway } from "./supabase-evidence-gateway.ts";
import { runEvidenceWorkerOnce } from "./evidence-worker.ts";
import { createSupabaseAiWorkerGateway } from "./supabase-ai-gateway.ts";
import { runAiWorkerOnce } from "./ai-worker.ts";
import { resolveMalwareScanner } from "../src/server/storage/malware-scanner.ts";
import { resolveAIProvider } from "../src/server/ai/resolve-provider.ts";

const once = process.argv.includes("--once");
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());
try {
  const config = { url: process.env.SUPABASE_URL ?? "", secretKey: process.env.SUPABASE_SECRET_KEY ?? "" };
  const gateway = createSupabaseEvidenceWorkerGateway(config);
  const aiDatabase = createSupabaseAiWorkerGateway(config);
  const scanner = resolveMalwareScanner();
  const aiProvider = resolveAIProvider();
  const pollMs = Number(process.env.WORKPULSE_WORKER_POLL_INTERVAL_MS ?? 5000);
  if (!Number.isInteger(pollMs) || pollMs < 250 || pollMs > 60_000) throw new Error("WORKER_CONFIG_INVALID");
  do {
    // Evidence and AI passes are isolated: a failing dependency in one never stops the other.
    const evidence = await runEvidenceWorkerOnce({ ...gateway, scanner }).catch(() => null);
    const ai = await runAiWorkerOnce({ database: aiDatabase, provider: aiProvider }).catch(() => null);
    const worked = evidence === null || ai === null
      || evidence.scanJobsClaimed || evidence.cleanupJobsClaimed || evidence.expiredReservations || evidence.orphanReceiptsQueued
      || ai.aiJobsClaimed || ai.aiExpiredLeases;
    if (once || worked) {
      process.stdout.write(JSON.stringify({
        service: "workpulse-worker",
        ...(evidence ?? { evidenceWorker: "unavailable" }),
        ...(ai ?? { aiWorker: "unavailable" }),
      }) + "\n");
    }
    if (once && (evidence === null || ai === null)) {
      process.stderr.write("WORKER_UNAVAILABLE\n");
      process.exitCode = 1;
    }
    if (once || controller.signal.aborted) break;
    await delay(pollMs, undefined, { signal: controller.signal }).catch(() => undefined);
  } while (!controller.signal.aborted);
} catch {
  process.stderr.write("WORKER_UNAVAILABLE\n");
  process.exitCode = 1;
}
