import type { cookies } from "next/headers";

export function clearAuthCookies(cookieStore: Awaited<ReturnType<typeof cookies>>): void {
  for (const cookie of cookieStore.getAll()) {
    if (cookie.name.startsWith("sb-") && cookie.name.includes("auth-token")) {
      cookieStore.delete(cookie.name);
    }
  }
  cookieStore.set("wp-recovery-flow", "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}
