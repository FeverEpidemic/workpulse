import { cookies } from "next/headers";

import { parseLocale, type Locale } from "@/i18n/messages";

export async function persistLocaleCookie(locale: Locale): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set("wp-locale", parseLocale(locale), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
