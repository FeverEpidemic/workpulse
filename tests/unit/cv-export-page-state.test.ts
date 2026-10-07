import { describe, expect, it } from "vitest";

import { CV_EXPORT_BLOCKER_CODES, CV_EXPORT_ERROR_CODES, cvExportRowSchema, type CvExportRow } from "@/domain/cv/contracts";
import { isPermanentExportError } from "@/domain/cv/export";
import { sanitizeReturnTo } from "@/domain/routes/safe-return";
import {
  EXPORT_HISTORY_LIMIT,
  becameTerminal,
  blockerMessageKey,
  classifyExportResult,
  clampPage,
  failureMessageKey,
  formatExportTime,
  isActiveExport,
  mergeExportRow,
  parseStatusResponse,
  pollingPlan,
  stepPage,
} from "@/features/cv/cv-export-page-state";
import { previewLinkState } from "@/features/cv/cv-builder-state";
import { t } from "@/i18n/messages";
import type { ActionState } from "@/server/action-result";

import { uuid } from "./cv-fixtures";

const EXPORT = uuid(50);
const ITEM = uuid(9);

function row(over: Partial<CvExportRow> = {}): CvExportRow {
  return cvExportRowSchema.parse({
    id: EXPORT, cv_id: uuid(60), cv_revision: 3, status: "succeeded", error_code: null, attempt_count: 1, page_count: 2, byte_size: 2048,
    started_at: "2026-10-07T01:00:00.000Z", finished_at: "2026-10-07T01:00:05.000Z", expires_at: "2026-10-08T01:00:05.000Z", purged_at: null,
    created_at: "2026-10-07T01:00:00.000Z", updated_at: "2026-10-07T01:00:05.000Z", revision: 2, ...over,
  });
}
const queued = (over: Partial<CvExportRow> = {}) => row({
  status: "queued", attempt_count: 0, page_count: null, byte_size: null, started_at: null, finished_at: null, expires_at: null, ...over,
});
const running = (over: Partial<CvExportRow> = {}) => queued({ status: "running", attempt_count: 1, started_at: "2026-10-07T01:00:01.000Z", ...over });

const success = (data: unknown): ActionState => ({ status: "success", correlationId: uuid(70), data });
const failure = (code: "VALIDATION" | "UNAUTHENTICATED" | "CONFLICT" | "NOT_FOUND" | "UNAVAILABLE", messageKey: Parameters<typeof t>[1], latestRecord?: Record<string, unknown>): ActionState => ({
  status: "error", error: { code, messageKey, correlationId: uuid(71), ...(latestRecord ? { latestRecord } : {}) },
});

describe("T22 S14 client state: action results", () => {
  it("reads a request receipt as a started export, keeping the reuse flag", () => {
    expect(classifyExportResult(success({ exportId: EXPORT, status: "queued", cvRevision: 3, reused: false }))).toEqual({ kind: "started", exportId: EXPORT, status: "queued", reused: false });
    expect(classifyExportResult(success({ exportId: EXPORT, status: "succeeded", cvRevision: 3, reused: true }))).toEqual({ kind: "started", exportId: EXPORT, status: "succeeded", reused: true });
  });

  it("reads a retry receipt as a started export", () => {
    expect(classifyExportResult(success({ exportId: EXPORT, status: "queued", attemptCount: 2 }))).toEqual({ kind: "started", exportId: EXPORT, status: "queued", reused: false });
  });

  it("reads a download receipt as the URL to use at once", () => {
    expect(classifyExportResult(success({ url: "http://127.0.0.1:54321/storage/v1/object/sign/x?token=t", expiresInSeconds: 300 }))).toEqual({
      kind: "download", url: "http://127.0.0.1:54321/storage/v1/object/sign/x?token=t",
    });
    expect(classifyExportResult(success({ url: "https://storage.example/signed?token=t", expiresInSeconds: 300 })).kind).toBe("download");
  });

  it("refuses a URL that is not http(s) and any malformed success data", () => {
    for (const data of [
      { url: "javascript:alert(1)", expiresInSeconds: 300 }, { url: "data:text/html,x", expiresInSeconds: 300 }, { url: "file:///etc/passwd", expiresInSeconds: 300 },
      { url: "", expiresInSeconds: 300 }, { exportId: "nope", status: "queued", cvRevision: 3, reused: false }, { exportId: EXPORT, status: "weird", cvRevision: 3, reused: false },
      null, undefined, "text", [], {},
    ]) {
      expect(classifyExportResult(success(data)), JSON.stringify(data)).toMatchObject({ kind: "failed", messageKey: "error.unavailable" });
    }
  });

  it("recognises a stale revision (the conflict that is not about an export) without retrying", () => {
    expect(classifyExportResult(failure("CONFLICT", "error.conflict"))).toEqual({ kind: "stale" });
  });

  it("recognises an export already in progress", () => {
    expect(classifyExportResult(failure("CONFLICT", "cv.export.error.inProgress"))).toEqual({ kind: "inProgress" });
  });

  it("takes the blockers of a blocked request from the latest record and drops anything else", () => {
    expect(classifyExportResult(failure("VALIDATION", "cv.export.error.blocked", { blockers: [{ code: "ITEM_DELETED", item_id: ITEM }, { code: "NAME_REQUIRED" }] }))).toEqual({
      kind: "blocked", blockers: [{ code: "ITEM_DELETED", item_id: ITEM }, { code: "NAME_REQUIRED" }],
    });
    for (const blockers of [undefined, "x", [{ code: "ITEM_DELETED", text: "WP-SECRET" }], [{ code: "NOPE" }], [null]]) {
      expect(classifyExportResult(failure("VALIDATION", "cv.export.error.blocked", { blockers })), JSON.stringify(blockers)).toEqual({ kind: "blocked", blockers: [] });
    }
  });

  it.each([
    ["NOT_FOUND", "cv.export.error.notFound"],
    ["CONFLICT", "cv.export.error.expired"],
    ["CONFLICT", "cv.export.error.notRetryable"],
    ["CONFLICT", "cv.export.error.notReady"],
  ] as const)("treats %s / %s as an export that is gone or changed (reload and show the reason)", (code, messageKey) => {
    expect(classifyExportResult(failure(code, messageKey))).toEqual({ kind: "gone", messageKey });
  });

  it("sends a signed-out answer back to the server redirect", () => {
    expect(classifyExportResult(failure("UNAUTHENTICATED", "auth.signInRequired"))).toEqual({ kind: "signedOut" });
  });

  it("reports anything else with its message key and correlation id", () => {
    expect(classifyExportResult(failure("UNAVAILABLE", "error.unavailable"))).toEqual({ kind: "failed", messageKey: "error.unavailable", correlationId: uuid(71) });
    expect(classifyExportResult(failure("VALIDATION", "error.validation"))).toMatchObject({ kind: "failed", messageKey: "error.validation" });
    expect(classifyExportResult({ status: "idle" })).toMatchObject({ kind: "failed", messageKey: "error.unavailable" });
  });
});

describe("T22 S14 client state: polling", () => {
  it("treats queued and running as active", () => {
    expect(isActiveExport(queued())).toBe(true);
    expect(isActiveExport(running())).toBe(true);
    expect(isActiveExport(row())).toBe(false);
    expect(isActiveExport(row({ status: "failed", error_code: "RENDERER_TIMEOUT", expires_at: null }))).toBe(false);
    expect(isActiveExport(null)).toBe(false);
  });

  it("follows the staged delays and then repeats the last one", () => {
    const delays: number[] = [];
    let index = 0;
    for (let step = 0; step < 9; step += 1) {
      const plan = pollingPlan({ activeId: EXPORT, hidden: false, pollIndex: index })!;
      delays.push(plan.delay);
      index = plan.nextIndex;
    }
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000, 30_000]);
  });

  it("stops when nothing is active or the tab is hidden, and copes with a bad index", () => {
    expect(pollingPlan({ activeId: null, hidden: false, pollIndex: 0 })).toBeNull();
    expect(pollingPlan({ activeId: EXPORT, hidden: true, pollIndex: 0 })).toBeNull();
    expect(pollingPlan({ activeId: EXPORT, hidden: false, pollIndex: -4 })).toEqual({ delay: 1_000, nextIndex: 1 });
    expect(pollingPlan({ activeId: EXPORT, hidden: false, pollIndex: Number.NaN })).toEqual({ delay: 1_000, nextIndex: 1 });
    expect(pollingPlan({ activeId: EXPORT, hidden: false, pollIndex: 1e9 })).toEqual({ delay: 30_000, nextIndex: 5 });
  });

  it("notices the moment an active export becomes terminal", () => {
    expect(becameTerminal(queued(), row())).toBe(true);
    expect(becameTerminal(running(), row({ status: "failed", error_code: "EXPORT_TIMEOUT", expires_at: null }))).toBe(true);
    expect(becameTerminal(queued(), running())).toBe(false);
    expect(becameTerminal(row(), row())).toBe(false);
    expect(becameTerminal(null, row())).toBe(false);
  });

  it("parses the status route body and refuses private columns or a missing expired flag", () => {
    const body = { ...row(), expired: false };
    expect(parseStatusResponse(body)).toEqual({ row: row(), expired: false });
    expect(parseStatusResponse({ ...body, expired: true })?.expired).toBe(true);
    for (const bad of [{ ...body, object_key: "x/export/y" }, { ...body, snapshot: {} }, { ...row() }, { ...body, expired: "no" }, null, [], "x", { code: "EXPORT_NOT_FOUND", message: "x", correlationId: "y" }]) {
      expect(parseStatusResponse(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("T22 S14 client state: the recent exports list", () => {
  const at = (index: number) => `2026-10-07T0${index}:00:00.000Z`;
  const make = (index: number, over: Partial<CvExportRow> = {}) => row({ id: uuid(100 + index), created_at: at(index), ...over });

  it("replaces a row with the same id in place", () => {
    const rows = [make(3), make(2), make(1)];
    const next = mergeExportRow(rows, make(2, { status: "failed", error_code: "RENDERER_TIMEOUT", expires_at: null }));
    expect(next.map((r) => r.id)).toEqual([uuid(103), uuid(102), uuid(101)]);
    expect(next[1]).toMatchObject({ status: "failed", error_code: "RENDERER_TIMEOUT" });
    expect(rows[1]!.status).toBe("succeeded");
  });

  it("puts a new row by its creation time, newest first, and keeps at most five", () => {
    const rows = [make(5), make(4), make(3), make(2), make(1)];
    const next = mergeExportRow(rows, make(6));
    expect(next.map((r) => r.id)).toEqual([uuid(106), uuid(105), uuid(104), uuid(103), uuid(102)]);
    expect(next).toHaveLength(EXPORT_HISTORY_LIMIT);
    expect(EXPORT_HISTORY_LIMIT).toBe(5);
    expect(mergeExportRow([], make(1)).map((r) => r.id)).toEqual([uuid(101)]);
  });
});

describe("T22 S14 client state: PDF pages", () => {
  it("keeps the page inside 1..total", () => {
    expect(clampPage(0, 5)).toBe(1);
    expect(clampPage(3, 5)).toBe(3);
    expect(clampPage(9, 5)).toBe(5);
    expect(clampPage(Number.NaN, 5)).toBe(1);
    expect(clampPage(2.7, 5)).toBe(2);
    expect(clampPage(4, 0)).toBe(1);
  });

  it("steps one page at a time and stops at both ends", () => {
    expect(stepPage(1, 5, -1)).toBe(1);
    expect(stepPage(1, 5, 1)).toBe(2);
    expect(stepPage(5, 5, 1)).toBe(5);
    expect(stepPage(5, 5, -1)).toBe(4);
    expect(stepPage(1, 1, 1)).toBe(1);
  });
});

describe("T22 S14 client state: wording", () => {
  it("has a reason for every failure code a worker may store", () => {
    for (const code of CV_EXPORT_ERROR_CODES) {
      for (const locale of ["en", "id"] as const) {
        const text = t(locale, failureMessageKey(code));
        expect(text.trim(), `${code} ${locale}`).not.toBe("");
        expect(text, `${code} ${locale}`).not.toMatch(/snapshot|token|lease|object|bucket|P0001|CV_EXPORT|EXPORT_/i);
      }
    }
    expect(new Set(CV_EXPORT_ERROR_CODES.map(failureMessageKey)).size).toBe(CV_EXPORT_ERROR_CODES.length);
  });

  it("has a sentence for every blocker code, in both languages", () => {
    for (const code of CV_EXPORT_BLOCKER_CODES) {
      expect(blockerMessageKey(code)).toMatch(/^cv\.export\.blocker\./);
      for (const locale of ["en", "id"] as const) expect(t(locale, blockerMessageKey(code)).trim(), `${code} ${locale}`).not.toBe("");
    }
    expect(new Set(CV_EXPORT_BLOCKER_CODES.map(blockerMessageKey)).size).toBe(CV_EXPORT_BLOCKER_CODES.length);
  });

  it("tells the user a permanent failure needs a change in the CV", () => {
    for (const code of CV_EXPORT_ERROR_CODES.filter((candidate) => isPermanentExportError(candidate))) {
      expect(failureMessageKey(code)).toMatch(/^cv\.exportPage\.failure\./);
    }
  });

  it("shows times in the profile time zone and never throws on a bad zone or date", () => {
    const iso = "2026-10-07T01:00:05.000Z";
    expect(formatExportTime(iso, "en", "Asia/Jakarta")).toMatch(/8:00/);
    expect(formatExportTime(iso, "en", "UTC")).toMatch(/1:00/);
    expect(formatExportTime(iso, "en", "Asia/Jakarta")).toContain("2026");
    expect(formatExportTime(iso, "id", "Asia/Jakarta")).toContain("2026");
    expect(formatExportTime(iso, "en", "Not/AZone")).toContain("2026");
    expect(formatExportTime("garbage", "en", "UTC")).toBe("");
    expect(formatExportTime(null, "en", "UTC")).toBe("");
  });
});

describe("T22 S13 link to S14", () => {
  it("is a link only when everything is saved", () => {
    expect(previewLinkState("saved")).toEqual({ disabled: false, reasonKey: null });
  });

  it("is disabled with the visible reason while changes are unsaved, saving or in conflict", () => {
    for (const status of ["unsaved", "saving", "conflict"] as const) {
      expect(previewLinkState(status)).toEqual({ disabled: true, reasonKey: "cv.builder.previewAndExportDisabled" });
    }
    expect(t("en", "cv.builder.previewAndExportDisabled")).toBe("Save your changes first.");
  });
});

describe("T22 return path for S14", () => {
  it("keeps /cv/preview as a safe returnTo and still rejects anything around it", () => {
    expect(sanitizeReturnTo("/cv/preview")).toBe("/cv/preview");
    expect(sanitizeReturnTo("/cv")).toBe("/cv");
    for (const value of ["/cv/preview?x=1", "/cv/preview/", "/cv/preview/extra", "/cv/previews", "//cv/preview", "/cv/preview#frag", "/cv/../cv/preview", "https://evil.example/cv/preview"]) {
      expect(sanitizeReturnTo(value), value).toBe("/dashboard");
    }
  });
});
