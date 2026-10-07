import * as z from "zod";

import {
  CV_EXPORT_STATUSES,
  cvExportBlockerSchema,
  cvExportRowSchema,
  type CvExportBlocker,
  type CvExportBlockerCode,
  type CvExportErrorCode,
  type CvExportRow,
  type CvExportStatus,
} from "@/domain/cv/contracts";
import { EXPORT_POLL_DELAYS } from "@/domain/cv/export-view";
import type { Locale, MessageKey } from "@/i18n/messages";
import type { ActionState } from "@/server/action-result";

/**
 * Pure state rules of the S14 export page, kept out of the components so they are unit tested without a DOM
 * (the project has no DOM test environment). The components only wire them to React state and the server actions.
 */

/** The page lists the five newest exports. */
export const EXPORT_HISTORY_LIMIT = 5;

export function isActiveExport(row: Pick<CvExportRow, "status"> | null | undefined): boolean {
  return row !== null && row !== undefined && (row.status === "queued" || row.status === "running");
}

/** True the moment an export that was queued or running is no longer active (the page then reloads its lists). */
export function becameTerminal(previous: Pick<CvExportRow, "status"> | null, next: Pick<CvExportRow, "status">): boolean {
  return isActiveExport(previous) && !isActiveExport(next);
}

/**
 * What the next status request looks like, or null when polling must stop: nothing is active or the tab is hidden.
 * The delay follows the staged schedule and repeats its last value; an unusable index starts the schedule over.
 */
export function pollingPlan(input: { activeId: string | null; hidden: boolean; pollIndex: number }): { delay: number; nextIndex: number } | null {
  if (input.activeId === null || input.hidden) return null;
  const last = EXPORT_POLL_DELAYS.length - 1;
  const index = Number.isFinite(input.pollIndex) ? Math.min(Math.max(Math.trunc(input.pollIndex), 0), last) : 0;
  return { delay: EXPORT_POLL_DELAYS[index]!, nextIndex: Math.min(index + 1, last) };
}

/** The status route body: the safe export columns plus `expired`; anything else (an error body, a private column) is refused. */
export function parseStatusResponse(json: unknown): { row: CvExportRow; expired: boolean } | null {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  const { expired, ...rest } = json as Record<string, unknown>;
  if (typeof expired !== "boolean") return null;
  const row = cvExportRowSchema.safeParse(rest);
  return row.success ? { row: row.data, expired } : null;
}

/** Puts a polled or new row into the list: same id replaces it, order is by creation time (newest first), capped. */
export function mergeExportRow(rows: readonly CvExportRow[], next: CvExportRow, limit: number = EXPORT_HISTORY_LIMIT): CvExportRow[] {
  const merged = [next, ...rows.filter((row) => row.id !== next.id)];
  merged.sort((a, b) => {
    const delta = Date.parse(b.created_at) - Date.parse(a.created_at);
    return Number.isNaN(delta) ? 0 : delta;
  });
  return merged.slice(0, limit);
}

/** Keeps the shown page inside 1..total (a total below one still shows page one). */
export function clampPage(page: number, total: number): number {
  const wanted = Number.isFinite(page) ? Math.trunc(page) : 1;
  return Math.min(Math.max(wanted, 1), Math.max(Math.trunc(total) || 1, 1));
}

export function stepPage(page: number, total: number, delta: 1 | -1): number {
  return clampPage(page + delta, total);
}

export type ExportOutcome =
  | { kind: "started"; exportId: string; status: CvExportStatus; reused: boolean }
  | { kind: "download"; url: string }
  /** The CV was saved elsewhere since this page loaded: the page offers Reload and never retries by itself. */
  | { kind: "stale" }
  | { kind: "inProgress" }
  | { kind: "blocked"; blockers: CvExportBlocker[] }
  /** The export is gone, expired, not ready or not retryable: show the reason and reload the lists. */
  | { kind: "gone"; messageKey: MessageKey }
  | { kind: "signedOut" }
  | { kind: "failed"; messageKey: MessageKey; correlationId: string };

function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

const startedSchema = z.object({ exportId: z.uuid(), status: z.enum(CV_EXPORT_STATUSES), reused: z.boolean().optional() });
const downloadSchema = z.object({ url: z.string().refine(isHttpUrl) });
const blockersSchema = z.array(cvExportBlockerSchema);

const GONE_KEYS = new Set<MessageKey>(["cv.export.error.notFound", "cv.export.error.expired", "cv.export.error.notRetryable", "cv.export.error.notReady"]);

/** Reads the result of the request, retry and download actions (codes and message keys only; no text from the server). */
export function classifyExportResult(state: ActionState): ExportOutcome {
  if (state.status === "success") {
    const download = downloadSchema.safeParse(state.data);
    if (download.success) return { kind: "download", url: download.data.url };
    const started = startedSchema.safeParse(state.data);
    if (started.success) {
      return { kind: "started", exportId: started.data.exportId, status: started.data.status, reused: started.data.reused === true };
    }
    return { kind: "failed", messageKey: "error.unavailable", correlationId: state.correlationId };
  }
  if (state.status === "idle") return { kind: "failed", messageKey: "error.unavailable", correlationId: crypto.randomUUID() };

  const { code, messageKey, correlationId, latestRecord } = state.error;
  if (code === "UNAUTHENTICATED") return { kind: "signedOut" };
  // A revision that moved on is the only conflict a fresh idempotency key can meet.
  if (code === "CONFLICT" && messageKey === "error.conflict") return { kind: "stale" };
  if (messageKey === "cv.export.error.inProgress") return { kind: "inProgress" };
  if (messageKey === "cv.export.error.blocked") {
    const blockers = blockersSchema.safeParse(latestRecord?.["blockers"]);
    return { kind: "blocked", blockers: blockers.success ? blockers.data : [] };
  }
  if (GONE_KEYS.has(messageKey)) return { kind: "gone", messageKey };
  return { kind: "failed", messageKey, correlationId };
}

const FAILURE_KEYS = {
  EXPORT_TIMEOUT: "cv.exportPage.failure.EXPORT_TIMEOUT",
  RENDERER_UNAVAILABLE: "cv.exportPage.failure.RENDERER_UNAVAILABLE",
  RENDERER_TIMEOUT: "cv.exportPage.failure.RENDERER_TIMEOUT",
  EXPORT_RENDER_INVALID: "cv.exportPage.failure.EXPORT_RENDER_INVALID",
  EXPORT_TOO_LONG: "cv.exportPage.failure.EXPORT_TOO_LONG",
  EXPORT_SNAPSHOT_INVALID: "cv.exportPage.failure.EXPORT_SNAPSHOT_INVALID",
  STORAGE_UNAVAILABLE: "cv.exportPage.failure.STORAGE_UNAVAILABLE",
  ACCOUNT_DELETING: "cv.exportPage.failure.ACCOUNT_DELETING",
} as const satisfies Record<CvExportErrorCode, MessageKey>;

const BLOCKER_KEYS = {
  CV_NOT_FOUND: "cv.export.blocker.cvNotFound",
  NAME_REQUIRED: "cv.export.blocker.nameRequired",
  CONTENT_REQUIRED: "cv.export.blocker.contentRequired",
  ITEM_CHANGED: "cv.export.blocker.itemChanged",
  ITEM_DELETED: "cv.export.blocker.itemDeleted",
  ITEM_UNCONFIRMED: "cv.export.blocker.itemUnconfirmed",
  PROFILE_CHANGED: "cv.export.blocker.profileChanged",
} as const satisfies Record<CvExportBlockerCode, MessageKey>;

/** The sentence of a blocker; the page links it to the place in S13 where it is fixed. */
export function blockerMessageKey(code: CvExportBlockerCode): MessageKey {
  return BLOCKER_KEYS[code];
}

/** The reason shown for a failed export; the stored code itself is never printed. */
export function failureMessageKey(code: CvExportErrorCode): MessageKey {
  return FAILURE_KEYS[code];
}

/** A date and time in the profile's time zone; an unknown zone falls back to UTC and an unreadable date gives "". */
export function formatExportTime(iso: string | null | undefined, locale: Locale, timeZone: string): string {
  const time = typeof iso === "string" ? Date.parse(iso) : Number.NaN;
  if (Number.isNaN(time)) return "";
  const tag = locale === "id" ? "id-ID" : "en-US";
  try {
    return new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short", timeZone }).format(time);
  } catch {
    return new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(time);
  }
}
