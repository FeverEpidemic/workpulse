import * as z from "zod";

import { TIMELINE_EVENT_TYPES, type TimelineEventType } from "@/domain/timeline/timeline";

export interface TimelineFilters {
  type: TimelineEventType | "";
  project: string;
}

export interface TimelineQuery {
  filters: TimelineFilters;
  errors: Partial<Record<"type" | "project", "invalid">>;
  isValid: boolean;
}

function oneValue(params: Record<string, string | string[] | undefined>, key: string): { value: string; duplicate: boolean; present: boolean } {
  const raw = params[key];
  if (Array.isArray(raw)) return { value: raw[0] ?? "", duplicate: raw.length !== 1, present: true };
  return { value: raw ?? "", duplicate: false, present: raw !== undefined };
}

export function readTimelineQuery(params: Record<string, string | string[] | undefined>): TimelineQuery {
  const typeValue = oneValue(params, "type");
  const projectValue = oneValue(params, "project");
  const type = TIMELINE_EVENT_TYPES.includes(typeValue.value as TimelineEventType) ? typeValue.value as TimelineEventType : "";
  const project = projectValue.value;
  const errors: TimelineQuery["errors"] = {
    ...(typeValue.duplicate || (typeValue.present && typeValue.value !== "" && !TIMELINE_EVENT_TYPES.includes(typeValue.value as TimelineEventType)) ? { type: "invalid" as const } : {}),
    ...(projectValue.duplicate || (projectValue.present && project !== "" && !z.uuid().safeParse(project).success) ? { project: "invalid" as const } : {}),
  };
  return {
    filters: {
      type: errors.type ? "" : type,
      project: errors.project ? "" : project,
    },
    errors,
    isValid: Object.keys(errors).length === 0,
  };
}

export function timelineListHref(filters: TimelineFilters): string {
  const params = new URLSearchParams();
  if (filters.type) params.set("type", filters.type);
  if (filters.project) params.set("project", filters.project);
  const query = params.toString();
  return query ? `/timeline?${query}` : "/timeline";
}
