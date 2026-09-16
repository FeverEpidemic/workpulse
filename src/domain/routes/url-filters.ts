export const activityFilterKeys = ["from", "to", "project"] as const;

export type ActivityFilterKey = (typeof activityFilterKeys)[number];

export interface ActivityFilters {
  from: string;
  to: string;
  project: string;
}

type SearchInput =
  | string
  | URLSearchParams
  | Record<string, string | string[] | undefined>;

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

function isCalendarDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= (monthDays[month - 1] ?? 0);
}

function cleanProject(value: string | null): string {
  return value?.trim().slice(0, 120) ?? "";
}

export function readActivityFilters(input: SearchInput): ActivityFilters {
  const params = paramsFor(input);
  const from = params.get("from");
  const to = params.get("to");
  return {
    from: isCalendarDate(from) ? from : "",
    to: isCalendarDate(to) ? to : "",
    project: cleanProject(params.get("project")),
  };
}

export function setActivityFilter(
  input: SearchInput,
  key: ActivityFilterKey,
  value: string | null | undefined,
): string {
  const params = paramsFor(input);
  const normalized = value?.trim() ?? "";

  if (!normalized || ((key === "from" || key === "to") && !isCalendarDate(normalized))) {
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
