export interface SupabasePublicConfig {
  url: string;
  publishableKey: string;
}

export interface SupabaseAdminConfig {
  url: string;
  secretKey: string;
}

export class SupabaseConfigurationError extends Error {
  constructor() {
    super("Supabase server configuration is missing or invalid");
    this.name = "SupabaseConfigurationError";
  }
}

export function getSupabasePublicConfig(): SupabasePublicConfig | null {
  const rawUrl = process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!rawUrl || !publishableKey) return null;

  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    return { url: parsed.origin, publishableKey };
  } catch {
    return null;
  }
}

/** Return credentials for a server-only Supabase client. */
export function getSupabaseAdminConfig(): SupabaseAdminConfig | null {
  const rawUrl = process.env.SUPABASE_URL?.trim();
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!rawUrl || !secretKey) return null;

  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return { url: parsed.origin, secretKey };
  } catch {
    return null;
  }
}

export function getTrustedSiteUrl(): string {
  const configured = process.env.WORKPULSE_SITE_URL;
  const value = configured || (process.env.NODE_ENV === "production" ? "" : "http://127.0.0.1:3000");
  if (!value) throw new SupabaseConfigurationError();

  try {
    const parsed = new URL(value);
    const isLocal = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      (parsed.protocol !== "https:" && !(isLocal && parsed.protocol === "http:"))
    ) {
      throw new SupabaseConfigurationError();
    }
    return parsed.origin;
  } catch {
    throw new SupabaseConfigurationError();
  }
}

export function getAuthCallbackUrl(): string {
  return new URL("/auth/confirm", getTrustedSiteUrl()).toString();
}
