import * as z from "zod";

import { decodeProjectCursor } from "@/domain/project/project-cursor";
import { PROJECT_STATUSES, type ProjectStatus } from "@/domain/project/contracts";

export interface ProjectFilters {
  status: ProjectStatus | "";
}

export interface ProjectQuery {
  filters: ProjectFilters;
  cursor: string;
  errors: {
    status?: "invalid";
    cursor?: "invalid";
    unknown?: boolean;
  };
  isValid: boolean;
}

function oneValue(params: Record<string, string | string[] | undefined>, key: string): { value: string; duplicate: boolean; present: boolean } {
  const raw = params[key];
  if (Array.isArray(raw)) return { value: raw[0] ?? "", duplicate: raw.length !== 1, present: true };
  return { value: raw ?? "", duplicate: false, present: raw !== undefined };
}

export function readProjectQuery(params: Record<string, string | string[] | undefined>): ProjectQuery {
  const statusValue = oneValue(params, "status");
  const cursorValue = oneValue(params, "cursor");
  const known = new Set(["status", "cursor"]);
  const unknown = Object.keys(params).some((key) => !known.has(key));
  const status = PROJECT_STATUSES.includes(statusValue.value as ProjectStatus) ? statusValue.value as ProjectStatus : "";
  const errors: ProjectQuery["errors"] = {
    ...(statusValue.duplicate || (statusValue.present && statusValue.value !== "" && !PROJECT_STATUSES.includes(statusValue.value as ProjectStatus)) ? { status: "invalid" as const } : {}),
    ...(cursorValue.duplicate ? { cursor: "invalid" as const } : {}),
    ...(unknown ? { unknown: true } : {}),
  };
  if (cursorValue.present && cursorValue.value) {
    try {
      decodeProjectCursor(cursorValue.value);
    } catch {
      errors.cursor = "invalid";
    }
  }
  return {
    filters: { status },
    cursor: cursorValue.present ? cursorValue.value : "",
    errors,
    isValid: Object.keys(errors).length === 0,
  };
}

export function projectFilterQuery(filters: ProjectFilters, cursor?: string): string {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

export function projectListHref(filters: ProjectFilters, cursor?: string): string {
  const query = projectFilterQuery(filters, cursor);
  return query ? `/projects?${query}` : "/projects";
}

export function isProjectStatus(value: string): value is ProjectStatus {
  return z.enum(PROJECT_STATUSES).safeParse(value).success;
}
