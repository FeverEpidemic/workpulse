"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { t, type Locale } from "@/i18n/messages";
import { THEME_COOKIE_NAME, type Theme, type ThemePreference } from "@/domain/theme/theme-preference";

const THEME_CHANGE_EVENT = "workpulse:theme-change";

function getThemeSnapshot(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function subscribeToThemeChanges(onChange: () => void): () => void {
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(THEME_CHANGE_EVENT, onChange);
}

export function ThemeToggle({
  locale,
  initialPreference,
}: {
  locale: Locale;
  initialPreference: ThemePreference;
}) {
  const theme = useSyncExternalStore(
    subscribeToThemeChanges,
    getThemeSnapshot,
    () => initialPreference === "dark" ? "dark" : "light",
  );

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = THEME_COOKIE_NAME + "=" + next + "; Path=/; Max-Age=31536000; SameSite=Lax" + secure;
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }

  const label = theme === "dark"
    ? t(locale, "workspace.themeToLight")
    : t(locale, "workspace.themeToDark");

  return (
    <Button
      variant="ghost"
      className="workspace-theme-toggle"
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      aria-pressed={theme === "dark"}
    >
      {theme === "dark"
        ? <Sun size={18} strokeWidth={1.8} aria-hidden="true" />
        : <Moon size={18} strokeWidth={1.8} aria-hidden="true" />}
      <span>{t(locale, theme === "dark" ? "workspace.themeDark" : "workspace.themeLight")}</span>
    </Button>
  );
}
