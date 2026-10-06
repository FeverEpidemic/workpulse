import { describe, expect, it } from "vitest";

import { buildCvPreviewModel } from "@/domain/cv/preview";
import {
  CV_EXPORT_DOWNLOAD_TTL_SECONDS,
  CV_EXPORT_MAX_ATTEMPTS,
  CV_EXPORT_MAX_BYTES,
  CV_EXPORT_MAX_PAGES,
  CV_EXPORT_TTL_HOURS,
  buildExportRenderModel,
  cvExportSnapshotSchema,
  effectiveExportName,
  isExportExpired,
  isPermanentExportError,
} from "@/domain/cv/export";

import {
  achievementSnapshot, certificationSnapshot, documentRow, educationSnapshot, exportSnapshotFrom, experienceSnapshot, graduateItems,
  itemRow, projectSnapshot, skillSnapshot, uuid,
} from "./cv-fixtures";

/** A rich CV: partial dates, nested and standalone achievements, overrides, summary and display overrides. */
function richCv(locale: "en" | "id") {
  const experience = uuid(110);
  const project = uuid(111);
  const document = documentRow({
    locale,
    title: "CV Siti",
    summary_override: "Ringkasan buatan sendiri",
    profile_snapshot: {
      schema_version: "cv-profile.v1", display_name: "Siti Nurhaliza Ç. Ñuñez", headline: "Analis", summary: "Ringkasan sumber",
      contact_email: "siti@example.com", phone: null, location: "Jakarta", website: null,
      display_overrides: { headline: "Analis Data Senior", website: "https://siti.example.com" },
    },
  });
  const items = [
    itemRow(uuid(1), "experience", 1, experienceSnapshot(experience, { start_date: "2021-04-01", start_precision: "month", end_date: null, end_precision: null, is_current: true })),
    itemRow(uuid(2), "projects", 1, projectSnapshot(project, { experience_id: experience, start_date: "2022-01-01", start_precision: "year", end_date: "2023-06-01", end_precision: "month", is_current: false })),
    itemRow(uuid(3), "achievements", 1, achievementSnapshot(uuid(301), { project_id: project, cv_bullet: "Pengelolaan anggaran Rp1,5 miliar — “tepat waktu”" })),
    itemRow(uuid(4), "achievements", 2, achievementSnapshot(uuid(302), { achieved_on: "2023-12-05" }), { override_text: "Bullet yang ditulis ulang" }),
    itemRow(uuid(5), "education", 1, educationSnapshot(uuid(201))),
    itemRow(uuid(6), "skills", 1, skillSnapshot(uuid(401), "SQL")),
    itemRow(uuid(7), "certifications", 1, certificationSnapshot(uuid(501))),
  ];
  return { document, items };
}

describe("T21 export snapshot schema", () => {
  it("accepts the snapshot of a saved CV", () => {
    const { document, items } = richCv("id");
    const parsed = cvExportSnapshotSchema.safeParse(exportSnapshotFrom(document, items));
    expect(parsed.success).toBe(true);
  });

  it("accepts a CV with no items", () => {
    expect(cvExportSnapshotSchema.safeParse(exportSnapshotFrom(documentRow(), [])).success).toBe(true);
  });

  it("rejects an unknown top-level key, another schema version and another template", () => {
    const snapshot = exportSnapshotFrom(documentRow(), graduateItems());
    expect(cvExportSnapshotSchema.safeParse({ ...snapshot, evidence: [] }).success).toBe(false);
    expect(cvExportSnapshotSchema.safeParse({ ...snapshot, schema_version: "cv-export.v2" }).success).toBe(false);
    expect(cvExportSnapshotSchema.safeParse({ ...snapshot, template_key: "two_column" }).success).toBe(false);
    expect(cvExportSnapshotSchema.safeParse({ ...snapshot, locale: "fr" }).success).toBe(false);
  });

  it("rejects an item with a foreign key, a private source key or the wrong section", () => {
    const snapshot = exportSnapshotFrom(documentRow(), graduateItems());
    const first = snapshot.items[0]!;
    expect(cvExportSnapshotSchema.safeParse({ ...snapshot, items: [{ ...first, source_deleted: false }, ...snapshot.items.slice(1)] }).success).toBe(false);
    expect(cvExportSnapshotSchema.safeParse({
      ...snapshot, items: [{ ...first, source_snapshot: { ...first.source_snapshot, raw_text: "WP-PRIVATE" } }, ...snapshot.items.slice(1)],
    }).success).toBe(false);
    expect(cvExportSnapshotSchema.safeParse({ ...snapshot, items: [{ ...first, section_key: "skills" }, ...snapshot.items.slice(1)] }).success).toBe(false);
  });

  it("rejects duplicate item ids and a duplicate section position", () => {
    const snapshot = exportSnapshotFrom(documentRow(), graduateItems());
    const [first, second, ...rest] = snapshot.items;
    expect(cvExportSnapshotSchema.safeParse({ ...snapshot, items: [first, { ...second, id: first!.id }, ...rest] }).success).toBe(false);
    expect(cvExportSnapshotSchema.safeParse({
      ...snapshot, items: [first, { ...second, section_key: first!.section_key, position: first!.position, source_snapshot: first!.source_snapshot }, ...rest],
    }).success).toBe(false);
  });

  it("rejects a malformed profile snapshot and a bad section order", () => {
    const snapshot = exportSnapshotFrom(documentRow(), []);
    expect(cvExportSnapshotSchema.safeParse({ ...snapshot, profile_snapshot: { ...snapshot.profile_snapshot, extra: 1 } }).success).toBe(false);
    expect(cvExportSnapshotSchema.safeParse({ ...snapshot, section_order: ["skills"] }).success).toBe(false);
    expect(cvExportSnapshotSchema.safeParse({ ...snapshot, title: "" }).success).toBe(false);
  });
});

describe("T21 export render model (preview parity)", () => {
  it.each(["en", "id"] as const)("equals the T19 preview model of the saved CV in %s", (locale) => {
    const { document, items } = richCv(locale);
    const parsed = cvExportSnapshotSchema.parse(exportSnapshotFrom(document, items));
    expect(buildExportRenderModel(parsed)).toEqual(buildCvPreviewModel({ document, items }));
  });

  it("keeps the nested achievement once, the override wording and the section order", () => {
    const { document, items } = richCv("id");
    const model = buildExportRenderModel(cvExportSnapshotSchema.parse(exportSnapshotFrom(document, items)));
    expect(model.sections.map((section) => section.key)).toEqual(["experience", "projects", "achievements", "education", "skills", "certifications"]);
    expect(model.sections[1]!.entries[0]!.children.map((child) => child.itemId)).toEqual([uuid(3)]);
    expect(model.sections[2]!.entries.map((entry) => entry.text)).toEqual(["Bullet yang ditulis ulang"]);
    expect(model.sections[1]!.entries[0]!.children[0]!.text).toBe("Pengelolaan anggaran Rp1,5 miliar — “tepat waktu”");
    expect(model.profile.headline).toBe("Analis Data Senior");
    expect(model.summary).toBe("Ringkasan buatan sendiri");
    expect(model.sections[0]!.heading).toBe("Pengalaman");
  });

  it("never marks an exported entry as deleted", () => {
    const { document, items } = richCv("en");
    const model = buildExportRenderModel(cvExportSnapshotSchema.parse(exportSnapshotFrom(document, items)));
    const entries = model.sections.flatMap((section) => section.entries.flatMap((entry) => [entry, ...entry.children]));
    expect(entries.every((entry) => entry.deleted === false)).toBe(true);
  });

  it("is built from the snapshot alone: a later change of the stored CV does not move it", () => {
    const { document, items } = richCv("en");
    const snapshot = cvExportSnapshotSchema.parse(exportSnapshotFrom(document, items));
    const before = buildExportRenderModel(snapshot);
    items[2] = { ...items[2]!, source_snapshot: achievementSnapshot(uuid(301), { cv_bullet: "WP-LATER-EDIT" }) };
    expect(buildExportRenderModel(snapshot)).toEqual(before);
    expect(JSON.stringify(before)).not.toContain("WP-LATER-EDIT");
  });
});

describe("T21 export name, errors and expiry", () => {
  const snapshotWith = (profile: Record<string, unknown>) =>
    cvExportSnapshotSchema.parse({ ...exportSnapshotFrom(documentRow(), []), profile_snapshot: profile });

  it("prefers the display override and trims blanks to null", () => {
    expect(effectiveExportName(snapshotWith({ display_name: "Ani" }))).toBe("Ani");
    expect(effectiveExportName(snapshotWith({ display_name: "Ani", display_overrides: { display_name: "Nama Tampil" } }))).toBe("Nama Tampil");
    expect(effectiveExportName(snapshotWith({ display_name: "  Ani  " }))).toBe("Ani");
    expect(effectiveExportName(snapshotWith({ display_name: "   " }))).toBeNull();
    expect(effectiveExportName(snapshotWith({}))).toBeNull();
    expect(effectiveExportName(snapshotWith({ display_name: null }))).toBeNull();
  });

  it("treats exactly three worker codes as permanent", () => {
    expect(["EXPORT_SNAPSHOT_INVALID", "EXPORT_TOO_LONG", "ACCOUNT_DELETING"].every(isPermanentExportError)).toBe(true);
    for (const code of ["EXPORT_TIMEOUT", "RENDERER_UNAVAILABLE", "RENDERER_TIMEOUT", "EXPORT_RENDER_INVALID", "STORAGE_UNAVAILABLE", null, "OTHER"]) {
      expect(isPermanentExportError(code)).toBe(false);
    }
  });

  it("reports expiry by clock or by purge, only for a succeeded export", () => {
    const now = new Date("2026-10-06T12:00:00Z");
    const base = { status: "succeeded" as const, expires_at: "2026-10-07T12:00:00Z", purged_at: null };
    expect(isExportExpired(base, now)).toBe(false);
    expect(isExportExpired({ ...base, expires_at: "2026-10-06T12:00:00Z" }, now)).toBe(true);
    expect(isExportExpired({ ...base, expires_at: "2026-10-06T11:59:59Z" }, now)).toBe(true);
    expect(isExportExpired({ ...base, purged_at: "2026-10-06T11:00:00Z" }, now)).toBe(true);
    expect(isExportExpired({ status: "failed", expires_at: null, purged_at: null }, now)).toBe(false);
    expect(isExportExpired({ status: "queued", expires_at: null, purged_at: null }, now)).toBe(false);
    expect(isExportExpired({ ...base, expires_at: "not a date" }, now)).toBe(true);
  });

  it("pins the plan limits", () => {
    expect(CV_EXPORT_MAX_PAGES).toBe(20);
    expect(CV_EXPORT_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(CV_EXPORT_MAX_ATTEMPTS).toBe(3);
    expect(CV_EXPORT_TTL_HOURS).toBe(24);
    expect(CV_EXPORT_DOWNLOAD_TTL_SECONDS).toBe(300);
  });
});
