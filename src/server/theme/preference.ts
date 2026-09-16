import { cookies } from "next/headers";

import { parseThemePreference, THEME_COOKIE_NAME } from "@/domain/theme/theme-preference";

export async function getThemePreference() {
  const cookieStore = await cookies();
  return parseThemePreference(cookieStore.get(THEME_COOKIE_NAME)?.value);
}
