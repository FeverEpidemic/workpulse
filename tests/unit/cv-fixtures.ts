import type { CvItemRow, CvDocumentRow, CvSectionKey, CvSourceSnapshot } from "@/domain/cv/contracts";
import type { CvExportSnapshot } from "@/domain/cv/export";

export const ORDER: CvSectionKey[] = ["experience", "projects", "achievements", "education", "skills", "certifications"];
export const USER = "11111111-1111-4111-8111-111111111111";
export const CV = "22222222-2222-4222-8222-222222222222";

export function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

export function documentRow(overrides: Partial<CvDocumentRow> = {}): CvDocumentRow {
  return {
    id: CV, user_id: USER, title: "Master CV", locale: "en", template_key: "single_column_v1", summary_override: null,
    profile_snapshot: { schema_version: "cv-profile.v1", display_name: "Ani Contoh", headline: "Graduate", summary: "Source summary", contact_email: "ani@example.com", phone: null, location: null, website: null },
    profile_source_revision: 1, profile_ack_revision: null, section_order: ORDER,
    created_at: "2026-10-03T00:00:00Z", updated_at: "2026-10-03T00:00:00Z", revision: 1,
    ...overrides,
  };
}

const dates = { start_date: null, start_precision: null, end_date: null, end_precision: null, is_current: false };

export function itemRow(id: string, section: CvSectionKey, position: number, snapshot: CvSourceSnapshot, overrides: Partial<CvItemRow> = {}): CvItemRow {
  return {
    id, user_id: USER, cv_id: CV, section_key: section, position,
    experience_id: null, project_id: null, achievement_id: null, education_id: null, skill_id: null, certification_id: null,
    source_snapshot: snapshot, source_revision: 1, override_text: null, acknowledged_revision: null, source_deleted: false,
    created_at: "2026-10-03T00:00:00Z", updated_at: "2026-10-03T00:00:00Z", revision: 1,
    ...overrides,
  };
}

export const educationSnapshot = (sourceId: string, over: Partial<Extract<CvSourceSnapshot, { source_type: "education" }>> = {}): CvSourceSnapshot => ({
  schema_version: "cv-source.v1", source_type: "education", source_id: sourceId, institution: "Universitas Contoh", qualification: "S1",
  field_of_study: "Informatika", description: null, ...dates, start_date: "2019-01-01", start_precision: "year", end_date: "2023-01-01", end_precision: "year", ...over,
});

export const projectSnapshot = (sourceId: string, over: Partial<Extract<CvSourceSnapshot, { source_type: "project" }>> = {}): CvSourceSnapshot => ({
  schema_version: "cv-source.v1", source_type: "project", source_id: sourceId, title: "Skripsi Sistem Antrian", description: "Deskripsi skripsi",
  user_role: "Peneliti", outcome: null, status: "completed", ...dates, experience_id: null, ...over,
});

export const experienceSnapshot = (sourceId: string, over: Partial<Extract<CvSourceSnapshot, { source_type: "experience" }>> = {}): CvSourceSnapshot => ({
  schema_version: "cv-source.v1", source_type: "experience", source_id: sourceId, organization: "PT Magang", role_title: "Analis", kind: "internship",
  description: "Deskripsi magang", ...dates, start_date: "2023-03-01", start_precision: "month", is_current: true, ...over,
});

export const achievementSnapshot = (
  sourceId: string,
  over: Partial<Extract<CvSourceSnapshot, { source_type: "achievement" }>> = {},
): CvSourceSnapshot => ({
  schema_version: "cv-source.v1", source_type: "achievement", source_id: sourceId, title: `Title ${sourceId.slice(-3)}`, cv_bullet: `Bullet ${sourceId.slice(-3)}`,
  achieved_on: "2023-05-10", experience_id: null, project_id: null, ...over,
});

export const skillSnapshot = (sourceId: string, name = "SQL"): CvSourceSnapshot => ({ schema_version: "cv-source.v1", source_type: "skill", source_id: sourceId, name });

export const certificationSnapshot = (sourceId: string): CvSourceSnapshot => ({
  schema_version: "cv-source.v1", source_type: "certification", source_id: sourceId, name: "Sertifikat", issuer: null, issued_date: null, issued_precision: null, credential_url: null,
});

/** A graduate's CV: education, a project with one child achievement, a standalone achievement, and a skill. */
export function graduateItems(): CvItemRow[] {
  const project = uuid(101);
  return [
    itemRow(uuid(1), "education", 1, educationSnapshot(uuid(201))),
    itemRow(uuid(2), "projects", 1, projectSnapshot(project)),
    itemRow(uuid(3), "achievements", 1, achievementSnapshot(uuid(301), { project_id: project })),
    itemRow(uuid(4), "achievements", 2, achievementSnapshot(uuid(302))),
    itemRow(uuid(5), "skills", 1, skillSnapshot(uuid(401))),
  ];
}

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Mirrors internal.cv_export_snapshot(): the saved CV as stored, items by section, position and id (T21). */
export function exportSnapshotFrom(document: CvDocumentRow, items: readonly CvItemRow[]): CvExportSnapshot {
  const sorted = [...items].sort((a, b) => compareText(a.section_key, b.section_key) || a.position - b.position || compareText(a.id, b.id));
  return {
    schema_version: "cv-export.v1",
    template_key: document.template_key,
    locale: document.locale,
    title: document.title,
    cv_id: document.id,
    cv_revision: document.revision,
    section_order: document.section_order,
    profile_snapshot: document.profile_snapshot,
    summary_override: document.summary_override,
    items: sorted.map((item) => ({
      id: item.id, section_key: item.section_key, position: item.position, source_snapshot: item.source_snapshot, override_text: item.override_text,
    })),
  };
}