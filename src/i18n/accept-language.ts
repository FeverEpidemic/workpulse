import type { Locale } from "@/i18n/messages";

const MAX_HEADER_LENGTH = 1024;

/**
 * T32 first-visit locale: `id` when the browser's most preferred language is Indonesian
 * (`id`, or the legacy `in`), otherwise `en`. Malformed input never throws.
 */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  if (!header) return "en";

  let best: { tag: string; q: number } | null = null;
  for (const part of header.slice(0, MAX_HEADER_LENGTH).split(",")) {
    const [rawTag, ...params] = part.split(";");
    const tag = (rawTag ?? "").trim().toLowerCase();
    if (!/^(\*|[a-z]{1,8}(-[a-z0-9]{1,8})*)$/.test(tag)) continue;

    let q = 1;
    const qParam = params.map((param) => param.trim()).find((param) => param.toLowerCase().startsWith("q="));
    if (qParam) {
      const value = qParam.slice(2);
      if (!/^(0(\.\d{0,3})?|1(\.0{0,3})?)$/.test(value)) continue;
      q = Number(value);
    }
    if (q <= 0) continue;
    if (!best || q > best.q) best = { tag, q };
  }

  const primary = best?.tag.split("-")[0];
  return primary === "id" || primary === "in" ? "id" : "en";
}
