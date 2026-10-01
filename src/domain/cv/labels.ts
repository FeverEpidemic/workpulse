import type { CvLocale, CvSectionKey } from "./contracts.ts";

/**
 * Labels and date formats of the CV itself. They follow the CV locale, never the UI locale, and never
 * translate source content (decision 0025).
 */
export const CV_LABELS: Record<CvLocale, { sections: Record<CvSectionKey, string>; present: string }> = {
  en: {
    sections: {
      experience: "Experience",
      projects: "Projects",
      achievements: "Achievements",
      education: "Education",
      skills: "Skills",
      certifications: "Certifications",
    },
    present: "Present",
  },
  id: {
    sections: {
      experience: "Pengalaman",
      projects: "Proyek",
      achievements: "Pencapaian",
      education: "Pendidikan",
      skills: "Keahlian",
      certifications: "Sertifikasi",
    },
    present: "Sekarang",
  },
};

const INTL_LOCALE: Record<CvLocale, string> = { en: "en-US", id: "id-ID" };
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Formats a stored date at its precision; unknown or missing dates give null (no placeholder).
 * Dates are calendar dates: they are formatted in UTC so the day never shifts with a time zone.
 */
export function formatCvPartialDate(date: string | null, precision: string | null, locale: CvLocale): string | null {
  if (!date || !precision || precision === "unknown") return null;
  const match = ISO_DATE.exec(date);
  if (!match) return null;
  const value = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(value.getTime())) return null;
  const intl = INTL_LOCALE[locale];
  switch (precision) {
    case "year": return String(value.getUTCFullYear());
    case "month": return new Intl.DateTimeFormat(intl, { month: "short", year: "numeric", timeZone: "UTC" }).format(value);
    case "day": return new Intl.DateTimeFormat(intl, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(value);
    default: return null;
  }
}

export interface CvDateRangeInput {
  start_date: string | null;
  start_precision: string | null;
  end_date: string | null;
  end_precision: string | null;
  is_current: boolean;
}

/** "Mar 2023 – Present", "2019 – 2023", a single known bound, or null when nothing is known. */
export function formatCvDateRange(item: CvDateRangeInput, locale: CvLocale): string | null {
  const start = formatCvPartialDate(item.start_date, item.start_precision, locale);
  const end = item.is_current ? CV_LABELS[locale].present : formatCvPartialDate(item.end_date, item.end_precision, locale);
  if (start && end) return `${start} – ${end}`;
  return start ?? end;
}
