import { setTimeout as delay } from "node:timers/promises";
import { createSupabaseEvidenceWorkerGateway } from "./supabase-evidence-gateway.ts";
import { runEvidenceWorkerOnce } from "./evidence-worker.ts";
import { createSupabaseAiWorkerGateway } from "./supabase-ai-gateway.ts";
import { runAiWorkerOnce } from "./ai-worker.ts";
import { createSupabaseImportWorkerGateway } from "./supabase-import-gateway.ts";
import { runImportWorkerOnce } from "./import-worker.ts";
import { createSupabaseExportWorkerGateway } from "./supabase-export-gateway.ts";
import { runExportWorkerOnce } from "./export-worker.ts";
import { createSupabaseAccountDeletionWorkerGateway } from "./supabase-account-deletion-gateway.ts";
import { runAccountDeletionWorkerOnce } from "./account-deletion-worker.ts";
import { resolveMalwareScanner } from "../src/server/storage/malware-scanner.ts";
import { resolveAIProvider } from "../src/server/ai/resolve-provider.ts";
import { resolveDocxRenderer } from "../src/server/documents/docx-renderer.ts";
import { parseInThread } from "../src/server/documents/parse-in-thread.ts";
import { resolvePdfRenderer } from "../src/server/export/pdf-renderer.ts";

const once = process.argv.includes("--once");
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());
try {
  const config = { url: process.env.SUPABASE_URL ?? "", secretKey: process.env.SUPABASE_SECRET_KEY ?? "" };
  const gateway = createSupabaseEvidenceWorkerGateway(config);
  const aiDatabase = createSupabaseAiWorkerGateway(config);
  const importGateway = createSupabaseImportWorkerGateway(config);
  const exportGateway = createSupabaseExportWorkerGateway(config);
  const accountDeletionGateway = createSupabaseAccountDeletionWorkerGateway(config);
  const scanner = resolveMalwareScanner();
  const aiProvider = resolveAIProvider();
  const renderer = resolveDocxRenderer({
    countPdfPages: async (pdf) => {
      const counted = await parseInThread("pdf-pages", pdf);
      return counted.status === "ok" && counted.pageCount !== null
        ? { status: "ok", pageCount: counted.pageCount }
        : { status: "error", code: "PAGE_COUNT_UNAVAILABLE" };
    },
  });
  const pdfRenderer = resolvePdfRenderer();
  const pollMs = Number(process.env.WORKPULSE_WORKER_POLL_INTERVAL_MS ?? 5000);
  if (!Number.isInteger(pollMs) || pollMs < 250 || pollMs > 60_000) throw new Error("WORKER_CONFIG_INVALID");
  do {
    // Evidence, import, export, account deletion and AI passes are isolated: a failing dependency in one never stops the others.
    const evidence = await runEvidenceWorkerOnce({ ...gateway, scanner }).catch(() => null);
    const imports = await runImportWorkerOnce({ ...importGateway, scanner, renderer, parse: parseInThread }).catch(() => null);
    const exportPass = await runExportWorkerOnce({ ...exportGateway, renderer: pdfRenderer, parse: parseInThread }).catch(() => null);
    const accountDeletion = await runAccountDeletionWorkerOnce(accountDeletionGateway).catch(() => null);
    const ai = await runAiWorkerOnce({ database: aiDatabase, provider: aiProvider }).catch(() => null);
    const worked = evidence === null || imports === null || exportPass === null || accountDeletion === null || ai === null
      || evidence.scanJobsClaimed || evidence.cleanupJobsClaimed || evidence.expiredReservations || evidence.orphanReceiptsQueued
      || imports.importJobsClaimed || imports.importCleanupClaimed || imports.importPurged || imports.importReviewsExpired || imports.importExpiredUploads
      || exportPass.exportJobsClaimed || exportPass.exportCleanupClaimed || exportPass.exportExpired || exportPass.exportSnapshotsRedacted || exportPass.exportOrphansQueued
      || accountDeletion.accountDeletionsClaimed || accountDeletion.accountPurgesVerified || accountDeletion.accountReceiptsPruned
      || ai.aiJobsClaimed || ai.aiExpiredLeases;
    if (once || worked) {
      process.stdout.write(JSON.stringify({
        service: "workpulse-worker",
        ...(evidence ?? { evidenceWorker: "unavailable" }),
        ...(imports ?? { importWorker: "unavailable" }),
        ...(exportPass ?? { exportWorker: "unavailable" }),
        ...(accountDeletion ?? { accountDeletionWorker: "unavailable" }),
        ...(ai ?? { aiWorker: "unavailable" }),
        ...(renderer.kind === "fake" ? { docxRenderer: "explicit-test-fake" } : {}),
        ...(pdfRenderer.kind === "fake" ? { pdfRenderer: "explicit-test-fake" } : {}),
      }) + "\n");
    }
    if (once && (evidence === null || imports === null || exportPass === null || accountDeletion === null || ai === null)) {
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
