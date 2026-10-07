import type { CvItemRow, CvLocale, CvSectionKey } from "@/domain/cv/contracts";
import { buildExportRenderModel, cvExportSnapshotSchema } from "@/domain/cv/export";
import type { CvPreviewEntry, CvPreviewModel } from "@/domain/cv/preview";

import {
  achievementSnapshot,
  documentRow,
  educationSnapshot,
  exportSnapshotFrom,
  experienceSnapshot,
  itemRow,
  projectSnapshot,
  skillSnapshot,
  uuid,
} from "../unit/cv-fixtures";

/** A value that must only ever appear in the owner's own CV (never in a response meant for someone else). */
export const SENTINEL = "WP-PRIVATE-CV-SENTINEL-3f6c1a90";
export const CREDENTIAL_URL = "https://credential.example/verify/abc123-credential";

export interface PdfFixture {
  name: string;
  locale: CvLocale;
  model: CvPreviewModel;
  /** Strings that must be printed (also checked as a whole, in order, by printedStrings). */
  mustPrint: string[];
  /** Strings that must never appear in the PDF. */
  mustNotPrint: string[];
}

/** The same path as the worker: saved CV rows -> snapshot -> render model (T21). */
function fromRows(document: ReturnType<typeof documentRow>, items: readonly CvItemRow[]): CvPreviewModel {
  return buildExportRenderModel(cvExportSnapshotSchema.parse(exportSnapshotFrom(document, items)));
}

const none = { start_date: null, start_precision: null, end_date: null, end_precision: null, is_current: false };

const WORDS = {
  en: "The team delivered measurable results for customers while keeping the cost of the programme under control and documenting every decision for the next group of colleagues".split(" "),
  id: "Tim berhasil memberikan hasil yang terukur bagi pelanggan sambil menjaga biaya program tetap terkendali dan mendokumentasikan setiap keputusan untuk kelompok rekan berikutnya".split(" "),
};

/** A bullet of at least `length` characters that starts with START-<tag> and ends with END-<tag>. */
export function longBullet(tag: string, locale: CvLocale, length = 640): string {
  const words = WORDS[locale];
  let text = `START-${tag}`;
  for (let index = 0; text.length < length; index += 1) text += ` ${words[index % words.length]}`;
  return `${text} END-${tag}`;
}

/** The rich CV of the plan's fixture list: overlapping and unknown dates, contextual and standalone achievements, overrides. */
export function ownerA(locale: CvLocale): PdfFixture {
  const exp = { current: uuid(110), older: uuid(111), unknown: uuid(112), yearOnly: uuid(113) };
  const project = uuid(120);
  const bullet = "Pengelolaan anggaran Rp1,5 miliar — “tepat waktu”";
  const document = documentRow({
    locale,
    title: `CV ${SENTINEL}`,
    summary_override: `Ringkasan profil dengan aksara Ç Ñ ś ñ dan kutip “melengkung”. ${SENTINEL}`,
    profile_snapshot: {
      schema_version: "cv-profile.v1", display_name: "Siti Nurhaliza Ç. Ñuñez", headline: "Analis Data", summary: null,
      contact_email: "siti@example.com", phone: "+62 812 0000 1111", location: "Jakarta", website: null,
      display_overrides: { headline: "Analis Data Senior", website: "https://siti.example.com" },
    },
  });
  const items = [
    itemRow(uuid(1), "experience", 1, experienceSnapshot(exp.current, {
      organization: "PT Magang Maju", role_title: "Analis Data", description: "Menyusun laporan mingguan.", start_date: "2023-03-01", start_precision: "month", is_current: true,
    })),
    // Overlaps the role above (Jun 2022 - Jan 2024 against Mar 2023 - present).
    itemRow(uuid(2), "experience", 2, experienceSnapshot(exp.older, {
      organization: "CV Lama Sejahtera", role_title: "Staf Operasional", description: null, start_date: "2022-06-01", start_precision: "month", end_date: "2024-01-01", end_precision: "month", is_current: false,
    })),
    // Nothing is known about the dates: no placeholder may be printed.
    itemRow(uuid(3), "experience", 3, experienceSnapshot(exp.unknown, {
      organization: "Komunitas Relawan", role_title: "Relawan", kind: "volunteer", description: "Mengajar membaca.", ...none,
    })),
    itemRow(uuid(4), "experience", 4, experienceSnapshot(exp.yearOnly, {
      organization: "Koperasi Tani", role_title: "Asisten", description: null, start_date: "2019-01-01", start_precision: "year", end_date: "2020-01-01", end_precision: "year", is_current: false,
    })),
    itemRow(uuid(5), "projects", 1, projectSnapshot(project, {
      title: "Sistem Antrian Digital", description: "Aplikasi antrian untuk puskesmas.", user_role: "Pengembang", experience_id: exp.current,
      start_date: "2023-04-01", start_precision: "month", end_date: null, end_precision: null, is_current: false,
    })),
    itemRow(uuid(6), "achievements", 1, achievementSnapshot(uuid(301), { title: "Anggaran tepat waktu", cv_bullet: bullet, project_id: project, achieved_on: "2023-11-20" })),
    itemRow(uuid(7), "achievements", 2, achievementSnapshot(uuid(302), { title: "Efisiensi antrian", cv_bullet: "Teks sumber yang digantikan", project_id: project, achieved_on: "2024-02-02" }), {
      override_text: `Bullet yang ditulis ulang pengguna. ${SENTINEL}`,
    }),
    itemRow(uuid(8), "achievements", 3, achievementSnapshot(uuid(303), { title: "Juara lomba data", cv_bullet: "Meraih juara kedua lomba analisis data tingkat kota.", achieved_on: "2022-08-17" })),
    itemRow(uuid(9), "education", 1, educationSnapshot(uuid(201), { start_date: "2019-01-01", start_precision: "year", end_date: "2023-01-01", end_precision: "year" })),
    itemRow(uuid(10), "skills", 1, skillSnapshot(uuid(401), "SQL")),
    itemRow(uuid(11), "certifications", 1, {
      schema_version: "cv-source.v1", source_type: "certification", source_id: uuid(501), name: "Sertifikasi Analis Data",
      issuer: "Badan Sertifikasi Contoh", issued_date: "2024-05-01", issued_precision: "month", credential_url: CREDENTIAL_URL,
    }),
  ];
  const model = fromRows(document, items);
  return {
    name: `owner A (${locale})`, locale, model,
    mustPrint: ["Siti Nurhaliza Ç. Ñuñez", "Analis Data Senior", "https://siti.example.com", bullet, `Bullet yang ditulis ulang pengguna. ${SENTINEL}`, "SQL", "Sertifikasi Analis Data"],
    mustNotPrint: [CREDENTIAL_URL, "credential.example", "Teks sumber yang digantikan", "Present Present", ...items.map((item) => item.id)],
  };
}

/** At least twelve achievements with bullets of 600+ characters and one project longer than a page (it may split). */
export function ownerLong(locale: CvLocale): PdfFixture {
  const experience = uuid(110);
  const bigProject = uuid(120);
  const document = documentRow({
    locale, title: "CV panjang",
    profile_snapshot: { schema_version: "cv-profile.v1", display_name: "Budi Santoso", headline: "Manajer Program", summary: null, contact_email: "budi@example.com", phone: null, location: "Bandung", website: null },
    summary_override: longBullet("SUMMARY", locale, 420),
  });
  const items: CvItemRow[] = [
    itemRow(uuid(1), "experience", 1, experienceSnapshot(experience, { organization: "PT Program Besar", role_title: "Manajer Program", description: longBullet("EXPDESC", locale, 700), start_date: "2018-01-01", start_precision: "year", is_current: true })),
    itemRow(uuid(2), "projects", 1, projectSnapshot(bigProject, { title: "Program Transformasi Digital", description: "Program multi-tahun.", user_role: "Pemimpin", experience_id: experience, ...none })),
  ];
  // Twelve standalone achievements: every one fits a page and has a bullet of 600+ characters.
  for (let index = 1; index <= 12; index += 1) {
    items.push(itemRow(uuid(30 + index), "achievements", index, achievementSnapshot(uuid(700 + index), { title: `Pencapaian ${index}`, cv_bullet: longBullet(`A${index}`, locale), achieved_on: "2024-03-10" })));
  }
  // The big project: 26 child achievements with long bullets make a single entry that is longer than a page.
  for (let index = 1; index <= 26; index += 1) {
    items.push(itemRow(uuid(60 + index), "achievements", 20 + index, achievementSnapshot(uuid(800 + index), { title: `Hasil program ${index}`, cv_bullet: longBullet(`P${index}`, locale), project_id: bigProject, achieved_on: "2024-06-01" })));
  }
  // Print order: the project (projects section) comes before the standalone achievements.
  const mustPrint = [...Array.from({ length: 26 }, (_, index) => longBullet(`P${index + 1}`, locale)), ...Array.from({ length: 12 }, (_, index) => longBullet(`A${index + 1}`, locale))];
  return { name: `owner A long (${locale})`, locale, model: fromRows(document, items), mustPrint, mustNotPrint: [] };
}

/** A graduate: no experience, an education record, an academic project and one confirmed achievement. */
export function graduate(): PdfFixture {
  const project = uuid(120);
  const document = documentRow({
    locale: "id", title: "CV Ani",
    profile_snapshot: { schema_version: "cv-profile.v1", display_name: "Ani Lestari", headline: null, summary: null, contact_email: "ani@example.com", phone: null, location: null, website: null },
  });
  const items = [
    itemRow(uuid(1), "education", 1, educationSnapshot(uuid(201))),
    itemRow(uuid(2), "projects", 1, projectSnapshot(project, { title: "Skripsi Sistem Antrian", description: "Penelitian tentang antrian pelayanan.", user_role: "Peneliti", ...none })),
    itemRow(uuid(3), "achievements", 1, achievementSnapshot(uuid(301), { title: "Hasil skripsi", cv_bullet: "Mengurangi waktu tunggu simulasi antrian sebesar 18 persen.", project_id: project, achieved_on: "2023-07-01" })),
  ];
  return { name: "graduate (id)", locale: "id", model: fromRows(document, items), mustPrint: ["Ani Lestari", "Skripsi Sistem Antrian", "Mengurangi waktu tunggu simulasi antrian sebesar 18 persen."], mustNotPrint: ["Pengalaman"] };
}

export const NON_LATIN_NAMES = [
  { script: "Han", name: "李小龙" },
  { script: "Arabic", name: "محمد عبدالله" },
  { script: "Devanagari", name: "प्रिया शर्मा" },
] as const;

/** A small CV whose owner has a name in another script (decision 0027, N4). */
export function nonLatinName(name: string): PdfFixture {
  const document = documentRow({
    locale: "en", title: "CV",
    profile_snapshot: { schema_version: "cv-profile.v1", display_name: name, headline: null, summary: null, contact_email: null, phone: null, location: null, website: null },
  });
  const items = [itemRow(uuid(1), "education", 1, educationSnapshot(uuid(201))), itemRow(uuid(2), "achievements", 1, achievementSnapshot(uuid(301), { title: "Result", cv_bullet: "Improved a process by 12 percent." }))];
  return { name: `name ${name}`, locale: "en", model: fromRows(document, items), mustPrint: [], mustNotPrint: [] };
}

// --- Page break sweep ----------------------------------------------------------------------------------------------

export const SWEEP_SECTIONS = ["Experience", "Projects", "Education", "Selected achievements"] as const;
const TAGS = ["EA", "PB", "ED", "AC"] as const;

function sweepEntry(id: string, headline: string, subline: string | null, text: string | null, children: CvPreviewEntry[] = []): CvPreviewEntry {
  return { itemId: id, type: "experience", headline, subline, dates: "2021 – 2023", text, deleted: false, hasOverride: false, children };
}

/**
 * A model that is built directly (it exercises the template, not the model): a summary of `lines` short lines pushes four
 * sections of tagged entries through the bottom of the pages. Every line of every entry starts with its tag, so the
 * analysis can say which entry a line belongs to without guessing from the layout.
 */
export function sweepModel(lines: number): CvPreviewModel {
  const entries = (tag: string, count: number) => Array.from({ length: count }, (_, index) => {
    const id = `${tag}${index}`;
    return sweepEntry(id, `${id} Judul entri`, `${id} Organisasi`, `${id} deskripsi satu baris`, [
      sweepEntry(`${id}c1`, `${id}c1 child`, null, `${id}c1 bullet pendek`),
      sweepEntry(`${id}c2`, `${id}c2 child`, null, `${id}c2 bullet pendek`),
    ]);
  });
  const counts = [2, 3, 2, 3];
  return {
    title: "Sweep", locale: "en",
    profile: { display_name: "Ani Contoh", headline: "Analis", contact_email: "ani@example.com", phone: null, location: null, website: null },
    summary: Array.from({ length: lines }, (_, index) => `Baris ringkasan ${index + 1}`).join("\n"),
    sections: SWEEP_SECTIONS.map((heading, index) => ({ key: (["experience", "projects", "education", "achievements"] as const)[index] as CvSectionKey, heading, entries: entries(TAGS[index]!, counts[index]!) })),
  };
}

export const SWEEP_TAG_PATTERN = /^((?:EA|PB|ED|AC)\d+)(c\d)? /;
export const SWEEP_HEADING_PATTERN = /^(?:(?:EA|PB|ED|AC)\d+(?:c\d)? (?:Judul entri|child))$/;
