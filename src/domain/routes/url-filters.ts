import { z } from "zod";

import { decodeActivityCursor } from "@/domain/activity/activity-cursor";
import { isExactActivityDate } from "@/domain/activity/activity-date";

export const activityFilterKeys = ["from", "to", "project"] as const;

export type ActivityFilterKey = (typeof activityFilterKeys)[number];

export interface ActivityFilters {
  from: string;
  to: string;
  project: string;
}

export type ActivityFilterError = "invalid" | "range";

export interface ActivityQueryState {
  filters: ActivityFilters;
  cursor: string;
  errors: Partial<Record<ActivityFilterKey | "cursor", ActivityFilterError>>;
  isValid: boolean;
}

type SearchInput =
  | string
  | URLSearchParams
  | Record<string, string | string[] | undefined>;

const uuidSchema = z.uuid();

function paramsFor(input: SearchInput): URLSearchParams {
  if (input instanceof URLSearchParams) return new URLSearchParams(input.toString());
  if (typeof input === "string") return new URLSearchParams(input.startsWith("?") ? input.slice(1) : input);

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") params.set(key, value);
    else if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    }
  }
  return params;
}

function singleValue(params: URLSearchParams, key: string): { value: string; duplicate: boolean } {
  const values = params.getAll(key);
  return { value: values[0] ?? "", duplicate: values.length > 1 };
}

function cleanProject(value: string): string {
  return value.trim().slice(0, 120);
}

export function readActivityQuery(input: SearchInput): ActivityQueryState {
  const params = paramsFor(input);
  const fromValue = singleValue(params, "from");
  const toValue = singleValue(params, "to");
  const projectValue = singleValue(params, "project");
  const cursorValue = singleValue(params, "cursor");
  const from = fromValue.value.trim();
  const to = toValue.value.trim();
  const project = cleanProject(projectValue.value);
  const errors: ActivityQueryState["errors"] = {};

  if (fromValue.duplicate || (from && !isExactActivityDate(from))) errors.from = "invalid";
  if (toValue.duplicate || (to && !isExactActivityDate(to))) errors.to = "invalid";
  if (projectValue.duplicate || (project && !uuidSchema.safeParse(project).success)) errors.project = "invalid";

  let cursor = cursorValue.value;
  if (cursorValue.duplicate) {
    errors.cursor = "invalid";
    cursor = "";
  } else if (cursor) {
    try {
      decodeActivityCursor(cursor);
    } catch {
      errors.cursor = "invalid";
      cursor = "";
    }
  }

  if (!errors.from && !errors.to && from && to && from > to) errors.to = "range";

  return {
    filters: { from, to, project },
    cursor,
    errors,
    isValid: Object.keys(errors).length === 0,
  };
}

/** Read filter values for call sites that do not need validation feedback. */
export function readActivityFilters(input: SearchInput): ActivityFilters {
  return readActivityQuery(input).filters;
}

export function setActivityFilter(
  input: SearchInput,
  key: ActivityFilterKey,
  value: string | null | undefined,
): string {
  const params = paramsFor(input);
  const normalized = value?.trim() ?? "";

  if (!normalized || ((key === "from" || key === "to") && !isExactActivityDate(normalized))) {
    params.delete(key);
  } else {
    params.set(key, key === "project" ? normalized.slice(0, 120) : normalized);
  }

  return params.toString();
}

export function activityFilterQuery(filters: ActivityFilters): string {
  const params = new URLSearchParams();
  for (const key of activityFilterKeys) {
    const value = filters[key].trim();
    if (value) params.set(key, value);
  }
  return params.toString();
}

export function activityListHref(filters: ActivityFilters, cursor?: string | null): string {
  const params = new URLSearchParams(activityFilterQuery(filters));
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return query ? `/activity?${query}` : "/activity";
}
