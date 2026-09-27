import type { AchievementRow } from "@/domain/achievement/contracts";
import type { EducationRow, ExperienceRow, ProjectRow } from "@/domain/database-types";

export const TIMELINE_EVENT_TYPES = ["experience", "education", "project", "achievement"] as const;
export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number];
export type TimelinePrecision = "year" | "month" | "day";
export const TIMELINE_SOURCE_LIMIT = 500;

export interface TimelineDate {
  date: string;
  precision: TimelinePrecision;
}

export interface TimelineEvent {
  type: TimelineEventType;
  id: string;
  title: string;
  context: string | null;
  anchor: TimelineDate | null;
  start: TimelineDate | null;
  end: TimelineDate | null;
  isCurrent: boolean;
  projectId: string | null;
  href: string;
}

export interface TimelineGroup {
  key: string;
  year: number | null;
  events: TimelineEvent[];
}

export interface TimelineSources {
  experiences: Pick<ExperienceRow, "id" | "organization" | "role_title" | "start_date" | "start_precision" | "end_date" | "end_precision" | "is_current">[];
  education: Pick<EducationRow, "id" | "institution" | "qualification" | "start_date" | "start_precision" | "end_date" | "end_precision" | "is_current">[];
  projects: Pick<ProjectRow, "id" | "title" | "experience_id" | "start_date" | "start_precision" | "end_date" | "end_precision" | "is_current">[];
  achievements: Pick<AchievementRow, "id" | "title" | "status" | "achieved_on" | "project_id" | "experience_id">[];
}

const TYPE_ORDER: Record<TimelineEventType, number> = {
  achievement: 0,
  project: 1,
  experience: 2,
  education: 3,
};

const PRECISION_ORDER: Record<TimelinePrecision, number> = {
  day: 3,
  month: 2,
  year: 1,
};

function partialDate(date: string | null, precision: string | null): TimelineDate | null {
  if (!date || (precision !== "year" && precision !== "month" && precision !== "day")) return null;
  return { date, precision };
}

function experienceContext(experience: TimelineSources["experiences"][number] | undefined): string | null {
  return experience ? `${experience.role_title} · ${experience.organization}` : null;
}

function compareDatedEvents(left: TimelineEvent, right: TimelineEvent): number {
  const dateOrder = (right.anchor?.date ?? "").localeCompare(left.anchor?.date ?? "");
  if (dateOrder) return dateOrder;
  const precisionOrder = (PRECISION_ORDER[right.anchor?.precision ?? "year"] ?? 0)
    - (PRECISION_ORDER[left.anchor?.precision ?? "year"] ?? 0);
  if (precisionOrder) return precisionOrder;
  const typeOrder = TYPE_ORDER[left.type] - TYPE_ORDER[right.type];
  return typeOrder || left.id.localeCompare(right.id, "en");
}

function compareUndatedEvents(left: TimelineEvent, right: TimelineEvent): number {
  const typeOrder = TYPE_ORDER[left.type] - TYPE_ORDER[right.type];
  if (typeOrder) return typeOrder;
  const titleOrder = left.title.localeCompare(right.title, "en");
  return titleOrder || left.id.localeCompare(right.id, "en");
}

export function timelineHref(type: TimelineEventType, id: string): string {
  if (type === "experience") return `/settings/profile?record=${id}#experience-${id}`;
  if (type === "education") return `/settings/profile?record=${id}#education-${id}`;
  if (type === "project") return `/projects/${id}`;
  return `/achievements/${id}`;
}

export function buildTimelineEvents(sources: TimelineSources): TimelineEvent[] {
  const experienceById = new Map(sources.experiences.map((experience) => [experience.id, experience]));
  const projectById = new Map(sources.projects.map((project) => [project.id, project]));
  const events: TimelineEvent[] = [];

  for (const experience of sources.experiences) {
    const start = partialDate(experience.start_date, experience.start_precision);
    events.push({
      type: "experience",
      id: experience.id,
      title: experience.role_title,
      context: experience.organization,
      anchor: start,
      start,
      end: partialDate(experience.end_date, experience.end_precision),
      isCurrent: experience.is_current,
      projectId: null,
      href: timelineHref("experience", experience.id),
    });
  }

  for (const education of sources.education) {
    const start = partialDate(education.start_date, education.start_precision);
    events.push({
      type: "education",
      id: education.id,
      title: education.qualification,
      context: education.institution,
      anchor: start,
      start,
      end: partialDate(education.end_date, education.end_precision),
      isCurrent: education.is_current,
      projectId: null,
      href: timelineHref("education", education.id),
    });
  }

  for (const project of sources.projects) {
    const start = partialDate(project.start_date, project.start_precision);
    events.push({
      type: "project",
      id: project.id,
      title: project.title,
      context: experienceContext(project.experience_id ? experienceById.get(project.experience_id) : undefined),
      anchor: start,
      start,
      end: partialDate(project.end_date, project.end_precision),
      isCurrent: project.is_current,
      projectId: project.id,
      href: timelineHref("project", project.id),
    });
  }

  for (const achievement of sources.achievements) {
    if (achievement.status !== "confirmed" || !achievement.achieved_on) continue;
    const project = achievement.project_id ? projectById.get(achievement.project_id) : undefined;
    const experience = achievement.experience_id ? experienceById.get(achievement.experience_id) : undefined;
    const date: TimelineDate = { date: achievement.achieved_on, precision: "day" };
    events.push({
      type: "achievement",
      id: achievement.id,
      title: achievement.title ?? "",
      context: project?.title ?? experienceContext(experience),
      anchor: date,
      start: date,
      end: null,
      isCurrent: false,
      projectId: achievement.project_id,
      href: timelineHref("achievement", achievement.id),
    });
  }

  return events;
}

export function filterTimelineEvents(
  events: TimelineEvent[],
  filters: { type: TimelineEventType | ""; project: string },
): TimelineEvent[] {
  return events.filter((event) =>
    (!filters.type || event.type === filters.type)
    && (!filters.project || event.projectId === filters.project));
}

export function groupTimelineEvents(events: TimelineEvent[]): TimelineGroup[] {
  const dated = new Map<number, TimelineEvent[]>();
  const undated: TimelineEvent[] = [];

  for (const event of events) {
    const yearText = event.anchor?.date.slice(0, 4);
    const year = yearText && /^\d{4}$/.test(yearText) ? Number(yearText) : null;
    if (year === null) undated.push(event);
    else dated.set(year, [...(dated.get(year) ?? []), event]);
  }

  const groups: TimelineGroup[] = [...dated.entries()]
    .sort(([left], [right]) => right - left)
    .map(([year, groupEvents]) => ({
      key: String(year),
      year,
      events: groupEvents.sort(compareDatedEvents),
    }));
  if (undated.length) groups.push({ key: "undated", year: null, events: undated.sort(compareUndatedEvents) });
  return groups;
}
