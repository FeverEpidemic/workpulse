import * as z from "zod";

import { PROJECT_FIELD_LIMITS, PROJECT_STATUSES } from "@/domain/project/contracts";
import { decodeProjectCursor } from "@/domain/project/project-cursor";
import { isExactActivityDate } from "@/domain/activity/activity-date";

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function optionalTextSchema(limit: number) {
  return z.string().nullish().transform((value) => {
    if (value === undefined || value === null) return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }).refine((value) => value === null || codePointLength(value) <= limit);
}

const requiredTitleSchema = z.string().transform((value) => value.trim()).superRefine((value, context) => {
  if (!value) context.addIssue({ code: "custom", message: "required" });
  if (codePointLength(value) > 200) context.addIssue({ code: "custom", message: "too_long" });
});

const canonicalDate = z.string().nullable().refine(
  (value) => value === null || isExactActivityDate(value),
);
const canonicalPrecision = z.enum(["year", "month", "day"]).nullable();

const projectFields = {
  title: requiredTitleSchema,
  description: optionalTextSchema(PROJECT_FIELD_LIMITS.description),
  userRole: optionalTextSchema(PROJECT_FIELD_LIMITS.userRole),
  outcome: optionalTextSchema(PROJECT_FIELD_LIMITS.outcome),
  status: z.enum(PROJECT_STATUSES),
  experienceId: z.uuid().nullable(),
  startDate: canonicalDate,
  startPrecision: canonicalPrecision,
  endDate: canonicalDate,
  endPrecision: canonicalPrecision,
  isCurrent: z.boolean(),
};

type ProjectDateFields = {
  startDate: string | null;
  startPrecision: "year" | "month" | "day" | null;
  endDate: string | null;
  endPrecision: "year" | "month" | "day" | null;
  isCurrent: boolean;
};

function addProjectDateIssues(value: ProjectDateFields, context: z.RefinementCtx): void {
  if ((value.startDate === null) !== (value.startPrecision === null)) {
    context.addIssue({ code: "custom", path: ["startDate"], message: "partial_date" });
  }
  if ((value.endDate === null) !== (value.endPrecision === null)) {
    context.addIssue({ code: "custom", path: ["endDate"], message: "partial_date" });
  }
  if (value.isCurrent && (value.endDate !== null || value.endPrecision !== null)) {
    context.addIssue({ code: "custom", path: ["endDate"], message: "current_end" });
  }
  if (value.startDate && value.endDate && value.endPrecision) {
    const end = value.endPrecision === "year"
      ? `${value.endDate.slice(0, 4)}-12-31`
      : value.endPrecision === "month"
        ? new Date(Date.UTC(Number(value.endDate.slice(0, 4)), Number(value.endDate.slice(5, 7)), 0)).toISOString().slice(0, 10)
        : value.endDate;
    if (end < value.startDate) {
      context.addIssue({ code: "custom", path: ["endDate"], message: "range" });
    }
  }
}

function addProjectFieldIssues(value: ProjectDateFields & { status: "planned" | "active" | "completed" }, context: z.RefinementCtx): void {
  if (value.status === "completed" && value.isCurrent) {
    context.addIssue({ code: "custom", path: ["isCurrent"], message: "completed_current" });
  }
  addProjectDateIssues(value, context);
}

export const projectCreateSchema = z.object({
  operationKey: z.uuid(),
  ...projectFields,
}).strict().superRefine((value, context) => {
  addProjectFieldIssues(value, context);
});

export const projectUpdateSchema = z.object({
  projectId: z.uuid(),
  expectedRevision: z.number().int().positive(),
  ...projectFields,
}).strict().superRefine((value, context) => {
  addProjectFieldIssues(value, context);
});

export const projectListFilterSchema = z.object({
  status: z.enum(PROJECT_STATUSES).optional(),
  cursor: z.string().optional().refine((value) => {
    if (value === undefined) return true;
    try {
      decodeProjectCursor(value);
      return true;
    } catch {
      return false;
    }
  }),
}).strict();

export const relinkActivitySchema = z.object({
  activityId: z.uuid(),
  expectedRevision: z.number().int().positive(),
  projectId: z.uuid().nullable(),
}).strict();

export const deleteProjectSchema = z.object({
  projectId: z.uuid(),
  expectedRevision: z.number().int().positive(),
}).strict();

export type ProjectCreateInput = z.infer<typeof projectCreateSchema>;
export type ProjectUpdateInput = z.infer<typeof projectUpdateSchema>;
export type ProjectListFilters = z.infer<typeof projectListFilterSchema>;
export type RelinkActivityInput = z.infer<typeof relinkActivitySchema>;
export type DeleteProjectInput = z.infer<typeof deleteProjectSchema>;
