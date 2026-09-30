import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { sanitizeReturnTo } from "@/domain/routes/safe-return";
import { getSupabasePublicConfig, getTrustedSiteUrl } from "@/server/supabase/config";
import type { Database } from "@/server/supabase/database.types";

const protectedPaths = [
  "/dashboard",
  "/onboarding",
  "/imports",
  "/settings",
  "/activity",
  "/achievements",
  "/projects",
  "/timeline",
  "/cv",
];

function isProtectedPath(pathname: string): boolean {
  return protectedPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function copyCookies(from: NextResponse, to: NextResponse): void {
  for (const cookie of from.cookies.getAll()) to.cookies.set(cookie);
}

export async function proxy(request: NextRequest) {
  const config = getSupabasePublicConfig();
  if (!config) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const supabase = createServerClient<Database>(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  let hasVerifiedClaims = false;
  try {
    const { data, error } = await supabase.auth.getClaims();
    hasVerifiedClaims = !error && Boolean(data?.claims?.sub);
  } catch {
    // Authorization is checked again in Server Components and Server Actions.
    return response;
  }

  // Server Actions must return an in-place UNAUTHENTICATED result so forms can
  // keep their draft. Only document navigations receive an optimistic redirect.
  if (request.method !== "GET" && request.method !== "HEAD") return response;
  if (!isProtectedPath(request.nextUrl.pathname) || hasVerifiedClaims) return response;

  const returnTo = sanitizeReturnTo(`${request.nextUrl.pathname}${request.nextUrl.search}`);
  const signInUrl = new URL("/sign-in", getTrustedSiteUrl());
  if (returnTo !== "/dashboard") signInUrl.searchParams.set("returnTo", returnTo);
  const redirect = NextResponse.redirect(signInUrl);
  copyCookies(response, redirect);
  return redirect;
}

export const config = {
  matcher: [
    "/",
    "/sign-in",
    "/auth/:path*",
    "/update-password",
    "/onboarding/:path*",
    "/imports/:path*",
    "/dashboard/:path*",
    "/settings/:path*",
    "/activity/:path*",
    "/achievements/:path*",
    "/projects/:path*",
    "/timeline/:path*",
    "/cv/:path*",
  ],
};
