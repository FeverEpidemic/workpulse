import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/import/actions", () => ({ cancelImportAction: vi.fn(), retryImportAction: vi.fn() }));
vi.mock("@/features/ai/actions", () => ({ setAiConsentAction: vi.fn() }));

import { toImportView, type ImportBatchRow } from "@/domain/import/import-view";
import { chooseImportMode, ImportStart, importFailureKey, importUploadHeaders } from "@/features/import/import-start";
import { t } from "@/i18n/messages";

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

  it("shows candidate counts with a review link, and the manual path for an empty extraction", () => {
    const ready = render(batch({ status: "review", stage: "done", page_count: 2 }), { counts: { experience: 2, skill: 3 } });
    expect(ready).toContain("Extraction finished");
    expect(ready).toContain("We found 5 candidate records");
    expect(ready).toContain("<dt>Experience</dt><dd>2</dd>");
    // T17: candidates can be reviewed in S03 (this asserted the absence of a review link before).
    expect(ready).toMatch(/class="button-primary" href="\/imports\/8f14e45f-ea5e-4a0b-9c2b-000000000001\/review">Review candidates/);
    expect(ready).not.toContain("not available yet");
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

  it("shows a saved-import result for a committed batch, with the dashboard as the primary action", () => {
    const html = render(batch({ status: "committed", stage: "done" }));
    expect(html).toContain("Import saved");
    expect(html).toContain("Your selected records were added to your workspace.");
    expect(html).not.toContain("Import cancelled");
    expect(html).not.toContain("Nothing was added");
    expect(html).toMatch(/class="button-primary" href="\/dashboard">Open dashboard/);
    expect(html).not.toContain("Start manually");
  });

  it("sends a returning user's manual path to the profile editor, not onboarding mode", () => {
    const view = toImportView({ batch: null, consent: true, now });
    const html = renderToStaticMarkup(<ImportStart locale="en" initialView={view} consent={consent} onboarded />);
    expect(html).toContain('href="/settings/profile"');
    expect(html).not.toContain("mode=onboarding");
    const first = render(null);
    expect(first).toContain('href="/settings/profile?mode=onboarding"');
  });

  it("uses no gradient or sparkle styling", () => {
    const html = render(null);
    expect(html).not.toMatch(/gradient|sparkle/i);
  });

  it("maps failure codes to specific messages with safe fallbacks", () => {
    expect(importFailureKey("SCANNED_PDF")).toBe("import.failed.SCANNED_PDF");
    expect(importFailureKey("AI_RATE_LIMITED")).toBe("import.failed.AI");
    expect(importFailureKey("CONSENT_REQUIRED")).toBe("import.failed.CONSENT_REQUIRED");
    expect(importFailureKey("CONSENT_WITHDRAWN")).toBe("import.failed.CONSENT_WITHDRAWN");
    expect(importFailureKey("SOMETHING_NEW")).toBe("import.failed.GENERIC");
    expect(importFailureKey(null)).toBe("import.failed.GENERIC");
  });

  // Gate M3 RV1: CONSENT_WITHDRAWN is only recorded after the provider received the text,
  // so the page must not claim the text was not sent.
  it("tells the truth about a consent withdrawn while the text was being processed", () => {
    const failed = { status: "failed", stage: "extracting", error_code: "CONSENT_WITHDRAWN", expires_at: "2026-09-30T00:00:00Z" } as const;
    const en = render(batch(failed), { consent: false });
    expect(en).toContain("AI processing was withdrawn while this file was being processed. The result was discarded and nothing was added.");
    expect(en).not.toContain("was not sent");
    expect(en).toContain("Allow AI processing to retry this import.");
    expect(en).toMatch(/<button[^>]*disabled[^>]*>Retry/);
    const id = render(batch(failed), { consent: false }, "id");
    expect(id).toContain("Pemrosesan AI ditarik saat file ini sedang diproses. Hasilnya dibuang dan tidak ada data yang ditambahkan.");
    expect(id).not.toContain("tidak dikirim");
    const before = render(batch({ ...failed, error_code: "CONSENT_REQUIRED" }), { consent: false });
    expect(before).toContain("AI processing is not allowed, so the text was not sent.");
  });
});

describe("T26 S02 import screen: reading without AI", () => {
  const noConsent = { granted: false, profileRevision: 2 };
  const renderWith = (view: ReturnType<typeof toImportView>, grant: typeof consent, extra: Record<string, unknown> = {}, locale: "en" | "id" = "en") =>
    renderToStaticMarkup(<ImportStart locale={locale} initialView={view} consent={grant} {...extra} />);

  it("explains both paths to a user without consent and offers the neutral choice, not the consent dialog", () => {
    const html = renderWith(toImportView({ batch: null, consent: false, now }), noConsent);
    expect(html).toContain("If you allow AI, your CV text is sent to an external AI provider. If you don&#x27;t, WorkPulse reads it itself using fixed rules.");
    expect(html).toContain("How should we read your CV?");
    expect(html).not.toContain(t("en", "ai.consent.dialogTitle"));
    const id = renderWith(toImportView({ batch: null, consent: false, now }), noConsent, {}, "id");
    expect(id).toContain("Kalau Anda mengizinkan AI, teks CV dikirim ke penyedia AI eksternal.");
  });

  it("keeps the AI disclosure and no mode dialog for a user who already consented", () => {
    const html = renderWith(toImportView({ batch: null, consent: true, now }), consent);
    expect(html).toContain(t("en", "import.disclosure"));
    expect(html).not.toContain("How should we read your CV?");
    expect(html).not.toContain("fixed rules");
  });

  it("keeps the upload open without consent even when the AI import limit is reached", () => {
    const usage = { bucket: "import", dayUsed: 3, dayLimit: 3, monthUsed: 3, monthLimit: 5, limitReason: "daily", resetsAt: "2026-09-30T00:00:00Z" };
    const html = renderWith(toImportView({ batch: null, consent: false, now }), noConsent, { usage, timeZone: "UTC" });
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Upload and extract/);
    expect(html).toContain("Read without AI");
    const consented = renderWith(toImportView({ batch: null, consent: true, now }), consent, { usage, timeZone: "UTC" });
    expect(consented).not.toContain("Upload and extract");
  });

  it("notes a rules result and uses the rules copy for an empty result, only for rules batches", () => {
    const ready = { status: "review" as const, stage: "done" as const, page_count: 1 };
    const rules = render(batch({ ...ready, extraction_mode: "rules" }), { counts: { experience: 1 } });
    expect(rules).toContain("These records were read without AI. Check employers, job titles and dates before you confirm.");
    const ai = render(batch(ready), { counts: { experience: 1 } });
    expect(ai).not.toContain("read without AI");
    const emptyRules = render(batch({ ...ready, extraction_mode: "rules" }));
    expect(emptyRules).toContain("Two-column or table-based CVs often can&#x27;t be read without AI.");
    expect(render(batch(ready))).toContain(t("en", "import.emptyBody"));
  });

  it("names IMPORT_RULES_FAILED without a retry, and lets a rules retry through when the AI limit is reached", () => {
    expect(importFailureKey("IMPORT_RULES_FAILED")).toBe("import.failed.IMPORT_RULES_FAILED");
    const failed = render(batch({ status: "failed", stage: "parsing", error_code: "IMPORT_RULES_FAILED", extraction_mode: "rules" }), { consent: false });
    expect(failed).toContain("We couldn&#x27;t read this CV without AI. Try another file or start manually.");
    expect(failed).not.toContain(">Retry<");
    const usage = { bucket: "import", dayUsed: 3, dayLimit: 3, monthUsed: 3, monthLimit: 5, limitReason: "daily", resetsAt: "2026-09-30T00:00:00Z" };
    const transient = toImportView({ batch: batch({ status: "failed", stage: "screening", error_code: "SCANNER_UNAVAILABLE", extraction_mode: "rules", expires_at: "2026-09-30T00:00:00Z" }), consent: false, now });
    const html = renderWith(transient, noConsent, { usage, timeZone: "UTC" });
    expect(html).toMatch(/<button[^>]*>Retry<\/button>/);
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>Retry/);
  });
});

describe("T26 S02 upload steps", () => {
  it("sends the mode as x-extraction-mode", () => {
    expect(importUploadHeaders("application/pdf", "k", "cv a.pdf", "rules")).toEqual({
      "content-type": "application/pdf", "x-idempotency-key": "k", "x-file-name": "cv%20a.pdf", "x-extraction-mode": "rules",
    });
  });

  it("saves consent before an ai upload, never uploads when that fails, and uploads rules without consent", async () => {
    const calls: string[] = [];
    const steps = (consentError: string | null) => ({
      saveConsent: vi.fn(async () => { calls.push("consent"); return consentError; }),
      upload: vi.fn(async (mode: "ai" | "rules") => { calls.push(`upload:${mode}`); }),
    });
    const ok = steps(null);
    expect(await chooseImportMode("ai", ok)).toBeNull();
    expect(calls).toEqual(["consent", "upload:ai"]);

    calls.length = 0;
    const refused = steps("Could not save.");
    expect(await chooseImportMode("ai", refused)).toBe("Could not save.");
    expect(calls).toEqual(["consent"]);
    expect(refused.upload).not.toHaveBeenCalled();

    calls.length = 0;
    const rules = steps(null);
    expect(await chooseImportMode("rules", rules)).toBeNull();
    expect(calls).toEqual(["upload:rules"]);
    expect(rules.saveConsent).not.toHaveBeenCalled();
  });
});