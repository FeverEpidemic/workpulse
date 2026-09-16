"use client";

import { saveLocalePreference } from "@/server/locale/actions";
import { t, type Locale } from "@/i18n/messages";

export function LocaleSwitcher({ locale }: { locale: Locale }) {
  return (
    <form key={locale} action={saveLocalePreference} className="flex items-end gap-2">
      <label className="text-sm font-medium">
        {t(locale, "onboarding.language")}
        <select className="field-input mt-1" name="locale" defaultValue={locale}>
          <option value="en">English</option>
          <option value="id">Bahasa Indonesia</option>
        </select>
      </label>
      <button type="submit" className="button-secondary">{t(locale, "onboarding.saveLanguage")}</button>
    </form>
  );
}
