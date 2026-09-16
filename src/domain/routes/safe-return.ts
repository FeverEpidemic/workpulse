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
  "/activity": new Set(["from", "to", "project", "q"]),
  "/achievements": new Set(["status", "q"]),
  "/projects": new Set(["status", "q"]),
  "/settings/profile": new Set(["mode"]),
};

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

  const allowedKeys = QUERY_KEYS[url.pathname] ?? new Set<string>();
  const safeQuery = new URLSearchParams();
  for (const [key, queryValue] of url.searchParams) {
    if (
      !allowedKeys.has(key) ||
      safeQuery.has(key) ||
      queryValue.length > 120 ||
      /[\u0000-\u001f\u007f]/.test(queryValue)
    ) {
      return SAFE_FALLBACK;
    }
    if (key === "mode" && queryValue !== "onboarding") return SAFE_FALLBACK;
    safeQuery.set(key, queryValue);
  }

  const query = safeQuery.toString();
  return query ? `${url.pathname}?${query}` : url.pathname;
}

export const DEFAULT_RETURN_TO = SAFE_FALLBACK;
