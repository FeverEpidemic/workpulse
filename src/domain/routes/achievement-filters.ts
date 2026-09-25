import * as z from "zod";

import { decodeAchievementCursor } from "@/domain/achievement/achievement-cursor";
import { ACHIEVEMENT_STATUSES, type AchievementStatus } from "@/domain/achievement/contracts";

export const achievementFilterKeys = ["status", "project"] as const;
export type AchievementFilterKey = (typeof achievementFilterKeys)[number];

export interface AchievementFilters {
  status: AchievementStatus | "";
  project: string;
}

export interface AchievementQueryState {
  filters: AchievementFilters;
  cursor: string;
  errors: Partial<Record<AchievementFilterKey | "cursor", "invalid">>;
  isValid: boolean;
}

type SearchInput = string | URLSearchParams | Record<string, string | string[] | undefined>;

function paramsFor(input: SearchInput): URLSearchParams {
  if (input instanceof URLSearchParams) return new URLSearchParams(input.toString());
  if (typeof input === "string") return new URLSearchParams(input.startsWith("?") ? input.slice(1) : input);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") params.set(key, value);
    else if (Array.isArray(value)) value.forEach((item) => params.append(key, item));
  }
  return params;
}

function singleValue(params: URLSearchParams, key: string): { value: string; duplicate: boolean } {
  const values = params.getAll(key);
  return { value: values[0] ?? "", duplicate: values.length > 1 };
}

export function readAchievementQuery(input: SearchInput): AchievementQueryState {
  const params = paramsFor(input);
  const statusValue = singleValue(params, "status");
  const projectValue = singleValue(params, "project");
  const cursorValue = singleValue(params, "cursor");
  const errors: AchievementQueryState["errors"] = {};
  const status = statusValue.value.trim();
  const project = projectValue.value.trim();
  if (statusValue.duplicate || (status && !ACHIEVEMENT_STATUSES.includes(status as AchievementStatus))) errors.status = "invalid";
  if (projectValue.duplicate || (project && !z.uuid().safeParse(project).success)) errors.project = "invalid";
  let cursor = cursorValue.value;
  if (cursorValue.duplicate) {
    errors.cursor = "invalid";
    cursor = "";
  } else if (cursor) {
    try { decodeAchievementCursor(cursor); } catch { errors.cursor = "invalid"; cursor = ""; }
  }
  return {
    filters: {
      status: errors.status ? "" : (status as AchievementStatus | ""),
      project: errors.project ? "" : project,
    },
    cursor,
    errors,
    isValid: Object.keys(errors).length === 0,
  };
}

export function achievementListHref(filters: AchievementFilters, cursor?: string | null): string {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.project) params.set("project", filters.project);
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return query ? `/achievements?${query}` : "/achievements";
}

