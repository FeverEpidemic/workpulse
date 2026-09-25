import type { Locale } from "@/i18n/messages";
import type { ProjectRow } from "@/domain/database-types";

function dateFromCanonical(value: string): Date {
  const parts = value.split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1] ?? 1);
  const day = Number(parts[2] ?? 1);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(12, 0, 0, 0);
  return date;
}

export function formatProjectDatePart(
  date: string | null,
  precision: string | null,
  locale: Locale,
): string | null {
  if (!date || !precision) return null;
  if (precision === "year") return date.slice(0, 4);
  const formatted = new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-US", {
    month: "short",
    ...(precision === "day" ? { day: "numeric" } : {}),
    year: "numeric",
    timeZone: "UTC",
  }).format(dateFromCanonical(date));
  return formatted;
}

export function formatProjectDateRange(project: Pick<ProjectRow, "start_date" | "start_precision" | "end_date" | "end_precision" | "is_current">, locale: Locale, notSetLabel: string, presentLabel: string): string {
  const start = formatProjectDatePart(project.start_date, project.start_precision, locale);
  const end = project.is_current
    ? presentLabel
    : formatProjectDatePart(project.end_date, project.end_precision, locale);
  if (!start && !end) return notSetLabel;
  if (!start) return end ?? notSetLabel;
  if (!end) return start;
  return `${start} – ${end}`;
}

export function projectExperienceLabel(
  experience: { role_title: string; organization: string } | null,
  independentLabel: string,
): string {
  return experience ? `${experience.role_title} · ${experience.organization}` : independentLabel;
}

export function projectNeedsOutcome(project: Pick<ProjectRow, "status" | "outcome">): boolean {
  return project.status === "completed" && !project.outcome;
}
