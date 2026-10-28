"use client";

import { saveLocalePreference } from "@/server/locale/actions";
import { t, type Locale } from "@/i18n/messages";

const OPTIONS: { value: Locale; short: string; key: "landing.locale.id" | "landing.locale.en" }[] = [
  { value: "id", short: "ID", key: "landing.locale.id" },
  { value: "en", short: "EN", key: "landing.locale.en" },
];

/** Two submit buttons on the existing locale action, so switching also works before hydration. */
export function LocaleToggle({ locale }: { locale: Locale }) {
  return (
    <form action={saveLocalePreference} className="landing-locale" role="group" aria-label={t(locale, "landing.locale.label")} data-active={locale}>
      <span className="landing-locale-indicator" aria-hidden="true" />
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="submit"
          name="locale"
          value={option.value}
          lang={option.value}
          aria-label={t(option.value, option.key)}
          aria-pressed={locale === option.value}
          className="landing-locale-option"
        >
          {option.short}
        </button>
      ))}
    </form>
  );
}
