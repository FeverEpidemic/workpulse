"use server";

import { parseLocale } from "@/i18n/messages";
import { persistLocaleCookie } from "@/server/locale/cookie";

export async function saveLocalePreference(formData: FormData): Promise<void> {
  const localeValue = formData.get("locale");
  if (localeValue !== "en" && localeValue !== "id") return;

  await persistLocaleCookie(parseLocale(localeValue));
}
