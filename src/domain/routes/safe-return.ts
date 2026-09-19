import { isExactActivityDate } from "@/domain/activity/activity-date";
import { decodeActivityCursor } from "@/domain/activity/activity-cursor";
import * as z from "zod";

const INTERNAL_ORIGIN = "https://workpulse.invalid";
const SAFE_FALLBACK = "/dashboard";

const APP_PATHS = [
  /^\/dashboard$/,
  /^\/activity(?:\/new|\/[0-9a-f-]{36})?$/i,
  /^\/achievements(?:\/[0-9a-f-]{36})?$/i,
  /^\/projects(?:\/[0-9a-f-]{36})?$/i,
  /^\/timeline$/,
  /^\/cv$/,
  /^\/settings\/profile$/,
  /^\/onboarding\/import$/,
];

const QUERY_KEYS: Record<string, ReadonlySet<string>> = {
  "/activity": new Set(["from", "to", "project", "cursor"]),
  "/achievements": new Set(["status", "q"]),
  "/projects": new Set(["status", "q"]),
  "/settings/profile": new Set(["mode"]),
};

function allowedQueryKeys(path: string): ReadonlySet<string> {
  const known = QUERY_KEYS[path];
  if (known) return known;
  if (/^\/activity\/(?:new|[0-9a-f-]{36})$/i.test(path)) return new Set(["returnTo"]);
  return new Set();
}

function queryValueLimit(key: string): number {
  if (key === "returnTo") return 500;
  if (key === "cursor") return 256;
  return 120;
}

/** Accept only known WorkPulse route shapes and small, route-specific query sets. */
export function sanitizeReturnTo(value: string | null | undefined): string {
  if (
    !value ||
    value.length > 500 ||
    value !== value.trim() ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /%(?![0-9a-f]{2})/i.test(value) ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return SAFE_FALLBACK;
  }

  const rawPath = value.split(/[?#]/, 1)[0];
  if (!rawPath || rawPath.includes("%") || rawPath.split("/").some((part) => part === "." || part === "..")) {
    return SAFE_FALLBACK;
  }

  let url: URL;
  try {
    url = new URL(value, INTERNAL_ORIGIN);
  } catch {
    return SAFE_FALLBACK;
  }

  if (url.origin !== INTERNAL_ORIGIN || url.username || url.password || url.hash || url.pathname !== rawPath) {
    return SAFE_FALLBACK;
  }

  const isAllowedPath = APP_PATHS.some((path) => path.test(url.pathname));
  if (!isAllowedPath) return SAFE_FALLBACK;

  const allowedKeys = allowedQueryKeys(url.pathname);
  const safeQuery = new URLSearchParams();
  for (const [key, queryValue] of url.searchParams) {
    if (
      !allowedKeys.has(key) ||
      safeQuery.has(key) ||
      queryValue.length > queryValueLimit(key) ||
      /[\u0000-\u001f\u007f]/.test(queryValue)
    ) {
      return SAFE_FALLBACK;
    }
    if (key === "mode" && queryValue !== "onboarding") return SAFE_FALLBACK;
    safeQuery.set(key, key === "returnTo" ? sanitizeActivityReturnTo(queryValue) : queryValue);
  }

  const from = safeQuery.get("from");
  const to = safeQuery.get("to");
  if (from && to && from > to) return SAFE_FALLBACK;
  if (url.pathname === "/activity") {
    if ((from && !isExactActivityDate(from)) || (to && !isExactActivityDate(to))) return SAFE_FALLBACK;
    const project = safeQuery.get("project");
    if (project && !z.uuid().safeParse(project).success) return SAFE_FALLBACK;
    const cursor = safeQuery.get("cursor");
    if (cursor) {
      try {
        decodeActivityCursor(cursor);
      } catch {
        return SAFE_FALLBACK;
      }
    }
  }

  const query = safeQuery.toString();
  return query ? `${url.pathname}?${query}` : url.pathname;
}

/** A caller-supplied back destination must stay within the Activity list. */
export function sanitizeActivityReturnTo(value: string | null | undefined): string {
  if (!value) return "/activity";
  const safe = sanitizeReturnTo(value);
  return safe === "/activity" || safe.startsWith("/activity?") ? safe : "/activity";
}

export const DEFAULT_RETURN_TO = SAFE_FALLBACK;
