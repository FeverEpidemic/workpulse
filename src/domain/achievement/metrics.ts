import * as z from "zod";

import { ACHIEVEMENT_FIELD_LIMITS, type AchievementMetric } from "@/domain/achievement/contracts";

const finiteNumber = z.number().finite();

export const achievementMetricSchema = z.object({
  label: z.string().trim().min(1).max(ACHIEVEMENT_FIELD_LIMITS.metricLabel),
  value: finiteNumber,
  unit: z.string().trim().min(1).max(ACHIEVEMENT_FIELD_LIMITS.metricUnit),
  baseline: finiteNumber.optional(),
  period: z.string().trim().min(1).max(ACHIEVEMENT_FIELD_LIMITS.metricPeriod).optional(),
}).strict();

export const achievementMetricsSchema = z.array(achievementMetricSchema).max(ACHIEVEMENT_FIELD_LIMITS.metrics);

export function parseAchievementMetrics(value: unknown): AchievementMetric[] {
  const parsed = achievementMetricsSchema.parse(value);
  const bytes = new TextEncoder().encode(JSON.stringify(parsed)).byteLength;
  if (bytes > 20 * 1024) throw new Error("metrics_payload_too_large");
  return parsed;
}
