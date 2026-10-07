import { describe, expect, it } from "vitest";

import { CV_ERROR_MESSAGE_KEYS } from "@/features/cv/cv-errors";
import { CV_EXPORT_BLOCKER_CODES, CV_EXPORT_STATUSES } from "@/domain/cv/contracts";
import { t, type MessageKey } from "@/i18n/messages";

const ERROR_KEYS = [
  "cv.export.error.blocked", "cv.export.error.inProgress", "cv.export.error.notFound",
  "cv.export.error.notRetryable", "cv.export.error.notReady", "cv.export.error.expired",
] as const satisfies readonly MessageKey[];

const BLOCKER_KEYS = {
  CV_NOT_FOUND: "cv.export.blocker.cvNotFound",
  NAME_REQUIRED: "cv.export.blocker.nameRequired",
  CONTENT_REQUIRED: "cv.export.blocker.contentRequired",
  ITEM_CHANGED: "cv.export.blocker.itemChanged",
  ITEM_DELETED: "cv.export.blocker.itemDeleted",
  ITEM_UNCONFIRMED: "cv.export.blocker.itemUnconfirmed",
  PROFILE_CHANGED: "cv.export.blocker.profileChanged",
} as const satisfies Record<(typeof CV_EXPORT_BLOCKER_CODES)[number], MessageKey>;

const STATUS_KEYS = {
  queued: "cv.export.status.queued",
  running: "cv.export.status.running",
  succeeded: "cv.export.status.succeeded",
  failed: "cv.export.status.failed",
  expired: "cv.export.status.expired",
} as const satisfies Record<(typeof CV_EXPORT_STATUSES)[number] | "expired", MessageKey>;

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

describe("T21 export copy", () => {
  const keys: MessageKey[] = [...ERROR_KEYS, ...Object.values(BLOCKER_KEYS), ...Object.values(STATUS_KEYS)];

  it("has English and Indonesian text for every export error, blocker and status key", () => {
    for (const key of keys) {
      const en = t("en", key);
      const id = t("id", key);
      expect(en.trim(), key).not.toBe("");
      expect(id.trim(), key).not.toBe("");
      expect(en, key).not.toBe(key);
      expect(id, key).not.toBe(key);
      expect(id, key).not.toBe(en);
      expect(placeholders(id), key).toEqual(placeholders(en));
    }
  });

  it("covers every blocker code and every export status exactly once", () => {
    expect(Object.keys(BLOCKER_KEYS).sort()).toEqual([...CV_EXPORT_BLOCKER_CODES].sort());
    expect(Object.keys(STATUS_KEYS).sort()).toEqual([...CV_EXPORT_STATUSES, "expired"].sort());
  });

  it("points every export service error at an export message key", () => {
    expect(CV_ERROR_MESSAGE_KEYS.EXPORT_BLOCKED).toBe("cv.export.error.blocked");
    expect(CV_ERROR_MESSAGE_KEYS.EXPORT_IN_PROGRESS).toBe("cv.export.error.inProgress");
    expect(CV_ERROR_MESSAGE_KEYS.EXPORT_NOT_FOUND).toBe("cv.export.error.notFound");
    expect(CV_ERROR_MESSAGE_KEYS.EXPORT_NOT_RETRYABLE).toBe("cv.export.error.notRetryable");
    expect(CV_ERROR_MESSAGE_KEYS.EXPORT_NOT_READY).toBe("cv.export.error.notReady");
    expect(CV_ERROR_MESSAGE_KEYS.EXPORT_EXPIRED).toBe("cv.export.error.expired");
  });

  it("keeps the copy free of internal codes and storage words", () => {
    for (const key of keys) {
      for (const locale of ["en", "id"] as const) {
        expect(t(locale, key), key).not.toMatch(/object|bucket|snapshot|token|lease|P0001|CV_EXPORT/i);
      }
    }
  });
});

const EXPORT_PAGE_KEYS = [
  "cv.exportPage.title", "cv.exportPage.intro", "cv.exportPage.back", "cv.exportPage.savedRevision", "cv.exportPage.cvLanguage",
  "cv.exportPage.empty.title", "cv.exportPage.empty.description", "cv.exportPage.empty.action", "cv.exportPage.blockers.heading",
  "cv.exportPage.action.export", "cv.exportPage.action.regenerate", "cv.exportPage.action.retry", "cv.exportPage.action.download",
  "cv.exportPage.action.openBuilder", "cv.exportPage.action.working", "cv.exportPage.status.heading", "cv.exportPage.status.none",
  "cv.exportPage.status.pages", "cv.exportPage.status.availableUntil", "cv.exportPage.status.reused",
  "cv.exportPage.failure.EXPORT_TIMEOUT", "cv.exportPage.failure.RENDERER_UNAVAILABLE", "cv.exportPage.failure.RENDERER_TIMEOUT",
  "cv.exportPage.failure.EXPORT_RENDER_INVALID", "cv.exportPage.failure.EXPORT_TOO_LONG", "cv.exportPage.failure.EXPORT_SNAPSHOT_INVALID",
  "cv.exportPage.failure.STORAGE_UNAVAILABLE", "cv.exportPage.failure.ACCOUNT_DELETING",
  "cv.exportPage.notice.stale", "cv.exportPage.notice.reload", "cv.exportPage.notice.downloadStarted",
  "cv.exportPage.history.heading", "cv.exportPage.history.revision", "cv.exportPage.history.earlier",
  "cv.exportPage.pages.heading", "cv.exportPage.pages.forRevision", "cv.exportPage.pages.earlier", "cv.exportPage.pages.pageOf",
  "cv.exportPage.pages.previous", "cv.exportPage.pages.next", "cv.exportPage.pages.loading", "cv.exportPage.pages.error",
  "cv.exportPage.pages.retry", "cv.exportPage.pages.canvasLabel",
  "cv.builder.previewAndExport", "cv.builder.previewAndExportDisabled",
] as const satisfies readonly MessageKey[];

describe("T22 S14 copy", () => {
  it("has English and Indonesian text with the same placeholders for every S14 key", () => {
    for (const key of EXPORT_PAGE_KEYS) {
      const en = t("en", key);
      const id = t("id", key);
      expect(en.trim(), key).not.toBe("");
      expect(id.trim(), key).not.toBe("");
      expect(en, key).not.toBe(key);
      expect(id, key).not.toBe(key);
      expect(id, key).not.toBe(en);
      expect(placeholders(id), key).toEqual(placeholders(en));
    }
  });

  it("keeps the S14 copy free of internal codes and storage words", () => {
    for (const key of EXPORT_PAGE_KEYS) {
      for (const locale of ["en", "id"] as const) {
        expect(t(locale, key), key).not.toMatch(/bucket|snapshot|token|lease|P0001|CV_EXPORT|EXPORT_|object key/i);
      }
    }
  });

  it("names the one primary action of each state the way the plan does", () => {
    expect(t("en", "cv.exportPage.action.export")).toBe("Export PDF");
    expect(t("en", "cv.exportPage.action.download")).toBe("Download PDF");
    expect(t("en", "cv.exportPage.action.retry")).toBe("Retry export");
    expect(t("en", "cv.exportPage.action.regenerate")).toBe("Regenerate PDF");
    expect(t("en", "cv.exportPage.savedRevision", { revision: 7 })).toBe("Saved revision 7");
    expect(t("en", "cv.exportPage.pages.pageOf", { page: 2, total: 5 })).toBe("Page 2 of 5");
    expect(t("en", "cv.exportPage.history.earlier")).toBe("Earlier revision");
  });
});
