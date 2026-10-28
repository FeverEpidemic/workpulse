import type { ActivityContextOptions } from "@/domain/activity/activity-display";
import type { ActivityListItem } from "@/domain/activity/contracts";
import { CV_LABELS, formatCvDateRange } from "@/domain/cv/labels";
import type { CvPreviewModel } from "@/domain/cv/preview";
import type { Locale } from "@/i18n/messages";

// Fictional persona and companies ("PT Contoh ...", "Universitas Contoh"); approved in docs/marketing/landing-copy-v1.md.
const copy = {
  en: {
    project: "Warehouse returns",
    note: "Checked returns with the warehouse team. Many were cut-off address labels.",
    savedAsWritten: "Activity · saved as written",
    connector: "AI suggests an achievement",
    aiBadge: "AI suggestion",
    reviewBadge: "Needs your review",
    approved: "Approved",
    confirm: "Confirm",
    editFirst: "Edit first",
    achievementTitle: "Root-cause analysis of shipping returns",
    contributionLabel: "Contribution",
    contribution: "Traced return data with the warehouse team and found a pattern of address labels cut off at printing.",
    outcomeLabel: "Outcome",
    outcome: "A new label template was proposed to the supervisor and tried on one packing line.",
    cvLineLabel: "CV line",
    cvLine: "Analysed shipping return data and proposed a fix to the address label template with the warehouse team.",
    source: "Original note: “Checked returns with the warehouse team…”",
    draftBadge: "AI suggestion · draft",
    confirmAchievement: "Confirm achievement",
    quickLog: "Quick log",
    fieldLabel: "What did you work on?",
    quickNote: "Met the courier vendor about delivery SLAs outside Java. I put together last month's customer complaints for the discussion.",
    quickMeta: "Today · Warehouse returns",
    save: "Save activity",
    headline: "Operations Analyst · Surabaya",
    roleNow: "Operations Analyst",
    rolePrev: "Data Entry Staff",
    complaints: "Put together customer complaints as input for the courier vendor SLA review.",
    degree: "Bachelor of Management",
    downloadPdf: "Download PDF",
    importFile: "old-CV.pdf · read without AI",
    keep: "Keep",
    skip: "Skip",
    educationKind: "Education",
  },
  id: {
    project: "Retur Gudang",
    note: "Cek data retur bareng tim gudang. Banyak yang balik karena label alamat kepotong.",
    savedAsWritten: "Activity · disimpan apa adanya",
    connector: "AI usulin achievement",
    aiBadge: "Usulan AI",
    reviewBadge: "Perlu kamu cek",
    approved: "Disetujui",
    confirm: "Konfirmasi",
    editFirst: "Edit dulu",
    achievementTitle: "Analisis penyebab retur pengiriman",
    contributionLabel: "Kontribusi",
    contribution: "Menelusuri data retur bersama tim gudang dan menemukan pola label alamat yang terpotong saat dicetak.",
    outcomeLabel: "Hasil",
    outcome: "Template label baru diusulkan ke supervisor dan diuji di satu lini packing.",
    cvLineLabel: "Kalimat CV",
    cvLine: "Menganalisis data retur pengiriman dan mengusulkan perbaikan template label alamat bersama tim gudang.",
    source: "Catatan asli: “Cek data retur bareng tim gudang…”",
    draftBadge: "Usulan AI · draf",
    confirmAchievement: "Konfirmasi achievement",
    quickLog: "Quick log",
    fieldLabel: "Kamu ngerjain apa?",
    quickNote: "Rapat sama vendor kurir soal SLA pengiriman luar Jawa. Aku bikin rekap keluhan pelanggan sebulan terakhir buat bahan diskusi.",
    quickMeta: "Hari ini · Retur Gudang",
    save: "Simpan activity",
    headline: "Operations Analyst · Surabaya",
    roleNow: "Operations Analyst",
    rolePrev: "Staf Data Entry",
    complaints: "Menyusun rekap keluhan pelanggan sebagai bahan evaluasi SLA vendor kurir.",
    degree: "S1 Manajemen",
    downloadPdf: "Unduh PDF",
    importFile: "CV-lama.pdf · dibaca tanpa AI",
    keep: "Simpan",
    skip: "Lewati",
    educationKind: "Pendidikan",
  },
} as const;

const PERSONA = "Rani Prameswari";
const COMPANY_NOW = "PT Contoh Logistik";
const COMPANY_PREV = "PT Contoh Niaga";
const UNIVERSITY = "Universitas Contoh";
const PROJECT_ID = "00000000-0000-4000-8000-000000000002";

export function landingSample(locale: Locale) {
  const text = copy[locale];
  const activity: ActivityListItem = {
    id: "00000000-0000-4000-8000-000000000001",
    user_id: "00000000-0000-4000-8000-000000000000",
    raw_text: text.note,
    occurred_on: "2025-08-14",
    capture_mode: "note",
    role: null,
    scope: null,
    outcome: null,
    experience_id: null,
    project_id: PROJECT_ID,
    analysis_state: "done",
    revision: 1,
    created_at: "2025-08-14T10:00:00Z",
    updated_at: "2025-08-14T10:00:00Z",
  };
  const activityOptions: ActivityContextOptions = {
    experiences: [],
    projects: [{ id: PROJECT_ID, title: text.project, experience_id: null }],
  };
  const labels = CV_LABELS[locale];
  const cv: CvPreviewModel = {
    title: PERSONA,
    locale,
    profile: { display_name: PERSONA, headline: text.headline, contact_email: null, phone: null, location: null, website: null },
    summary: null,
    sections: [
      {
        key: "experience",
        heading: labels.sections.experience,
        entries: [
          {
            itemId: "cv-1", type: "experience", headline: text.roleNow, subline: COMPANY_NOW, deleted: false, hasOverride: false,
            dates: formatCvDateRange({ start_date: "2024-01-01", start_precision: "month", end_date: null, end_precision: null, is_current: true }, locale),
            text: null,
            children: [
              { itemId: "cv-1a", type: "achievement", headline: text.cvLine, subline: null, dates: null, text: null, deleted: false, hasOverride: false, children: [] },
              { itemId: "cv-1b", type: "achievement", headline: text.complaints, subline: null, dates: null, text: null, deleted: false, hasOverride: false, children: [] },
            ],
          },
          {
            itemId: "cv-2", type: "experience", headline: text.rolePrev, subline: COMPANY_PREV, deleted: false, hasOverride: false,
            dates: formatCvDateRange({ start_date: "2022-01-01", start_precision: "year", end_date: "2023-01-01", end_precision: "year", is_current: false }, locale),
            text: null, children: [],
          },
        ],
      },
      {
        key: "education",
        heading: labels.sections.education,
        entries: [
          { itemId: "cv-3", type: "education", headline: text.degree, subline: UNIVERSITY, dates: null, text: null, deleted: false, hasOverride: false, children: [] },
        ],
      },
    ],
  };
  const imported = [
    { title: text.rolePrev, detail: `${COMPANY_PREV} · 2022 – 2023` },
    { title: text.degree, detail: `${UNIVERSITY} · ${text.educationKind}` },
  ];
  return {
    hero: { activity, activityOptions, note: text.note, savedAsWritten: text.savedAsWritten, connector: text.connector, aiBadge: text.aiBadge, reviewBadge: text.reviewBadge, approved: text.approved, title: text.achievementTitle, contribution: text.contribution },
    review: {
      badge: text.draftBadge, title: text.achievementTitle, source: text.source, confirm: text.confirmAchievement, editFirst: text.editFirst,
      fields: [
        { label: text.contributionLabel, value: text.contribution },
        { label: text.outcomeLabel, value: text.outcome },
        { label: text.cvLineLabel, value: text.cvLine },
      ],
    },
    quickLog: { title: text.quickLog, fieldLabel: text.fieldLabel, note: text.quickNote, meta: text.quickMeta, save: text.save },
    cv,
    downloadPdf: text.downloadPdf,
    importExample: { file: text.importFile, keep: text.keep, skip: text.skip, rows: imported },
  };
}

export type LandingSample = ReturnType<typeof landingSample>;
