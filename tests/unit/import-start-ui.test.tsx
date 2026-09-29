import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/import/actions", () => ({ cancelImportAction: vi.fn(), retryImportAction: vi.fn() }));
vi.mock("@/features/ai/actions", () => ({ setAiConsentAction: vi.fn() }));

import { toImportView, type ImportBatchRow } from "@/domain/import/import-view";
import { ImportStart, importFailureKey } from "@/features/import/import-start";

const consent = { granted: true, profileRevision: 2 };
const now = new Date("2026-09-29T10:00:00Z");

function batch(overrides: Partial<ImportBatchRow> = {}): ImportBatchRow {
  return {
    id: "8f14e45f-ea5e-4a0b-9c2b-000000000001", filename: "cv.pdf", status: "queued", stage: "screening",
    error_code: null, retry_count: 0, page_count: null, expires_at: null, purged_at: null,
    created_at: "2026-09-29T09:00:00Z", revision: 3, ...overrides,
  };
}

function render(row: ImportBatchRow | null, extra: Partial<Parameters<typeof toImportView>[0]> = {}, locale: "en" | "id" = "en") {
  const view = toImportView({ batch: row, consent: true, now, ...extra });
  return renderToStaticMarkup(<ImportStart locale={locale} initialView={view} consent={consent} />);
}

describe("T15 S02 import screen", () => {
  it("shows constraints, disclosure, a keyboard-reachable drop area and the manual path before upload", () => {
    const html = render(null);
    expect(html).toContain("PDF or DOCX, up to 10 MiB and 20 pages");
    expect(html).toContain("How your CV is processed");
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="CV file. Press Enter or Space to choose a file."');
    expect(html).toContain('accept=".pdf,.docx,application/pdf,');
    expect(html).toContain('href="/settings/profile?mode=onboarding"');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Upload and extract/);
  });

  it("reports saved progress honestly without claiming results", () => {
    for (const [row, text] of [
      [batch({ status: "queued", stage: "screening" }), "Waiting to start"],
      [batch({ status: "running", stage: "screening" }), "Checking file"],
      [batch({ status: "running", stage: "parsing" }), "Reading document"],
      [batch({ status: "running", stage: "extracting" }), "Extracting career data"],
    ] as const) {
      const html = render(row);
      expect(html).toContain(`role="status">${text}`);
      expect(html).toContain("You can leave this page");
      expect(html).toContain("Cancel import");
      expect(html).not.toContain("Extraction finished");
      expect(html).not.toContain("Retry");
    }
  });

  it("offers another file and manual entry, never retry, for permanent failures", () => {
    const html = render(batch({ status: "failed", error_code: "ENCRYPTED_FILE" }));
    expect(html).toContain("This file could not be imported");
    expect(html).toContain("The file is password protected.");
    expect(html).toContain("Try another file");
    expect(html).toContain("Start manually");
    expect(html).not.toContain(">Retry<");
  });

  it("offers retry for transient failures and disables it with a reason when blocked", () => {
    const ok = render(batch({ status: "failed", stage: "extracting", error_code: "AI_UNAVAILABLE", expires_at: "2026-09-30T00:00:00Z" }));
    expect(ok).toContain("Extraction did not finish");
    expect(ok).toContain("The AI service could not extract data from this file right now.");
    expect(ok).toMatch(/<button[^>]*>Retry<\/button>/);
    expect(ok).not.toMatch(/<button[^>]*disabled[^>]*>Retry/);
    expect(ok).toContain("Start manually");
    const exhausted = render(batch({ status: "failed", stage: "extracting", error_code: "AI_UNAVAILABLE", retry_count: 3, expires_at: "2026-09-30T00:00:00Z" }));
    expect(exhausted).toMatch(/<button[^>]*disabled[^>]*>Retry/);
    expect(exhausted).toContain("The retry limit was reached");
  });

  it("shows candidate counts without a review link, and the manual path for an empty extraction", () => {
    const ready = render(batch({ status: "review", stage: "done", page_count: 2 }), { counts: { experience: 2, skill: 3 } });
    expect(ready).toContain("Extraction finished");
    expect(ready).toContain("We found 5 candidate records");
    expect(ready).toContain("<dt>Experience</dt><dd>2</dd>");
    expect(ready).not.toContain("/imports/");
    const empty = render(batch({ status: "review", stage: "done", page_count: 1 }));
    expect(empty).toContain("No career data found");
    expect(empty).toMatch(/class="button-primary" href="\/settings\/profile\?mode=onboarding"/);
  });

  it("shows the non-blocking duplicate warning and Indonesian copy", () => {
    const html = render(batch(), { duplicate: { createdAt: "2026-09-20T09:00:00Z", status: "committed" } }, "id");
    expect(html).toContain("Anda sudah pernah mengimpor file dengan isi yang sama");
    expect(html).toContain("Menunggu dimulai");
    expect(html).toContain("Batalkan impor");
  });

  it("uses no gradient or sparkle styling", () => {
    const html = render(null);
    expect(html).not.toMatch(/gradient|sparkle/i);
  });

  it("maps failure codes to specific messages with safe fallbacks", () => {
    expect(importFailureKey("SCANNED_PDF")).toBe("import.failed.SCANNED_PDF");
    expect(importFailureKey("AI_RATE_LIMITED")).toBe("import.failed.AI");
    expect(importFailureKey("CONSENT_WITHDRAWN")).toBe("import.failed.CONSENT_REQUIRED");
    expect(importFailureKey("SOMETHING_NEW")).toBe("import.failed.GENERIC");
    expect(importFailureKey(null)).toBe("import.failed.GENERIC");
  });
});
