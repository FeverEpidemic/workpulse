// Pure rules of the S14 export page (T22): status, which actions are valid, where a blocker leads, the download
// name and the polling schedule. No I/O and no UI; relative imports only, like the rest of the export domain.
import type { MessageKey } from "../../i18n/messages.ts";
import type { CvExportBlocker, CvExportReadiness, CvExportRow } from "./contracts.ts";
import { CV_EXPORT_MAX_ATTEMPTS, isExportExpired, isPermanentExportError } from "./export.ts";

/** Delay before the next status request, by number of polls so far; the last value repeats (same schedule as T10/T15). */
export const EXPORT_POLL_DELAYS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;

export type ExportViewState = "queued" | "running" | "succeeded" | "failed" | "expired";

export type ExportStatusView = { state: ExportViewState; messageKey: MessageKey };

const STATUS_KEYS = {
  queued: "cv.export.status.queued",
  running: "cv.export.status.running",
  succeeded: "cv.export.status.succeeded",
  failed: "cv.export.status.failed",
  expired: "cv.export.status.expired",
} as const satisfies Record<ExportViewState, MessageKey>;

/** The state shown for an export: a succeeded one past its 24 hours (or purged) reads as expired. */
export function exportStatusView(row: Pick<CvExportRow, "status" | "expires_at" | "purged_at">, now: Date): ExportStatusView {
  const state: ExportViewState = row.status === "succeeded" && isExportExpired(row, now) ? "expired" : row.status;
  return { state, messageKey: STATUS_KEYS[state] };
}

/**
 * `export` is the first request, `regenerate` a new request after an expired, older or non-retryable export (both
 * validate the saved CV again), `retry` re-queues a failed export with its own snapshot, `download` issues a
 * short-lived URL, and `openBuilder` leads to S13.
 */
export type ExportAction = "export" | "download" | "retry" | "regenerate" | "openBuilder";

export type ExportActions = {
  /** At most one primary action per state (Design.md). */
  primary: ExportAction | null;
  secondary: ExportAction[];
  /**
   * Why `export` and `regenerate` cannot be requested now (the saved CV is blocked or missing); null when they can,
   * or when none is offered. `retry`, `download` and `openBuilder` are never disabled by it.
   */
  disabledReason: MessageKey | null;
};

const BLOCKED_REASON = "cv.export.error.blocked" as const satisfies MessageKey;
const NO_CV_REASON = "cv.export.blocker.cvNotFound" as const satisfies MessageKey;

/**
 * The valid actions for the newest export of the saved CV (or for one history row).
 *
 * Retry is only valid for a failed export with a retriable code, attempts left, and the revision that is saved now:
 * a retry prints the old snapshot, so after the CV changed (sources may be gone) the user regenerates instead (N2).
 */
export function exportActions(input: {
  row: CvExportRow | null;
  savedRevision: number;
  readiness: Pick<CvExportReadiness, "has_cv" | "ready">;
  now: Date;
}): ExportActions {
  const { row, savedRevision, readiness, now } = input;
  const offered = (primary: ExportAction | null, secondary: ExportAction[] = []): ExportActions => {
    const needsRequest = [primary, ...secondary].some((action) => action === "export" || action === "regenerate");
    const disabledReason = needsRequest && !readiness.ready ? (readiness.has_cv ? BLOCKED_REASON : NO_CV_REASON) : null;
    return { primary, secondary, disabledReason };
  };

  if (row === null) return offered("export");

  switch (exportStatusView(row, now).state) {
    case "queued":
    case "running":
      return offered(null);
    case "succeeded":
      return row.cv_revision === savedRevision ? offered("download") : offered("regenerate", ["download"]);
    case "expired":
      return offered("regenerate");
    case "failed": {
      const current = row.cv_revision === savedRevision;
      if (current && !isPermanentExportError(row.error_code) && row.attempt_count < CV_EXPORT_MAX_ATTEMPTS) return offered("retry");
      // A permanent failure of the saved revision repeats until the CV changes: send the user to S13 first.
      if (current && isPermanentExportError(row.error_code)) return offered("openBuilder", ["regenerate"]);
      return offered("regenerate");
    }
  }
}

const ITEM_BLOCKERS = new Set<CvExportBlocker["code"]>(["ITEM_CHANGED", "ITEM_DELETED", "ITEM_UNCONFIRMED"]);
const ITEM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where the user fixes a blocker in S13; the anchors exist in the builder (T19/T20, `#cv-profile` added in T22). */
export function blockerLink(blocker: CvExportBlocker): string {
  if (ITEM_BLOCKERS.has(blocker.code)) {
    return blocker.item_id !== undefined && ITEM_ID.test(blocker.item_id) ? `/cv#cv-item-${blocker.item_id}` : "/cv#cv-review";
  }
  switch (blocker.code) {
    case "PROFILE_CHANGED":
      return "/cv#cv-review";
    case "NAME_REQUIRED":
      return "/cv#cv-profile";
    default:
      return "/cv";
  }
}

const GENERIC_NAME = "WorkPulse-CV";

/**
 * `WorkPulse-CV-<YYYY-MM-DD>.pdf` from the UTC day of `finished_at`. The name is generic on purpose: it travels in
 * the signed URL, so no personal data may be part of it. An unreadable date gives `WorkPulse-CV.pdf`.
 */
export function exportDownloadName(finishedAt: string | null | undefined): string {
  const time = typeof finishedAt === "string" ? Date.parse(finishedAt) : Number.NaN;
  if (Number.isNaN(time)) return `${GENERIC_NAME}.pdf`;
  const day = new Date(time).toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${GENERIC_NAME}-${day}.pdf` : `${GENERIC_NAME}.pdf`;
}
