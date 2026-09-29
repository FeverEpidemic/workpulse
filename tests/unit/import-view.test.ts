import { describe, expect, it } from "vitest";

import { toImportView, type ImportBatchRow } from "@/domain/import/import-view";

const now = new Date("2026-09-29T10:00:00Z");

function batch(overrides: Partial<ImportBatchRow> = {}): ImportBatchRow {
  return {
    id: "8f14e45f-ea5e-4a0b-9c2b-000000000001", filename: "cv.pdf", status: "queued", stage: "screening",
    error_code: null, retry_count: 0, page_count: null, expires_at: null, purged_at: null,
    created_at: "2026-09-29T09:00:00Z", revision: 3, ...overrides,
  };
}

describe("T15 S02 import view model", () => {
  it("shows the chooser without a batch", () => {
    expect(toImportView({ batch: null, consent: false })).toMatchObject({ state: "choose", polling: false, canCancel: false });
  });

  it("maps each saved state to an honest progress state that keeps polling", () => {
    const cases: Array<[Partial<ImportBatchRow>, string]> = [
      [{ status: "queued", stage: "uploading" }, "uploading"],
      [{ status: "queued", stage: "screening" }, "waiting"],
      [{ status: "running", stage: "screening" }, "screening"],
      [{ status: "running", stage: "parsing" }, "parsing"],
      [{ status: "running", stage: "extracting" }, "extracting"],
    ];
    for (const [row, state] of cases) {
      expect(toImportView({ batch: batch(row), consent: true, now })).toMatchObject({ state, polling: true, canCancel: true, canRetry: false });
    }
  });

  it("separates review with candidates from an empty extraction and stops polling", () => {
    const ready = toImportView({ batch: batch({ status: "review", stage: "done", page_count: 2 }), counts: { experience: 2, skill: 3 }, consent: true, now });
    expect(ready).toMatchObject({ state: "review_ready", total: 5, polling: false, canCancel: true });
    expect(ready.counts).toMatchObject({ experience: 2, skill: 3, education: 0 });
    expect(toImportView({ batch: batch({ status: "review", stage: "done", page_count: 1 }), consent: true, now }).state).toBe("review_empty");
  });

  it("never offers retry for permanent file failures", () => {
    for (const code of ["ENCRYPTED_FILE", "SCANNED_PDF", "CORRUPT_FILE", "TOO_MANY_PAGES", "MALWARE_DETECTED", "UNSUPPORTED_FORMAT"]) {
      const view = toImportView({ batch: batch({ status: "failed", error_code: code, expires_at: "2026-09-29T09:30:00Z" }), consent: true, now });
      expect(view).toMatchObject({ state: "failed_permanent", canRetry: false, errorCode: code, polling: false, canCancel: false });
    }
    expect(toImportView({ batch: batch({ status: "failed", stage: "uploading", error_code: "UPLOAD_INCOMPLETE" }), consent: true, now }).state)
      .toBe("failed_permanent");
  });

  it("offers retry for transient failures and explains why it is blocked", () => {
    const failed = { status: "failed" as const, stage: "extracting" as const, error_code: "AI_UNAVAILABLE", expires_at: "2026-09-30T08:00:00Z" };
    expect(toImportView({ batch: batch(failed), consent: true, now })).toMatchObject({ state: "failed_retriable", canRetry: true, retryBlockReason: null });
    expect(toImportView({ batch: batch({ ...failed, retry_count: 3 }), consent: true, now })).toMatchObject({ canRetry: false, retryBlockReason: "exhausted" });
    expect(toImportView({ batch: batch({ ...failed, expires_at: "2026-09-29T09:59:00Z" }), consent: true, now })).toMatchObject({ canRetry: false, retryBlockReason: "expired" });
    expect(toImportView({ batch: batch({ ...failed, purged_at: "2026-09-29T09:59:00Z" }), consent: true, now })).toMatchObject({ retryBlockReason: "expired" });
    expect(toImportView({ batch: batch(failed), consent: false, now })).toMatchObject({ canRetry: false, retryBlockReason: "consent" });
  });

  it("marks cancelled and committed batches as final and carries the duplicate warning", () => {
    expect(toImportView({ batch: batch({ status: "cancelled" }), consent: true, now })).toMatchObject({ state: "cancelled", canCancel: false, polling: false });
    const duplicate = { createdAt: "2026-09-20T09:00:00Z", status: "committed" };
    expect(toImportView({ batch: batch(), consent: true, duplicate, now }).duplicate).toEqual(duplicate);
  });
});
