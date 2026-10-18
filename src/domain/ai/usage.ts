// Shared by the web app and the worker; keep imports relative (no "@/" alias).
import * as z from "zod";

/** Must match internal.charge_ai_usage(); raised when a request would queue a provider attempt. */
export const AI_USAGE_ERROR_CODES = ["AI_QUOTA_EXCEEDED", "AI_CAPACITY_EXCEEDED"] as const;
export type AiUsageErrorCode = (typeof AI_USAGE_ERROR_CODES)[number];

export const AI_USAGE_BUCKETS = ["analysis", "import"] as const;
export type AiUsageBucket = (typeof AI_USAGE_BUCKETS)[number];

/** Which window blocks the next request: the account's month, its day, or the shared daily capacity. */
export const AI_LIMIT_REASONS = ["monthly", "daily", "capacity"] as const;
export type AiLimitReason = (typeof AI_LIMIT_REASONS)[number];

export interface AiUsageWindow {
  dayUsed: number;
  /** null: the plan has no daily limit. */
  dayLimit: number | null;
  monthUsed: number;
  monthLimit: number | null;
  limitReason: AiLimitReason | null;
  /** UTC instant the blocking window ends; null when nothing blocks. */
  resetsAt: string | null;
}

export type AiUsage = Record<AiUsageBucket, AiUsageWindow>;

const rowSchema = z.object({
  bucket: z.enum(AI_USAGE_BUCKETS),
  day_used: z.number().int().min(0),
  day_limit: z.number().int().min(0).nullable(),
  month_used: z.number().int().min(0),
  month_limit: z.number().int().min(0).nullable(),
  limit_reason: z.enum(AI_LIMIT_REASONS).nullable(),
  resets_at: z.string().nullable(),
}).strict();

/** Parses get_ai_usage() rows; null when a bucket is missing or a row is malformed. */
export function parseAiUsageRows(data: unknown): AiUsage | null {
  const rows = z.array(rowSchema).safeParse(data);
  if (!rows.success) return null;
  const usage: Partial<AiUsage> = {};
  for (const row of rows.data) {
    usage[row.bucket] = {
      dayUsed: row.day_used,
      dayLimit: row.day_limit,
      monthUsed: row.month_used,
      monthLimit: row.month_limit,
      limitReason: row.limit_reason,
      resetsAt: row.limit_reason ? row.resets_at : null,
    };
  }
  return usage.analysis && usage.import ? (usage as AiUsage) : null;
}
