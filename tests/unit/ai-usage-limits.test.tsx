import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/import/actions", () => ({ cancelImportAction: vi.fn(), retryImportAction: vi.fn() }));
vi.mock("@/features/ai/actions", () => ({ setAiConsentAction: vi.fn() }));

import { parseAiUsageRows, type AiUsageWindow } from "@/domain/ai/usage";
import { toImportView, type ImportBatchRow } from "@/domain/import/import-view";
import { mapAiDatabaseError } from "@/features/ai/ai-errors";
import { formatAiResetTime } from "@/features/ai/ai-limit-notice";
import { mapImportDatabaseError } from "@/features/import/import-errors";
import { ImportStart } from "@/features/import/import-start";

const migration = readFileSync("supabase/migrations/20261018090000_ai_usage_limits.sql", "utf8");

const row = (bucket: string, over: Record<string, unknown> = {}) => ({
  bucket, day_used: 0, day_limit: 20, month_used: 0, month_limit: 200, limit_reason: null, resets_at: null, ...over,
});

describe("decision 0032 AI usage contract", () => {
  it("seeds the approved pilot numbers and the shared daily capacity", () => {
    expect(migration).toContain("('free', 20, 200, 3, 5, true)");
    expect(migration).toContain("values (true, 2000)");
  });

  it("charges every user path that queues a provider attempt, in the job transaction", () => {
    expect(migration).toMatch(/create or replace function internal\.enqueue_ai_job[\s\S]*?charge_ai_usage\(p_user_id, 'analysis'\)/);
    expect(migration).toMatch(/create or replace function public\.retry_ai_job[\s\S]*?charge_ai_usage\(v_user_id, 'analysis'\)/);
    expect(migration).toMatch(/create or replace function public\.begin_import_batch[\s\S]*?charge_ai_usage\(v_user_id, 'import'\)/);
    expect(migration.match(/charge_ai_usage\(v_user_id, 'import'\)/g)).toHaveLength(3);
  });

  it("parses get_ai_usage rows and drops a reset time that has no blocking window", () => {
    const usage = parseAiUsageRows([
      row("analysis", { day_used: 20, limit_reason: "daily", resets_at: "2026-10-19T00:00:00+00:00" }),
      row("import", { day_limit: 3, month_limit: 5, resets_at: "2026-10-19T00:00:00+00:00" }),
    ]);
    expect(usage?.analysis).toEqual({
      dayUsed: 20, dayLimit: 20, monthUsed: 0, monthLimit: 200, limitReason: "daily", resetsAt: "2026-10-19T00:00:00+00:00",
    });
    expect(usage?.import.resetsAt).toBeNull();
  });

  it("treats a missing bucket or an unknown reason as unreadable", () => {
    expect(parseAiUsageRows([row("analysis")])).toBeNull();
    expect(parseAiUsageRows([row("analysis", { limit_reason: "weekly" }), row("import")])).toBeNull();
    expect(parseAiUsageRows(null)).toBeNull();
  });

  it("keeps an unlimited plan as null limits", () => {
    const usage = parseAiUsageRows([row("analysis", { day_limit: null, month_limit: null }), row("import", { day_limit: null })]);
    expect(usage?.analysis.dayLimit).toBeNull();
    expect(usage?.import.dayLimit).toBeNull();
  });

  it("maps the database refusals to stable service codes", () => {
    expect(mapAiDatabaseError({ code: "P0001", message: "AI_QUOTA_EXCEEDED" }).code).toBe("QUOTA_EXCEEDED");
    expect(mapAiDatabaseError({ code: "P0001", message: "AI_CAPACITY_EXCEEDED" }).code).toBe("CAPACITY_EXCEEDED");
    const importError = mapImportDatabaseError({ code: "P0001", message: "AI_QUOTA_EXCEEDED" });
    expect(importError.code).toBe("QUOTA_EXCEEDED");
    expect(importError.status).toBe(429);
    expect(mapImportDatabaseError({ code: "P0001", message: "AI_CAPACITY_EXCEEDED" }).messageKey).toBe("import.error.capacityExceeded");
  });

  it("formats the reset in the profile timezone and falls back to labelled UTC", () => {
    expect(formatAiResetTime("2026-10-19T00:00:00Z", "en", "Asia/Jakarta")).toContain("07:00");
    expect(formatAiResetTime("2026-10-19T00:00:00Z", "en", "Not/AZone")).toContain("UTC");
    expect(formatAiResetTime(null, "en")).toBe("");
  });
});

describe("S02 import under the AI usage limit", () => {
  const consent = { granted: true, profileRevision: 2 };
  const now = new Date("2026-10-18T10:00:00Z");
  const limit: AiUsageWindow = {
    dayUsed: 3, dayLimit: 3, monthUsed: 3, monthLimit: 5, limitReason: "daily", resetsAt: "2026-10-19T00:00:00Z",
  };
  const failed: ImportBatchRow = {
    id: "8f14e45f-ea5e-4a0b-9c2b-000000000001", filename: "cv.pdf", status: "failed", stage: "extracting",
    error_code: "AI_PROVIDER_UNAVAILABLE", retry_count: 0, page_count: 2, expires_at: "2026-10-19T09:00:00Z",
    purged_at: null, created_at: "2026-10-18T09:00:00Z", revision: 3,
  };
  const render = (batch: ImportBatchRow | null, usage: AiUsageWindow | null) => renderToStaticMarkup(
    <ImportStart locale="en" initialView={toImportView({ batch, consent: true, now })} consent={consent} usage={usage} timeZone="Asia/Jakarta" />,
  );

  it("replaces the drop area with the limit and makes manual entry the primary action", () => {
    const html = render(null, limit);
    expect(html).toContain("CV import limit reached");
    expect(html).toContain("You&#x27;ve used today&#x27;s 3 CV imports");
    expect(html).toContain("07:00");
    expect(html).not.toContain("Upload and extract");
    expect(html).toMatch(/class="button-primary" href="\/settings\/profile\?mode=onboarding"/);
  });

  it("hides Retry on a retriable failure while limited", () => {
    const html = render(failed, limit);
    expect(html).toContain("CV import limit reached");
    expect(html).not.toContain(">Retry<");
    expect(html).toContain("Start manually");
  });

  it("keeps the normal chooser when usage is under the limit or unknown", () => {
    expect(render(null, { ...limit, dayUsed: 1, limitReason: null, resetsAt: null })).toContain("Upload and extract");
    expect(render(null, null)).toContain("Upload and extract");
  });
});
