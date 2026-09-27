import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { validateDetectResult } from "@/domain/ai/detect-result";
import { buildDetectInput } from "@/domain/ai/minimize";
import { createAiJobService } from "@/features/ai/ai-job-service";
import { createAiConsentService } from "@/features/ai/consent-service";
import { createActivityService } from "@/features/activity/activity-service";
import { resolveAIProvider } from "@/server/ai/resolve-provider";
import { getSupabaseAdminConfig, getSupabasePublicConfig } from "@/server/supabase/config";
import type { Database } from "@/server/supabase/database.types";

const execFileAsync = promisify(execFile);
const LIVE = process.env.WORKPULSE_AI_LIVE === "1";

// Synthetic fixtures only; never user data.
const FIXTURES = [
  { locale: "en", raw_text: "Led migration of 3 reports to the new pipeline; cut weekly prep from 5 to 2 hours." },
  { locale: "id", raw_text: "Memimpin migrasi 3 laporan ke pipeline baru; waktu persiapan mingguan turun dari 5 menjadi 2 jam." },
] as const;

type Receipt = {
  label: string;
  status: string;
  model?: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  potential?: boolean;
  metricCount?: number;
  questionCount?: number;
};

const receipts: Receipt[] = [];

function loadAiEnv(): string {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  if (existsSync(".env.ai.local")) process.loadEnvFile(".env.ai.local");
  const key = process.env.WORKPULSE_OPENAI_API_KEY?.trim() ?? "";
  if (!key || !process.env.WORKPULSE_AI_MODEL?.trim()) {
    throw new Error("Set WORKPULSE_OPENAI_API_KEY and WORKPULSE_AI_MODEL in .env.ai.local for the live smoke.");
  }
  return key;
}

describe.skipIf(!LIVE)("T13 live OpenAI smoke (synthetic fixtures)", () => {
  let key = "";
  let admin: SupabaseClient<Database> | null = null;
  let userId = "";

  beforeAll(() => {
    key = loadAiEnv();
  });

  afterAll(async () => {
    if (admin && userId) await admin.auth.admin.deleteUser(userId);
    mkdirSync("test-results", { recursive: true });
    writeFileSync("test-results/t13-live-smoke.json", JSON.stringify({ at: new Date().toISOString(), receipts }, null, 2));
    // Numbers and codes only: no key, headers, prompt or fixture output.
    console.log("T13_LIVE_SMOKE", JSON.stringify(receipts));
  });

  it.each(FIXTURES)("returns schema-valid, grounded detect.v1 output ($locale)", async ({ locale, raw_text }) => {
    const provider = resolveAIProvider({ mode: "openai" });
    expect(provider.kind).toBe("openai");
    const input = buildDetectInput({ raw_text, role: null, scope: null, outcome: null, locale });
    const started = performance.now();
    const result = await provider.detect(input, AbortSignal.timeout(90_000));
    const latencyMs = Math.round(performance.now() - started);
    if (result.status === "error") {
      receipts.push({ label: `adapter-${locale}`, status: result.code, latencyMs });
      throw new Error(`Live provider returned ${result.code}`);
    }
    const validation = validateDetectResult(result.output, input);
    receipts.push({
      label: `adapter-${locale}`,
      status: validation.ok ? "valid" : "AI_OUTPUT_INVALID",
      model: result.model,
      latencyMs,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      potential: validation.ok ? validation.result.potential : undefined,
      metricCount: validation.ok ? validation.result.suggestion?.metrics.length ?? 0 : undefined,
      questionCount: validation.ok ? validation.result.questions.length : undefined,
    });
    expect(validation.ok).toBe(true);
  });

  it("completes one durable job end to end through `node workers/run.ts --once`", async () => {
    const config = getSupabaseAdminConfig();
    const pub = getSupabasePublicConfig();
    if (!config || !pub) throw new Error("Local Supabase environment required");
    admin = createClient<Database>(config.url, config.secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const email = `t13-live-${randomUUID()}@workpulse.test`;
    const password = randomBytes(18).toString("base64url") + "Aa1!";
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error("live fixture user failed");
    userId = created.data.user.id;
    const owner = createClient<Database>(pub.url, pub.publishableKey, { auth: { autoRefreshToken: false, persistSession: false } });
    if ((await owner.auth.signInWithPassword({ email, password })).error) throw new Error("live fixture sign-in failed");

    const { data: profile } = await owner.from("profiles").select("revision").eq("id", userId).single();
    await createAiConsentService(owner).setConsent({ expectedRevision: profile!.revision, consented: true });
    const activity = await createActivityService(owner).createActivity({
      operationKey: randomUUID(), captureMode: "note", rawText: FIXTURES[0].raw_text, occurredOn: "2026-09-27",
      role: null, scope: null, outcome: null, experienceId: null, projectId: null,
    });
    const receipt = await createAiJobService(owner).requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 });

    const started = performance.now();
    const { stdout, stderr } = await execFileAsync(process.execPath, ["--env-file-if-exists=.env.ai.local", "workers/run.ts", "--once"], {
      env: { ...process.env, SUPABASE_URL: config.url, SUPABASE_SECRET_KEY: config.secretKey, WORKPULSE_AI_MODE: "openai", WORKPULSE_SCANNER_MODE: "unavailable" },
      timeout: 150_000,
    });
    const latencyMs = Math.round(performance.now() - started);
    const output = `${stdout}\n${stderr}`;
    expect(output).not.toContain(key);
    expect(output).not.toContain("Led migration");

    const { data: job } = await admin.from("ai_jobs").select("status, error_code, result, attempt_count").eq("id", receipt.jobId).single();
    receipts.push({ label: "worker-job", status: job?.status === "succeeded" ? "succeeded" : String(job?.error_code), latencyMs });
    expect(job?.status).toBe("succeeded");
    const input = buildDetectInput({ raw_text: FIXTURES[0].raw_text, role: null, scope: null, outcome: null, locale: "en" });
    expect(validateDetectResult(job?.result, input).ok).toBe(true);
    const { data: state } = await owner.from("activities").select("analysis_state").eq("id", activity.activityId).single();
    expect(state?.analysis_state).toBe("done");
    await owner.auth.signOut({ scope: "local" });
  });
});

describe.skipIf(LIVE)("T13 live OpenAI smoke", () => {
  it("is skipped unless WORKPULSE_AI_LIVE=1 (requires .env.ai.local and explicit approval)", () => {
    expect(LIVE).toBe(false);
  });
});
