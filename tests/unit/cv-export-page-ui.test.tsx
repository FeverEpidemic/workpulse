import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/features/cv/actions", () => ({
  requestCvExportAction: vi.fn(), retryCvExportAction: vi.fn(), issueCvExportDownloadAction: vi.fn(),
}));

import {
  cvExportRowSchema,
  type CvExportBlocker,
  type CvExportReadiness,
  type CvExportRow,
} from "@/domain/cv/contracts";
import { buildCvPreviewModel } from "@/domain/cv/preview";
import { CvExportPage, type CvExportPageProps } from "@/features/cv/cv-export-page";

import { richCvFixture, uuid } from "./cv-fixtures";

const NOW = "2026-10-07T03:00:00.000Z";
const SAVED = 3;
const ITEM = uuid(9);

const READY: CvExportReadiness = { has_cv: true, cv_revision: SAVED, ready: true, blockers: [] };
const blocked = (blockers: CvExportBlocker[]): CvExportReadiness => ({ has_cv: true, cv_revision: SAVED, ready: false, blockers });

function row(id: number, over: Partial<CvExportRow> = {}): CvExportRow {
  return cvExportRowSchema.parse({
    id: uuid(id), cv_id: uuid(60), cv_revision: SAVED, status: "succeeded", error_code: null, attempt_count: 1, page_count: 3, byte_size: 4096,
    started_at: "2026-10-07T01:00:00.000Z", finished_at: "2026-10-07T01:00:05.000Z", expires_at: "2026-10-08T01:00:05.000Z", purged_at: null,
    created_at: `2026-10-07T0${Math.min(id % 10, 9)}:00:00.000Z`, updated_at: "2026-10-07T01:00:05.000Z", revision: 2, ...over,
  });
}
const queued = (id: number, over: Partial<CvExportRow> = {}) => row(id, {
  status: "queued", attempt_count: 0, page_count: null, byte_size: null, started_at: null, finished_at: null, expires_at: null, ...over,
});
const failed = (id: number, code: NonNullable<CvExportRow["error_code"]>, over: Partial<CvExportRow> = {}) => row(id, {
  status: "failed", error_code: code, page_count: null, byte_size: null, expires_at: null, ...over,
});

function render(over: Partial<CvExportPageProps> = {}) {
  const { document, items } = richCvFixture("en");
  const props: CvExportPageProps = {
    locale: "en", timeZone: "Asia/Jakarta", title: "CV Siti", cvLocale: "en", savedRevision: SAVED,
    model: buildCvPreviewModel({ document, items }), readiness: READY, exports: [], nowIso: NOW, ...over,
  };
  return renderToStaticMarkup(<CvExportPage {...props} />);
}

const buttons = (html: string) => [...html.matchAll(/data-testid="(cv-export-(?:export|regenerate|retry|download|open-builder))"/g)].map((match) => match[1]);

describe("T22 S14 page: before any export", () => {
  it("shows the saved revision, the CV title and language, and one primary Export PDF", () => {
    const html = render();
    expect(html).toContain("Saved revision 3");
    expect(html).toContain('data-saved-revision="3"');
    expect(html).toContain("CV Siti");
    expect(html).toContain("CV language: English");
    expect(buttons(html)).toEqual(["cv-export-export"]);
    expect(html).toContain("Export PDF");
    expect(html).not.toContain('aria-disabled="true"');
    expect(html).toContain("No PDF has been exported from this revision yet.");
    expect(html).not.toContain('data-testid="cv-export-blockers"');
    expect(html).not.toContain('data-testid="cv-export-history"');
    expect(html).not.toContain('data-testid="cv-pdf-pages"');
  });

  it("previews the saved CV (never an editor draft) beside the export panel", () => {
    const html = render();
    expect(html).toContain('data-testid="cv-preview-paper"');
    expect(html).toContain("Siti Nurhaliza");
    expect(html).toContain("Ringkasan buatan sendiri");
    expect(html).not.toContain("Unsaved changes");
    expect(html).not.toContain("Save your changes first.");
  });

  it("announces the status in a polite live region that can take focus", () => {
    const html = render();
    expect(html).toMatch(/<div[^>]*role="status"[^>]*aria-live="polite"[^>]*data-testid="cv-export-status"|<div[^>]*data-testid="cv-export-status"[^>]*>/);
    expect(html).toMatch(/tabindex="-1"[^>]*role="status"|role="status"[^>]*tabindex="-1"/);
  });
});

describe("T22 S14 page: blockers", () => {
  const html = render({
    readiness: blocked([
      { code: "ITEM_DELETED", item_id: ITEM }, { code: "ITEM_CHANGED", item_id: uuid(10) }, { code: "ITEM_UNCONFIRMED", item_id: uuid(11) },
      { code: "PROFILE_CHANGED" }, { code: "NAME_REQUIRED" }, { code: "CONTENT_REQUIRED" },
    ]),
  });

  it("lists each blocker as a link to its place in the CV builder", () => {
    expect(html).toContain('data-testid="cv-export-blockers"');
    for (const href of [`/cv#cv-item-${ITEM}`, `/cv#cv-item-${uuid(10)}`, `/cv#cv-item-${uuid(11)}`, "/cv#cv-review", "/cv#cv-profile", "/cv"]) {
      expect(html, href).toContain(`href="${href}"`);
    }
    expect(html).toContain("A record on your CV was deleted.");
    expect(html).toContain("Add your name to the CV.");
    expect([...html.matchAll(/data-testid="cv-export-blocker"/g)]).toHaveLength(6);
  });

  it("keeps Export PDF focusable but disabled, with the reason attached to it", () => {
    const button = /<button[^>]*data-testid="cv-export-export"[^>]*>/.exec(html)?.[0] ?? "";
    expect(button).toContain('aria-disabled="true"');
    expect(button).not.toMatch(/\sdisabled(=|\s|>)/);
    const reasonId = /aria-describedby="([^"]+)"/.exec(button)?.[1];
    expect(reasonId).toBeTruthy();
    expect(html).toContain(`id="${reasonId}"`);
    expect(html).toContain("Your CV cannot be exported yet.");
  });
});

describe("T22 S14 page: the newest export decides the one primary action", () => {
  it("waiting and preparing show only the status", () => {
    const waiting = render({ exports: [queued(21)] });
    expect(buttons(waiting)).toEqual([]);
    expect(waiting).toContain("Waiting to start");
    expect(waiting).toContain('data-state="queued"');
    const preparing = render({ exports: [queued(22, { status: "running", attempt_count: 1, started_at: "2026-10-07T01:00:01.000Z" })] });
    expect(buttons(preparing)).toEqual([]);
    expect(preparing).toContain("Preparing your PDF");
    expect(preparing).toContain('data-state="running"');
  });

  it("a finished export of the saved revision offers Download PDF and shows the real pages", () => {
    const html = render({ exports: [row(23)] });
    expect(buttons(html)).toContain("cv-export-download");
    expect(buttons(html).filter((id) => id !== "cv-export-download")).toEqual([]);
    expect(html).toContain("PDF ready");
    expect(html).toContain("Pages: 3");
    expect(html).toContain('data-testid="cv-pdf-pages"');
    expect(html).toContain("Pages of the PDF for revision 3");
    expect(html).not.toContain('data-testid="cv-pdf-earlier"');
  });

  it("never puts a download URL, a token or a storage path into the markup", () => {
    const html = render({ exports: [row(23), failed(24, "RENDERER_UNAVAILABLE")] });
    expect(html).not.toMatch(/token=|\/storage\/v1|signedUrl|object_key|snapshot|attempt_token|idempotency/i);
    expect(html).not.toMatch(/href="https?:/);
  });

  it("an export of an earlier revision offers Regenerate first, keeps the earlier download, and says so", () => {
    const html = render({ exports: [row(25, { cv_revision: SAVED - 1 })] });
    const ids = buttons(html);
    expect(ids.indexOf("cv-export-regenerate")).toBeLessThan(ids.indexOf("cv-export-download"));
    expect(html).toContain("Regenerate PDF");
    expect(html).toContain('data-testid="cv-pdf-earlier"');
    expect(html).toContain("Pages of the PDF for revision 2");
    expect(html).toContain("Earlier revision");
  });

  it("an expired file offers only Regenerate and no pages", () => {
    const html = render({ exports: [row(26, { expires_at: "2026-10-07T02:00:00.000Z" })] });
    expect(buttons(html)).toEqual(["cv-export-regenerate"]);
    expect(html).toContain("Download expired");
    expect(html).not.toContain('data-testid="cv-pdf-pages"');
  });

  it("a failure that can be retried offers Retry export and says why in plain words", () => {
    const html = render({ exports: [failed(27, "RENDERER_UNAVAILABLE", { attempt_count: 1 })] });
    expect(buttons(html)).toEqual(["cv-export-retry"]);
    expect(html).toContain("Retry export");
    expect(html).toContain("The PDF service is not available right now.");
    expect(html).not.toContain("RENDERER_UNAVAILABLE");
  });

  it("a failure after the third attempt, or of an earlier revision, offers Regenerate instead", () => {
    expect(buttons(render({ exports: [failed(28, "EXPORT_TIMEOUT", { attempt_count: 3 })] }))).toEqual(["cv-export-regenerate"]);
    expect(buttons(render({ exports: [failed(29, "EXPORT_TIMEOUT", { cv_revision: SAVED - 1 })] }))).toEqual(["cv-export-regenerate"]);
  });

  it("a permanent failure explains itself and leads to the CV builder", () => {
    const html = render({ exports: [failed(30, "EXPORT_TOO_LONG")] });
    expect(buttons(html)).toEqual(["cv-export-open-builder", "cv-export-regenerate"]);
    expect(html).toContain("Your CV is longer than 20 pages.");
    expect(html).not.toContain("EXPORT_TOO_LONG");
    expect(html).toMatch(/<a[^>]*href="\/cv"[^>]*data-testid="cv-export-open-builder"|<a[^>]*data-testid="cv-export-open-builder"[^>]*href="\/cv"/);
  });

  it("Regenerate is disabled with the blocker reason when the saved CV is blocked", () => {
    const html = render({ exports: [row(31, { expires_at: "2026-10-07T02:00:00.000Z" })], readiness: blocked([{ code: "ITEM_DELETED", item_id: ITEM }]) });
    expect(/<button[^>]*data-testid="cv-export-regenerate"[^>]*>/.exec(html)?.[0]).toContain('aria-disabled="true"');
    expect(html).toContain("Your CV cannot be exported yet.");
  });
});

describe("T22 S14 page: recent exports", () => {
  const rows = [
    row(45, { cv_revision: SAVED }), failed(44, "EXPORT_TIMEOUT", { cv_revision: SAVED - 1, attempt_count: 2 }),
    row(43, { cv_revision: SAVED - 1 }), queued(42, { cv_revision: SAVED - 2, status: "running", attempt_count: 1 }), row(41, { cv_revision: SAVED - 2 }),
  ];

  it("lists up to five with revision, status, time in the profile time zone, and marks earlier revisions", () => {
    const html = render({ exports: rows });
    expect([...html.matchAll(/data-testid="cv-export-row"/g)]).toHaveLength(5);
    expect(html).toContain("Revision 3");
    expect(html).toContain("Revision 2");
    expect(html).toMatch(/Earlier revision/);
    expect(html).toMatch(/Oct 7, 2026, 8:00/);
    expect(html).toContain('data-revision="1"');
  });

  it("offers only Download and Retry on a row, with the revision in the accessible name", () => {
    const html = render({ exports: rows });
    expect(html).toContain('aria-label="Download PDF, Revision 3"');
    expect(html).not.toMatch(/data-testid="cv-export-row-(regenerate|export|open-builder)"/);
    // The failed row is of an earlier revision, so it has no Retry (N2).
    expect(html).not.toContain("cv-export-row-retry");
  });
});

describe("T22 S14 page: language", () => {
  it("speaks Indonesian when the profile does", () => {
    const html = render({ locale: "id", cvLocale: "id", exports: [row(51)] });
    expect(html).toContain("Revisi tersimpan 3");
    expect(html).toContain("Bahasa CV: Bahasa Indonesia");
    expect(html).toContain("Unduh PDF");
    expect(html).toContain("Halaman PDF untuk revisi 3");
  });
});
