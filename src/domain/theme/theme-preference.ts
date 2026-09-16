export type Theme = "light" | "dark";
export type ThemePreference = Theme | "system";

export const THEME_COOKIE_NAME = "wp-theme";

export function parseThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function resolveTheme(preference: ThemePreference, systemTheme: Theme): Theme {
  return preference === "system" ? systemTheme : preference;
}
