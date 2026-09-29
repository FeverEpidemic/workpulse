import { AI_ERROR_CODES, AI_MAX_ATTEMPTS, AI_PROVIDER_TIMEOUT_MS, type AiErrorCode } from "../src/domain/ai/contracts.ts";
import { validateDetectResult, type DetectResult } from "../src/domain/ai/detect-result.ts";
import { buildDetectInput, type DetectSource } from "../src/domain/ai/minimize.ts";
import { IMPORT_MAX_TEXT_CHARS } from "../src/domain/import/contracts.ts";
import { validateImportResult, type ImportSummary, type StagedItem } from "../src/domain/import/extract-result.ts";
import type { AIProvider, AIProviderResult } from "../src/server/ai/provider.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AiJobClaim = {
  id: string;
  user_id: string;
  kind: string;
  input_revision: number;
  attempt_count: number;
  attempt_token: string;
};

export type AiJobSource = DetectSource & { input_revision: number };

/** Service-role operations; all state transitions are guarded in PostgreSQL. */
export interface AiWorkerDatabase {
  expireAiJobLeases(): Promise<number>;
  claimAiJobs(limit: number): Promise<AiJobClaim[]>;
  getAiJobInput(jobId: string, attemptToken: string): Promise<AiJobSource | null>;
  completeAiJob(jobId: string, attemptToken: string, result: DetectResult): Promise<string>;
  failAiJob(jobId: string, attemptToken: string, errorCode: AiErrorCode): Promise<boolean>;
  /** T15: extracted CV text for a live import lease, or null (the database already failed it). */
  getImportAiJobInput(jobId: string, attemptToken: string): Promise<string | null>;
  completeImportAiJob(jobId: string, attemptToken: string, summary: ImportSummary, items: StagedItem[]): Promise<string>;
}

/** Counts and stable codes only; never source text, provider output or credentials. */
export type AiWorkerSummary = {
  aiExpiredLeases: number;
  aiJobsClaimed: number;
  aiSucceeded: number;
  aiFailed: Partial<Record<string, number>>;
  aiStale: number;
  aiSkipped: number;
};

export type AiWorkerOptions = {
  database: AiWorkerDatabase;
  provider: AIProvider;
  claimLimit?: number;
  providerTimeoutMs?: number;
};

function isValidClaim(job: AiJobClaim): boolean {
  return UUID_PATTERN.test(job.id)
    && UUID_PATTERN.test(job.attempt_token)
    && (job.kind === "detect" || job.kind === "refine" || job.kind === "import")
    && Number.isInteger(job.input_revision) && job.input_revision > 0
    && Number.isInteger(job.attempt_count) && job.attempt_count >= 1 && job.attempt_count <= AI_MAX_ATTEMPTS;
}

function countFailure(summary: AiWorkerSummary, code: string): void {
  summary.aiFailed[code] = (summary.aiFailed[code] ?? 0) + 1;
}

async function callProvider(provider: AIProvider, source: AiJobSource, timeoutMs: number, jobKind: "detect" | "refine") {
  const input = buildDetectInput(source);
  let result: AIProviderResult;
  try {
    result = await provider.detect(input, AbortSignal.timeout(timeoutMs), jobKind);
  } catch {
    result = { status: "error", code: "AI_PROVIDER_UNAVAILABLE" };
  }
  return { input, result };
}

async function fail(database: AiWorkerDatabase, job: AiJobClaim, code: AiErrorCode, summary: AiWorkerSummary) {
  if (await database.failAiJob(job.id, job.attempt_token, code)) countFailure(summary, code);
  else summary.aiStale += 1;
}

function recordOutcome(summary: AiWorkerSummary, outcome: string): void {
  if (outcome === "succeeded") summary.aiSucceeded += 1;
  else if (outcome === "invalid") countFailure(summary, "AI_OUTPUT_INVALID");
  else if (outcome.startsWith("failed:") && (AI_ERROR_CODES as readonly string[]).includes(outcome.slice(7))) {
    countFailure(summary, outcome.slice(7));
  } else summary.aiStale += 1;
}

/** T15 CV extraction: only the extracted text is sent; candidates are grounded before staging. */
async function processImportJob(options: AiWorkerOptions, job: AiJobClaim, summary: AiWorkerSummary): Promise<void> {
  const { database, provider } = options;
  const text = await database.getImportAiJobInput(job.id, job.attempt_token);
  if (text === null || text === "" || text.length > IMPORT_MAX_TEXT_CHARS) {
    summary.aiSkipped += 1;
    return;
  }
  let result: AIProviderResult;
  try {
    result = await provider.extractImport({ text }, AbortSignal.timeout(options.providerTimeoutMs ?? AI_PROVIDER_TIMEOUT_MS));
  } catch {
    result = { status: "error", code: "AI_PROVIDER_UNAVAILABLE" };
  }
  if (result.status === "error") {
    await fail(database, job, result.code, summary);
    return;
  }
  const validation = validateImportResult(result.output, text);
  if (!validation.ok) {
    await fail(database, job, "AI_OUTPUT_INVALID", summary);
    return;
  }
  recordOutcome(summary, await database.completeImportAiJob(job.id, job.attempt_token, validation.summary, validation.items));
}

async function processJob(options: AiWorkerOptions, job: AiJobClaim, summary: AiWorkerSummary): Promise<void> {
  const { database, provider } = options;
  if (!isValidClaim(job)) {
    summary.aiStale += 1;
    return;
  }
  if (job.kind === "import") {
    await processImportJob(options, job, summary);
    return;
  }

  const source = await database.getAiJobInput(job.id, job.attempt_token);
  if (!source) {
    // The database already failed the job (stale input, consent, deleting account) or the lease moved on.
    summary.aiSkipped += 1;
    return;
  }

  const jobKind = job.kind as "detect" | "refine";
  const { input, result } = await callProvider(provider, source, options.providerTimeoutMs ?? AI_PROVIDER_TIMEOUT_MS, jobKind);
  if (result.status === "error") {
    await fail(database, job, result.code, summary);
    return;
  }

  const validation = validateDetectResult(result.output, input, { kind: jobKind });
  if (!validation.ok) {
    await fail(database, job, "AI_OUTPUT_INVALID", summary);
    return;
  }

  recordOutcome(summary, await database.completeAiJob(job.id, job.attempt_token, validation.result));
}

/** One polling pass: expire leases, claim, fetch minimized input, call provider, record result. */
export async function runAiWorkerOnce(options: AiWorkerOptions): Promise<AiWorkerSummary> {
  const summary: AiWorkerSummary = {
    aiExpiredLeases: 0,
    aiJobsClaimed: 0,
    aiSucceeded: 0,
    aiFailed: {},
    aiStale: 0,
    aiSkipped: 0,
  };
  summary.aiExpiredLeases = await options.database.expireAiJobLeases();
  const jobs = await options.database.claimAiJobs(options.claimLimit ?? 1);
  summary.aiJobsClaimed = jobs.length;
  for (const job of jobs) await processJob(options, job, summary);
  return summary;
}
