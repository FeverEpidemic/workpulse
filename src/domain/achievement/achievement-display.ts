import type { Locale } from "@/i18n/messages";
import type { AchievementRow } from "@/domain/achievement/contracts";

export function achievementStatusLabel(status: AchievementRow["status"], locale: Locale): string {
  if (locale === "id") return status === "confirmed" ? "Terkonfirmasi" : status === "dismissed" ? "Disisihkan" : "Draf";
  return status === "confirmed" ? "Confirmed" : status === "dismissed" ? "Dismissed" : "Draft";
}

export function achievementOutcomeExcerpt(outcome: string | null, fallback: string): string {
  const value = outcome?.trim();
  if (!value) return fallback;
  return value.length > 160 ? `${value.slice(0, 157)}…` : value;
}

export function achievementDateLabel(value: string | null, fallback: string): string {
  return value ?? fallback;
}

