// Reference mapping mirrored by apply_ai_suggestion in supabase/migrations/20260929090000_t14_ai_review.sql
// (internal.ai_apply_metrics + the insert/update statements). Exercised as a spec by unit
// tests; the SQL is the actual authority, integration tests prove SQL === this mapping.

import type { DetectResult } from "./detect-result.ts";

export interface DraftMetric {
  label: string;
  value: number;
  unit: string;
  baseline?: number;
}

export interface DraftFields {
  title: string;
  contribution: string;
  scope: string | null;
  outcome: string;
  cvBullet: string;
  achievedOn: string;
  metrics: DraftMetric[];
}

/** suggestion.role is intentionally never applied: the Achievement table has no role column. */
export function suggestionToDraftFields(result: DetectResult, activity: { occurredOn: string }): DraftFields {
  if (!result.suggestion) throw new Error("suggestionToDraftFields requires a potential result with a suggestion");
  const { title, contribution, scope, outcome, cv_bullet, metrics } = result.suggestion;
  return {
    title,
    contribution,
    scope,
    outcome,
    cvBullet: cv_bullet,
    achievedOn: activity.occurredOn,
    metrics: metrics.map((metric) =>
      metric.baseline === null
        ? { label: metric.label, value: metric.value, unit: metric.unit }
        : { label: metric.label, value: metric.value, unit: metric.unit, baseline: metric.baseline }),
  };
}
