import { describe, expect, it } from "vitest";

import {
  CV_EXPORT_ERROR_CODES,
  cvExportRowSchema,
  type CvExportBlocker,
  type CvExportErrorCode,
  type CvExportReadiness,
  type CvExportRow,
} from "@/domain/cv/contracts";
import { isPermanentExportError } from "@/domain/cv/export";
import {
  EXPORT_POLL_DELAYS,
  blockerLink,
  exportActions,
  exportDownloadName,
  exportStatusView,
  type ExportAction,
} from "@/domain/cv/export-view";

import { uuid } from "./cv-fixtures";

const NOW = new Date("2026-10-07T03:00:00.000Z");
const SAVED = 3;
const ITEM = uuid(9);

function row(over: Partial<CvExportRow> = {}): CvExportRow {
  return cvExportRowSchema.parse({
    id: uuid(50), cv_id: uuid(60), cv_revision: SAVED, status: "succeeded", error_code: null, attempt_count: 1,
    page_count: 2, byte_size: 2048, started_at: "2026-10-07T01:00:00.000Z", finished_at: "2026-10-07T01:00:05.000Z",
    expires_at: "2026-10-08T01:00:05.000Z", purged_at: null, created_at: "2026-10-07T01:00:00.000Z",
    updated_at: "2026-10-07T01:00:05.000Z", revision: 2, ...over,
  });
}
const queued = (over: Partial<CvExportRow> = {}) => row({
  status: "queued", attempt_count: 0, page_count: null, byte_size: null, started_at: null, finished_at: null, expires_at: null, ...over,
});
const running = (over: Partial<CvExportRow> = {}) => row({
  status: "running", attempt_count: 1, page_count: null, byte_size: null, finished_at: null, expires_at: null, ...over,
});
const failed = (code: CvExportErrorCode, attempts: number, over: Partial<CvExportRow> = {}) => row({
  status: "failed", error_code: code, attempt_count: attempts, page_count: null, byte_size: null, expires_at: null, ...over,
});

const READY: CvExportReadiness = { has_cv: true, cv_revision: SAVED, ready: true, blockers: [] };
const BLOCKED: CvExportReadiness = { has_cv: true, cv_revision: SAVED, ready: false, blockers: [{ code: "ITEM_DELETED", item_id: ITEM }] };
const NO_CV: CvExportReadiness = { has_cv: false, cv_revision: null, ready: false, blockers: [{ code: "CV_NOT_FOUND" }] };

const BLOCKED_REASON = "cv.export.error.blocked";
const NO_CV_REASON = "cv.export.blocker.cvNotFound";

const actions = (rowValue: CvExportRow | null, readiness: CvExportReadiness = READY, savedRevision = SAVED) =>
  exportActions({ row: rowValue, savedRevision, readiness, now: NOW });

describe("T22 export status view", () => {
  it("maps each stored status to its state and copy key", () => {
    expect(exportStatusView(queued(), NOW)).toEqual({ state: "queued", messageKey: "cv.export.status.queued" });
    expect(exportStatusView(running(), NOW)).toEqual({ state: "running", messageKey: "cv.export.status.running" });
    expect(exportStatusView(row(), NOW)).toEqual({ state: "succeeded", messageKey: "cv.export.status.succeeded" });
    expect(exportStatusView(failed("RENDERER_UNAVAILABLE", 1), NOW)).toEqual({ state: "failed", messageKey: "cv.export.status.failed" });
  });

  it("shows a succeeded export as expired when its 24 hours passed, it was purged, or its expiry is unreadable", () => {
    const expired = { state: "expired", messageKey: "cv.export.status.expired" };
    expect(exportStatusView(row({ expires_at: "2026-10-07T02:59:59.000Z" }), NOW)).toEqual(expired);
    expect(exportStatusView(row({ expires_at: NOW.toISOString() }), NOW)).toEqual(expired);
    expect(exportStatusView(row({ purged_at: "2026-10-07T02:00:00.000Z" }), NOW)).toEqual(expired);
    expect(exportStatusView(row({ expires_at: null }), NOW)).toEqual(expired);
    expect(exportStatusView(row({ expires_at: "not a date" }), NOW)).toEqual(expired);
    expect(exportStatusView(row({ expires_at: "2026-10-07T03:00:01.000Z" }), NOW).state).toBe("succeeded");
  });

  it("never reports a non-succeeded export as expired", () => {
    expect(exportStatusView(queued({ expires_at: "2020-01-01T00:00:00.000Z" }), NOW).state).toBe("queued");
    expect(exportStatusView(running({ expires_at: "2020-01-01T00:00:00.000Z" }), NOW).state).toBe("running");
    expect(exportStatusView(failed("EXPORT_TIMEOUT", 1, { expires_at: "2020-01-01T00:00:00.000Z" }), NOW).state).toBe("failed");
  });
});

describe("T22 export actions", () => {
  describe("no export yet", () => {
    it("offers Export PDF as the one primary action when the saved CV is ready", () => {
      expect(actions(null)).toEqual({ primary: "export", secondary: [], disabledReason: null });
    });

    it("disables it with the blocker reason when the saved CV is blocked", () => {
      expect(actions(null, BLOCKED)).toEqual({ primary: "export", secondary: [], disabledReason: BLOCKED_REASON });
    });

    it("explains that a CV must exist first when there is none", () => {
      expect(actions(null, NO_CV)).toEqual({ primary: "export", secondary: [], disabledReason: NO_CV_REASON });
    });
  });

  describe("queued and running", () => {
    it.each([["queued", queued()], ["running", running()]] as const)("offers no action while %s, whatever the CV state", (_name, active) => {
      for (const readiness of [READY, BLOCKED, NO_CV]) {
        expect(actions(active, readiness)).toEqual({ primary: null, secondary: [], disabledReason: null });
      }
      expect(actions(active, READY, SAVED + 1)).toEqual({ primary: null, secondary: [], disabledReason: null });
    });
  });

  describe("succeeded", () => {
    it("offers Download PDF for the saved revision, even when the CV is blocked now", () => {
      expect(actions(row())).toEqual({ primary: "download", secondary: [], disabledReason: null });
      expect(actions(row(), BLOCKED)).toEqual({ primary: "download", secondary: [], disabledReason: null });
    });

    it("offers Regenerate for an export of an earlier revision and keeps the earlier PDF as a secondary download", () => {
      expect(actions(row({ cv_revision: SAVED - 1 }))).toEqual({ primary: "regenerate", secondary: ["download"], disabledReason: null });
      expect(actions(row({ cv_revision: SAVED - 1 }), BLOCKED)).toEqual({ primary: "regenerate", secondary: ["download"], disabledReason: BLOCKED_REASON });
      expect(actions(row({ cv_revision: SAVED - 1 }), NO_CV)).toEqual({ primary: "regenerate", secondary: ["download"], disabledReason: NO_CV_REASON });
    });

    it("offers only Regenerate once the file expired or was purged", () => {
      for (const over of [{ expires_at: "2026-10-07T02:00:00.000Z" }, { purged_at: "2026-10-07T02:00:00.000Z" }, { expires_at: null }]) {
        expect(actions(row(over))).toEqual({ primary: "regenerate", secondary: [], disabledReason: null });
        expect(actions(row(over), BLOCKED)).toEqual({ primary: "regenerate", secondary: [], disabledReason: BLOCKED_REASON });
      }
    });

    it("treats an expired export of an earlier revision like an expired one (no download)", () => {
      expect(actions(row({ cv_revision: SAVED - 1, expires_at: "2026-10-07T02:00:00.000Z" }))).toEqual({ primary: "regenerate", secondary: [], disabledReason: null });
    });
  });

  describe("failed", () => {
    const RETRIABLE = CV_EXPORT_ERROR_CODES.filter((code) => !isPermanentExportError(code));
    const PERMANENT = CV_EXPORT_ERROR_CODES.filter((code) => isPermanentExportError(code));

    it("covers the permanent codes and the retriable codes of the contract", () => {
      expect([...PERMANENT].sort()).toEqual(["ACCOUNT_DELETING", "EXPORT_SNAPSHOT_INVALID", "EXPORT_TOO_LONG"]);
      expect(RETRIABLE.length + PERMANENT.length).toBe(CV_EXPORT_ERROR_CODES.length);
    });

    it("offers Retry (same snapshot) for a retriable failure of the saved revision with attempts left", () => {
      for (const code of RETRIABLE) {
        for (const attempts of [1, 2]) {
          for (const readiness of [READY, BLOCKED]) {
            expect(actions(failed(code, attempts), readiness), `${code} #${attempts}`).toEqual({ primary: "retry", secondary: [], disabledReason: null });
          }
        }
      }
    });

    it("offers Regenerate instead after the third attempt", () => {
      for (const code of RETRIABLE) {
        expect(actions(failed(code, 3))).toEqual({ primary: "regenerate", secondary: [], disabledReason: null });
        expect(actions(failed(code, 3), BLOCKED)).toEqual({ primary: "regenerate", secondary: [], disabledReason: BLOCKED_REASON });
      }
    });

    it("offers only Regenerate for a failure of an earlier revision, never Retry (N2)", () => {
      for (const code of CV_EXPORT_ERROR_CODES) {
        for (const attempts of [1, 2, 3]) {
          const result = actions(failed(code, attempts, { cv_revision: SAVED - 1 }));
          expect(result, `${code} #${attempts}`).toEqual({ primary: "regenerate", secondary: [], disabledReason: null });
        }
      }
      expect(actions(failed("RENDERER_TIMEOUT", 1, { cv_revision: SAVED - 1 }), BLOCKED).disabledReason).toBe(BLOCKED_REASON);
    });

    it("sends a permanent failure of the saved revision to the CV builder, with Regenerate as the secondary action", () => {
      for (const code of PERMANENT) {
        for (const attempts of [1, 2, 3]) {
          expect(actions(failed(code, attempts)), `${code} #${attempts}`).toEqual({ primary: "openBuilder", secondary: ["regenerate"], disabledReason: null });
        }
      }
      expect(actions(failed("EXPORT_TOO_LONG", 1), BLOCKED)).toEqual({ primary: "openBuilder", secondary: ["regenerate"], disabledReason: BLOCKED_REASON });
    });
  });

  describe("invariants over the whole matrix", () => {
    const savedRevisions = [SAVED, SAVED + 1];
    const readinesses = [READY, BLOCKED, NO_CV];
    const rows: (CvExportRow | null)[] = [
      null, queued(), running(), row(), row({ cv_revision: SAVED - 1 }), row({ expires_at: "2026-10-07T01:00:00.000Z" }), row({ purged_at: "2026-10-07T01:00:00.000Z" }),
      ...CV_EXPORT_ERROR_CODES.flatMap((code) => [1, 2, 3].flatMap((attempts) => [failed(code, attempts), failed(code, attempts, { cv_revision: SAVED - 1 })])),
    ];

    it("never offers Retry for another revision than the saved one, a permanent code, or a third attempt", () => {
      for (const savedRevision of savedRevisions) {
        for (const readiness of readinesses) {
          for (const candidate of rows) {
            const result = actions(candidate, readiness, savedRevision);
            const all: (ExportAction | null)[] = [result.primary, ...result.secondary];
            if (!all.includes("retry")) continue;
            expect(candidate?.status).toBe("failed");
            expect(candidate?.cv_revision).toBe(savedRevision);
            expect(isPermanentExportError(candidate?.error_code)).toBe(false);
            expect(candidate?.attempt_count).toBeLessThan(3);
          }
        }
      }
    });

    it("offers Download only for a succeeded export that has not expired", () => {
      for (const savedRevision of savedRevisions) {
        for (const readiness of readinesses) {
          for (const candidate of rows) {
            const result = actions(candidate, readiness, savedRevision);
            if (![result.primary, ...result.secondary].includes("download")) continue;
            expect(exportStatusView(candidate!, NOW).state).toBe("succeeded");
          }
        }
      }
    });

    it("has at most one primary action, no duplicates, and never repeats the primary as a secondary", () => {
      for (const savedRevision of savedRevisions) {
        for (const readiness of readinesses) {
          for (const candidate of rows) {
            const result = actions(candidate, readiness, savedRevision);
            expect(new Set(result.secondary).size).toBe(result.secondary.length);
            if (result.primary !== null) expect(result.secondary).not.toContain(result.primary);
          }
        }
      }
    });

    it("explains a disabled request exactly when Export or Regenerate is offered while the CV is blocked", () => {
      for (const savedRevision of savedRevisions) {
        for (const readiness of readinesses) {
          for (const candidate of rows) {
            const result = actions(candidate, readiness, savedRevision);
            const needsRequest = [result.primary, ...result.secondary].some((action) => action === "export" || action === "regenerate");
            const expected = needsRequest && !readiness.ready ? (readiness.has_cv ? BLOCKED_REASON : NO_CV_REASON) : null;
            expect(result.disabledReason).toBe(expected);
          }
        }
      }
    });

    it("never disables Retry, Download or the CV builder link because of the blockers", () => {
      for (const candidate of rows) {
        const result = actions(candidate, BLOCKED);
        const onlyLocal = [result.primary, ...result.secondary].every((action) => action === null || ["retry", "download", "openBuilder"].includes(action));
        if (onlyLocal) expect(result.disabledReason).toBeNull();
      }
    });
  });
});

describe("T22 blocker links", () => {
  const link = (blocker: CvExportBlocker) => blockerLink(blocker);

  it("links item blockers to the item row in the CV builder", () => {
    for (const code of ["ITEM_CHANGED", "ITEM_DELETED", "ITEM_UNCONFIRMED"] as const) {
      expect(link({ code, item_id: ITEM })).toBe(`/cv#cv-item-${ITEM}`);
    }
  });

  it("links the other blockers to their section of the CV builder", () => {
    expect(link({ code: "PROFILE_CHANGED" })).toBe("/cv#cv-review");
    expect(link({ code: "NAME_REQUIRED" })).toBe("/cv#cv-profile");
    expect(link({ code: "CONTENT_REQUIRED" })).toBe("/cv");
    expect(link({ code: "CV_NOT_FOUND" })).toBe("/cv");
  });

  it("falls back to the review summary when an item blocker has no usable id", () => {
    expect(link({ code: "ITEM_DELETED" })).toBe("/cv#cv-review");
    expect(link({ code: "ITEM_CHANGED", item_id: "not-a-uuid" })).toBe("/cv#cv-review");
    expect(link({ code: "ITEM_UNCONFIRMED", item_id: `${ITEM}"><script>` })).toBe("/cv#cv-review");
  });
});

describe("T22 download file name", () => {
  const PATTERN = /^[A-Za-z0-9._-]{1,80}\.pdf$/;

  it("is generic and dated by the UTC day of finished_at", () => {
    expect(exportDownloadName("2026-10-07T01:00:05.000Z")).toBe("WorkPulse-CV-2026-10-07.pdf");
    expect(exportDownloadName("2026-10-07T23:59:59-05:00")).toBe("WorkPulse-CV-2026-10-08.pdf");
    expect(exportDownloadName("2026-10-07T00:30:00+07:00")).toBe("WorkPulse-CV-2026-10-06.pdf");
    expect(exportDownloadName("2026-12-31T23:59:59.999Z")).toBe("WorkPulse-CV-2026-12-31.pdf");
  });

  it("falls back to a safe name without a date when finished_at is missing or unreadable", () => {
    for (const value of [null, undefined, "", "garbage", "2026-13-45T00:00:00Z", "+275760-09-13T00:00:00.000Z"]) {
      expect(exportDownloadName(value), String(value)).toBe("WorkPulse-CV.pdf");
    }
  });

  it("always matches the storage file name pattern", () => {
    for (const value of ["2026-10-07T01:00:05.000Z", null, "garbage", "0001-01-01T00:00:00.000Z"]) {
      expect(exportDownloadName(value)).toMatch(PATTERN);
    }
  });
});

describe("T22 polling delays", () => {
  it("is the staged schedule that tops out at 30 seconds", () => {
    expect([...EXPORT_POLL_DELAYS]).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000]);
    expect([...EXPORT_POLL_DELAYS]).toEqual([...EXPORT_POLL_DELAYS].sort((a, b) => a - b));
  });
});
