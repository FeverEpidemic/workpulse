import * as z from "zod";

import { decodeAchievementCursor } from "@/domain/achievement/achievement-cursor";
import { isExactActivityDate } from "@/domain/activity/activity-date";
import { decodeActivityCursor } from "@/domain/activity/activity-cursor";
import { decodeProjectCursor } from "@/domain/project/project-cursor";

const INTERNAL_ORIGIN = "https://workpulse.invalid";
const SAFE_FALLBACK = "/dashboard";
const MAX_RETURN_TO_LENGTH = 500;
const MAX_NESTED_RETURN_TO_LAYERS = 4;

const APP_PATHS = [
  /^\/dashboard$/,
  /^\/activity(?:\/new|\/[0-9a-f-]{36})?$/i,
  /^\/achievements(?:\/new|\/[0-9a-f-]{36})?$/i,
  /^\/projects(?:\/new|\/[0-9a-f-]{36})?$/i,
  /^\/timeline$/,
  /^\/cv$/,
  /^\/settings\/profile$/,
  /^\/onboarding\/import$/,
];

const QUERY_KEYS: Record<string, ReadonlySet<string>> = {
  "/activity": new Set(["from", "to", "project", "cursor"]),
  "/achievements": new Set(["status", "project", "evidence", "skill", "cursor"]),
  "/projects": new Set(["status", "outcome", "cursor"]),
  "/timeline": new Set(["type", "project"]),
  "/settings/profile": new Set(["mode", "record"]),
};

type RouteKind =
  | "activity-list" | "activity-create" | "activity-detail"
  | "achievement-list" | "achievement-create" | "achievement-detail"
  | "project-list" | "project-create" | "project-detail"
  | "other";

function routeKind(path: string): RouteKind {
  if (path === "/activity") return "activity-list";
  if (path === "/activity/new") return "activity-create";
  if (/^\/activity\/[0-9a-f-]{36}$/i.test(path)) return "activity-detail";
  if (path === "/achievements") return "achievement-list";
  if (path === "/achievements/new") return "achievement-create";
  if (/^\/achievements\/[0-9a-f-]{36}$/i.test(path)) return "achievement-detail";
  if (path === "/projects") return "project-list";
  if (path === "/projects/new") return "project-create";
  if (/^\/projects\/[0-9a-f-]{36}$/i.test(path)) return "project-detail";
  return "other";
}

function allowedQueryKeys(path: string): ReadonlySet<string> {
  const known = QUERY_KEYS[path];
  if (known) return known;
  if (/^\/activity\/(?:new|[0-9a-f-]{36})$/i.test(path)) return new Set(["returnTo"]);
  if (path === "/achievements/new") return new Set(["activity", "project", "returnTo"]);
  if (/^\/achievements\/[0-9a-f-]{36}$/i.test(path)) return new Set(["returnTo"]);
  if (/^\/projects\/(?:new|[0-9a-f-]{36})$/i.test(path)) return new Set(["returnTo"]);
  return new Set();
}

function queryValueLimit(key: string): number {
  if (key === "returnTo") return MAX_RETURN_TO_LENGTH;
  if (key === "cursor") return 256;
  return 120;
}

function isActivityBackTarget(kind: RouteKind): boolean {
  return kind === "activity-list" || kind === "achievement-detail" || kind === "project-detail";
}

function isAchievementBackTarget(kind: RouteKind): boolean {
  return kind === "achievement-list" || kind === "achievement-detail" || kind === "activity-list"
    || kind === "activity-detail" || kind === "project-detail";
}

function nestedTargetAllowed(parent: RouteKind, child: RouteKind): boolean {
  if (parent === "activity-create" || parent === "activity-detail") return isActivityBackTarget(child);
  if (parent === "achievement-create" || parent === "achievement-detail") return isAchievementBackTarget(child);
  if (parent === "project-create" || parent === "project-detail") return child === "project-list";
  return false;
}

function canonicalizeReturnTo(value: string | null | undefined, nestedLayers = 0): string | null {
  if (
    !value ||
    value.length > MAX_RETURN_TO_LENGTH ||
    value !== value.trim() ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /%(?![0-9a-f]{2})/i.test(value) ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return null;
  }

  const rawPath = value.split(/[?#]/, 1)[0];
  if (!rawPath || rawPath.includes("%") || rawPath.split("/").some((part) => part === "." || part === "..")) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(value, INTERNAL_ORIGIN);
  } catch {
    return null;
  }

  if (url.origin !== INTERNAL_ORIGIN || url.username || url.password || url.hash || url.pathname !== rawPath) {
    return null;
  }
  if (!APP_PATHS.some((path) => path.test(url.pathname))) return null;

  const kind = routeKind(url.pathname);
  const allowedKeys = allowedQueryKeys(url.pathname);
  const safeQuery = new URLSearchParams();
  let sourceCount = 0;
  for (const [key, queryValue] of url.searchParams) {
    if (
      !allowedKeys.has(key) ||
      safeQuery.has(key) ||
      queryValue.length > queryValueLimit(key) ||
      /[\u0000-\u001f\u007f]/.test(queryValue)
    ) {
      return null;
    }
    if (key === "mode" && queryValue !== "onboarding") return null;
    if (key === "record" && !z.uuid().safeParse(queryValue).success) return null;
    if ((key === "activity" || key === "project") && kind === "achievement-create") {
      sourceCount += 1;
      if (!z.uuid().safeParse(queryValue).success) return null;
    }
    if (key === "returnTo") {
      if (nestedLayers >= MAX_NESTED_RETURN_TO_LAYERS) return null;
      const nested = canonicalizeReturnTo(queryValue, nestedLayers + 1);
      if (!nested || !nestedTargetAllowed(kind, routeKind(nested.split("?", 1)[0] ?? ""))) return null;
      safeQuery.set(key, nested);
    } else {
      safeQuery.set(key, queryValue);
    }
  }
  if (kind === "achievement-create" && sourceCount > 1) return null;

  const from = safeQuery.get("from");
  const to = safeQuery.get("to");
  if (from && to && from > to) return null;

  if (url.pathname === "/activity") {
    if ((from && !isExactActivityDate(from)) || (to && !isExactActivityDate(to))) return null;
    const project = safeQuery.get("project");
    if (project && !z.uuid().safeParse(project).success) return null;
    const cursor = safeQuery.get("cursor");
    if (cursor) {
      try { decodeActivityCursor(cursor); } catch { return null; }
    }
  }

  if (url.pathname === "/projects") {
    const status = safeQuery.get("status");
    if (status && !["planned", "active", "completed"].includes(status)) return null;
    const outcome = safeQuery.get("outcome");
    if (outcome && outcome !== "missing") return null;
    const cursor = safeQuery.get("cursor");
    if (cursor) {
      try { decodeProjectCursor(cursor); } catch { return null; }
    }
  }

  if (url.pathname === "/achievements") {
    const status = safeQuery.get("status");
    if (status && !["draft", "confirmed", "dismissed"].includes(status)) return null;
    const project = safeQuery.get("project");
    if (project && !z.uuid().safeParse(project).success) return null;
    const evidence = safeQuery.get("evidence");
    if (evidence && evidence !== "missing") return null;
    const skill = safeQuery.get("skill");
    if (skill && !z.uuid().safeParse(skill).success) return null;
    const cursor = safeQuery.get("cursor");
    if (cursor) {
      try { decodeAchievementCursor(cursor); } catch { return null; }
    }
  }

  if (url.pathname === "/timeline") {
    const type = safeQuery.get("type");
    if (type && !["experience", "education", "project", "achievement"].includes(type)) return null;
    const project = safeQuery.get("project");
    if (project && !z.uuid().safeParse(project).success) return null;
  }

  const query = safeQuery.toString();
  const canonical = query ? `${url.pathname}?${query}` : url.pathname;
  return canonical.length <= MAX_RETURN_TO_LENGTH ? canonical : null;
}

/** Accept only known WorkPulse route shapes and at most four nested returnTo values. */
export function sanitizeReturnTo(value: string | null | undefined): string {
  return canonicalizeReturnTo(value) ?? SAFE_FALLBACK;
}

/** A caller-supplied Activity back destination may be a list, Project, or Achievement detail. */
export function sanitizeActivityReturnTo(value: string | null | undefined): string {
  if (!value) return "/activity";
  const safe = canonicalizeReturnTo(value);
  return safe && isActivityBackTarget(routeKind(safe.split("?", 1)[0] ?? "")) ? safe : "/activity";
}

/** Accept only a Project list destination. */
export function sanitizeProjectReturnTo(value: string | null | undefined): string {
  if (!value) return "/projects";
  const safe = canonicalizeReturnTo(value);
  return safe && routeKind(safe.split("?", 1)[0] ?? "") === "project-list" ? safe : "/projects";
}

/** Accept an Achievement list or a bounded career-record destination. */
export function sanitizeAchievementReturnTo(value: string | null | undefined): string {
  if (!value) return "/achievements";
  const safe = canonicalizeReturnTo(value);
  return safe && isAchievementBackTarget(routeKind(safe.split("?", 1)[0] ?? "")) ? safe : "/achievements";
}

/** Accept a Project detail destination for Activity -> Project navigation. */
export function sanitizeProjectDetailReturnTo(value: string | null | undefined, projectId?: string): string {
  const fallback = projectId && z.uuid().safeParse(projectId).success ? `/projects/${projectId}` : "/projects";
  if (!value) return fallback;
  const safe = canonicalizeReturnTo(value);
  return safe && routeKind(safe.split("?", 1)[0] ?? "") === "project-detail" ? safe : fallback;
}

export const DEFAULT_RETURN_TO = SAFE_FALLBACK;
