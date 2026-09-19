import type { ExperienceRow, ProjectRow } from "@/domain/database-types";
import { isExactActivityDate } from "@/domain/activity/activity-date";
import type { Locale } from "@/i18n/messages";

export type ActivityExperienceOption = Pick<ExperienceRow, "id" | "organization" | "role_title">;
export type ActivityProjectOption = Pick<ProjectRow, "id" | "title" | "experience_id">;

export interface ActivityContextOptions {
  experiences: ActivityExperienceOption[];
  projects: ActivityProjectOption[];
}

export interface ActivityContextPresentation {
  projectLabel: string | null;
  experienceLabel: string | null;
  projectUnavailable: boolean;
  experienceUnavailable: boolean;
}

/** Format a calendar date using UTC so its day never shifts with the machine timezone. */
export function formatActivityDate(value: string, locale: Locale): string {
  if (!isExactActivityDate(value)) return value;
  const [yearText, monthText, dayText] = value.split("-");
  const date = new Date(0);
  date.setUTCFullYear(Number(yearText), Number(monthText) - 1, Number(dayText));
  date.setUTCHours(12, 0, 0, 0);
  return new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** Collapse whitespace for a list preview without changing canonical source text. */
export function activityExcerpt(rawText: string, maxCodePoints = 180): string {
  const compact = rawText.replace(/\s+/gu, " ").trim();
  const characters = Array.from(compact);
  if (characters.length <= maxCodePoints) return compact;
  return characters.slice(0, Math.max(0, maxCodePoints)).join("").trimEnd() + "…";
}

export function resolveActivityContext(
  record: { project_id: string | null; experience_id: string | null },
  options: ActivityContextOptions,
): ActivityContextPresentation {
  const project = record.project_id
    ? options.projects.find((item) => item.id === record.project_id)
    : undefined;
  const experience = record.experience_id
    ? options.experiences.find((item) => item.id === record.experience_id)
    : undefined;

  return {
    projectLabel: project?.title ?? null,
    experienceLabel: experience ? `${experience.role_title} · ${experience.organization}` : null,
    projectUnavailable: Boolean(record.project_id && !project),
    experienceUnavailable: Boolean(record.experience_id && !experience),
  };
}

export function projectExperienceId(
  projectId: string,
  projects: readonly ActivityProjectOption[],
): string | null | undefined {
  return projects.find((project) => project.id === projectId)?.experience_id;
}
