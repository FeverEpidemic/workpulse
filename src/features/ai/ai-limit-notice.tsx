import type { ReactNode } from "react";

import type { AiUsageBucket, AiUsageWindow } from "@/domain/ai/usage";
import { t, type Locale, type MessageKey } from "@/i18n/messages";

/** True when the next AI request in this bucket would be refused. */
export function isAiLimited(usage: AiUsageWindow | null | undefined): usage is AiUsageWindow & { limitReason: NonNullable<AiUsageWindow["limitReason"]> } {
  return Boolean(usage?.limitReason);
}

/** Reset instant in the profile timezone, so server and client render the same text. */
export function formatAiResetTime(resetsAt: string | null, locale: Locale, timeZone = "UTC"): string {
  if (!resetsAt) return "";
  const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" };
  const tag = locale === "id" ? "id-ID" : "en-GB";
  try {
    return new Intl.DateTimeFormat(tag, { ...options, timeZone }).format(new Date(resetsAt));
  } catch {
    return new Intl.DateTimeFormat(tag, { ...options, timeZone: "UTC", timeZoneName: "short" }).format(new Date(resetsAt));
  }
}

/** Why AI is unavailable right now and when it comes back; the caller places the manual action next to it. */
export function AiLimitNotice({
  locale,
  bucket,
  usage,
  timeZone,
  children,
}: {
  locale: Locale;
  bucket: AiUsageBucket;
  usage: AiUsageWindow & { limitReason: NonNullable<AiUsageWindow["limitReason"]> };
  timeZone?: string;
  children?: ReactNode;
}) {
  const time = formatAiResetTime(usage.resetsAt, locale, timeZone);
  const body: string = usage.limitReason === "capacity"
    ? t(locale, "ai.limit.capacity", { time })
    : t(locale, `ai.limit.${bucket}.${usage.limitReason}` as MessageKey, {
      limit: (usage.limitReason === "daily" ? usage.dayLimit : usage.monthLimit) ?? 0,
      time,
    });
  return (
    <div role="status" className="space-y-1" data-testid="ai-limit-notice">
      <p className="ai-analysis-progress-title">{t(locale, `ai.limit.${bucket}.title` as MessageKey)}</p>
      <p>{body}</p>
      <p className="field-help">{t(locale, `ai.limit.${bucket}.manual` as MessageKey)}</p>
      {children}
    </div>
  );
}
