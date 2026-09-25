import * as z from "zod";

import { ACHIEVEMENT_FIELD_LIMITS, ACHIEVEMENT_STATUSES } from "@/domain/achievement/contracts";
import { achievementMetricsSchema } from "@/domain/achievement/metrics";

const nullableText = (max: number) => z.string().trim().max(max).transform((value) => value || null);

export const achievementCreateSchema = z.object({
  operationKey: z.uuid(),
  activityId: z.uuid().nullable(),
  projectId: z.uuid().nullable(),
  experienceId: z.uuid().nullable(),
}).strict().superRefine((value, context) => {
  if (value.activityId && (value.projectId || value.experienceId)) {
    context.addIssue({ code: "custom", path: ["activityId"], message: "derived_context_server_owned" });
  }
});

export const achievementChangesSchema = z.object({
  title: nullableText(ACHIEVEMENT_FIELD_LIMITS.title),
  contribution: nullableText(ACHIEVEMENT_FIELD_LIMITS.contribution),
  scope: nullableText(ACHIEVEMENT_FIELD_LIMITS.scope),
  outcome: nullableText(ACHIEVEMENT_FIELD_LIMITS.outcome),
  cvBullet: nullableText(ACHIEVEMENT_FIELD_LIMITS.cvBullet),
  achievedOn: z.string().date().nullable(),
  metrics: achievementMetricsSchema,
}).strict();

export const achievementActionSchema = z.enum(["save_draft", "confirm", "dismiss", "reopen", "save_changes"]);

export const achievementSaveSchema = z.object({
  achievementId: z.uuid(),
  expectedRevision: z.number().int().positive(),
  action: achievementActionSchema,
  changes: achievementChangesSchema,
  skillNames: z.array(z.string().trim().min(1).max(100)).max(ACHIEVEMENT_FIELD_LIMITS.skills),
}).strict();

export const achievementUpdateContextSchema = z.object({
  achievementId: z.uuid(),
  expectedRevision: z.number().int().positive(),
  projectId: z.uuid().nullable(),
}).strict();

export const achievementDeleteSchema = z.object({
  achievementId: z.uuid(),
  expectedRevision: z.number().int().positive(),
}).strict();

export const achievementListFilterSchema = z.object({
  status: z.enum(ACHIEVEMENT_STATUSES).optional(),
  projectId: z.uuid().optional(),
  cursor: z.string().trim().min(1).max(256).optional(),
}).strict();

export type AchievementCreateInput = z.infer<typeof achievementCreateSchema>;
export type AchievementChanges = z.infer<typeof achievementChangesSchema>;
export type AchievementAction = z.infer<typeof achievementActionSchema>;
export type AchievementSaveInput = z.infer<typeof achievementSaveSchema>;
export type AchievementListFilters = z.infer<typeof achievementListFilterSchema>;

