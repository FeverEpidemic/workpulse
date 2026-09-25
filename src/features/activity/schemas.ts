import * as z from "zod";

import { ACTIVITY_FIELD_LIMITS } from "@/domain/activity/contracts";
import { decodeActivityCursor } from "@/domain/activity/activity-cursor";
import { isExactActivityDate } from "@/domain/activity/activity-date";

function codePointLength(value: string): number {
  return Array.from(value).length;
}

const exactDateSchema = z.string().refine(isExactActivityDate);
const rawTextSchema = z.string().superRefine((value, context) => {
  if (value.trim().length === 0) {
    context.addIssue({ code: "custom", message: "blank" });
  }
  if (codePointLength(value) > ACTIVITY_FIELD_LIMITS.rawText) {
    context.addIssue({ code: "custom", message: "too_long" });
  }
});

function optionalTextSchema(limit: number) {
  return z.string().nullish()
    .transform((value) => {
      if (value === undefined || value === null) return null;
      const trimmed = value.trim();
      return trimmed.length === 0 ? null : trimmed;
    })
    .refine((value) => value === null || codePointLength(value) <= limit);
}

const activityEditableFields = {
  rawText: rawTextSchema,
  occurredOn: exactDateSchema,
  role: optionalTextSchema(ACTIVITY_FIELD_LIMITS.role),
  scope: optionalTextSchema(ACTIVITY_FIELD_LIMITS.scope),
  outcome: optionalTextSchema(ACTIVITY_FIELD_LIMITS.outcome),
  experienceId: z.uuid().nullish().transform((value) => value ?? null),
  projectId: z.uuid().nullish().transform((value) => value ?? null),
};

export const activityCreateSchema = z.object({
  operationKey: z.uuid(),
  captureMode: z.enum(["note", "form", "chat"]),
  ...activityEditableFields,
}).strict();

export const activityUpdateSchema = z.object({
  activityId: z.uuid(),
  expectedRevision: z.number().int().positive(),
  ...activityEditableFields,
}).strict();

export const activityDeleteSchema = z.object({
  activityId: z.uuid(),
  expectedRevision: z.number().int().positive(),
}).strict();

const optionalFilterDate = z.string().optional().refine((value) => value === undefined || isExactActivityDate(value));

export const activityListFilterSchema = z.object({
  from: optionalFilterDate,
  to: optionalFilterDate,
  projectId: z.uuid().optional(),
  cursor: z.string().optional().refine((value) => {
    if (value === undefined) return true;
    try {
      decodeActivityCursor(value);
      return true;
    } catch {
      return false;
    }
  }),
}).strict().superRefine((value, context) => {
  if (value.from && value.to && value.from > value.to) {
    context.addIssue({ code: "custom", path: ["from"], message: "invalid_range" });
  }
});

export type ActivityCreateInput = z.output<typeof activityCreateSchema>;
export type ActivityUpdateInput = z.output<typeof activityUpdateSchema>;
export type ActivityDeleteInput = z.output<typeof activityDeleteSchema>;
export type ActivityListFilters = z.output<typeof activityListFilterSchema>;
