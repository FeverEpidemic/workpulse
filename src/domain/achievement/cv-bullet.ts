import { ACHIEVEMENT_FIELD_LIMITS } from "@/domain/achievement/contracts";

export type FactualCvBulletResult =
  | { status: "empty"; value: null }
  | { status: "ok"; value: string }
  | { status: "too_long"; value: string };

function endsWithPunctuation(value: string): boolean {
  return /\p{P}$/u.test(value);
}

/**
 * Joins only the user's contribution and outcome. It deliberately does not
 * infer impact, numbers, causality, seniority, or a new language.
 */
export function buildFactualCvBullet(contribution: string | null | undefined, outcome: string | null | undefined): FactualCvBulletResult {
  const normalizedContribution = contribution?.trim() ?? "";
  const normalizedOutcome = outcome?.trim() ?? "";
  if (!normalizedContribution && !normalizedOutcome) return { status: "empty", value: null };
  if (!normalizedOutcome || normalizedOutcome === normalizedContribution) {
    if (normalizedContribution.length === 0) return { status: "empty", value: null };
    return normalizedContribution.length <= ACHIEVEMENT_FIELD_LIMITS.cvBullet
      ? { status: "ok", value: normalizedContribution }
      : { status: "too_long", value: normalizedContribution };
  }
  if (!normalizedContribution) {
    return normalizedOutcome.length <= ACHIEVEMENT_FIELD_LIMITS.cvBullet
      ? { status: "ok", value: normalizedOutcome }
      : { status: "too_long", value: normalizedOutcome };
  }

  const value = `${normalizedContribution}${endsWithPunctuation(normalizedContribution) ? " " : ". "}${normalizedOutcome}`;
  return value.length <= ACHIEVEMENT_FIELD_LIMITS.cvBullet
    ? { status: "ok", value }
    : { status: "too_long", value };
}

