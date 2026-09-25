import { setTimeout as delay } from "node:timers/promises";
import { createSupabaseEvidenceWorkerGateway } from "./supabase-evidence-gateway.ts";
import { runEvidenceWorkerOnce } from "./evidence-worker.ts";
import { resolveMalwareScanner } from "../src/server/storage/malware-scanner.ts";

const once = process.argv.includes("--once");
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());
try {
  const gateway = createSupabaseEvidenceWorkerGateway({ url: process.env.SUPABASE_URL ?? "", secretKey: process.env.SUPABASE_SECRET_KEY ?? "" });
  const scanner = resolveMalwareScanner();
  const pollMs = Number(process.env.WORKPULSE_WORKER_POLL_INTERVAL_MS ?? 5000);
  if (!Number.isInteger(pollMs) || pollMs < 250 || pollMs > 60_000) throw new Error("WORKER_CONFIG_INVALID");
  do {
    const summary = await runEvidenceWorkerOnce({ ...gateway, scanner });
    if (once || summary.scanJobsClaimed || summary.cleanupJobsClaimed || summary.expiredReservations || summary.orphanReceiptsQueued) {
      process.stdout.write(JSON.stringify({ service: "workpulse-worker", ...summary }) + "\n");
    }
    if (once || controller.signal.aborted) break;
    await delay(pollMs, undefined, { signal: controller.signal }).catch(() => undefined);
  } while (!controller.signal.aborted);
} catch {
  process.stderr.write("WORKER_UNAVAILABLE\n");
  process.exitCode = 1;
}
