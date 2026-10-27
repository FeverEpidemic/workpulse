import type { Locale } from "@/i18n/messages";

export interface DatePartOption {
  value: string;
  label: string;
}

/** Month choices for partial-date selects; values match what `normalizePartialDate` parses. */
export function monthOptions(locale: Locale): DatePartOption[] {
  const format = new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-US", { month: "long", timeZone: "UTC" });
  return Array.from({ length: 12 }, (_, index) => ({
    value: String(index + 1),
    label: format.format(new Date(Date.UTC(2000, index, 1))),
  }));
}

export const DAY_OPTIONS: DatePartOption[] = Array.from({ length: 31 }, (_, index) => ({
  value: String(index + 1),
  label: String(index + 1),
}));
