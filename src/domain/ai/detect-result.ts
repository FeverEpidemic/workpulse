import * as z from "zod";

import type { DetectInput } from "./minimize.ts";

export const DETECT_SCHEMA_VERSION = "detect.v1";

/** Kept at or below ACHIEVEMENT_FIELD_LIMITS so a reviewed suggestion always fits a draft. */
export const DETECT_LIMITS = {
  title: 200,
  contribution: 2_000,
  outcome: 2_000,
  role: 200,
  scope: 2_000,
  cvBullet: 500,
  metricLabel: 100,
  metricUnit: 50,
  metrics: 5,
  skill: 100,
  skills: 8,
  questionText: 300,
  questions: 3,
} as const;

export const DETECT_QUESTION_FIELDS = ["role", "scope", "outcome"] as const;

const text = (max: number) => z.string().trim().min(1).max(max);
const nullableText = (max: number) => text(max).nullable();

const metricSchema = z.object({
  label: text(DETECT_LIMITS.metricLabel),
  value: z.number().finite(),
  unit: text(DETECT_LIMITS.metricUnit),
  baseline: z.number().finite().nullable(),
}).strict();

const suggestionSchema = z.object({
  title: text(DETECT_LIMITS.title),
  contribution: text(DETECT_LIMITS.contribution),
  outcome: text(DETECT_LIMITS.outcome),
  role: nullableText(DETECT_LIMITS.role),
  scope: nullableText(DETECT_LIMITS.scope),
  cv_bullet: text(DETECT_LIMITS.cvBullet),
  metrics: z.array(metricSchema).max(DETECT_LIMITS.metrics),
  skills: z.array(text(DETECT_LIMITS.skill)).max(DETECT_LIMITS.skills),
}).strict();

const questionSchema = z.object({
  field: z.enum(DETECT_QUESTION_FIELDS),
  text: text(DETECT_LIMITS.questionText),
}).strict();

export const detectResultSchema = z.object({
  schema_version: z.literal(DETECT_SCHEMA_VERSION),
  potential: z.boolean(),
  suggestion: suggestionSchema.nullable(),
  questions: z.array(questionSchema).max(DETECT_LIMITS.questions),
}).strict().superRefine((value, context) => {
  if (value.potential && value.suggestion === null) {
    context.addIssue({ code: "custom", path: ["suggestion"], message: "potential_requires_suggestion" });
  }
  if (!value.potential && (value.suggestion !== null || value.questions.length > 0)) {
    context.addIssue({ code: "custom", path: ["potential"], message: "no_potential_means_no_suggestion" });
  }
  const fields = value.questions.map((question) => question.field);
  if (new Set(fields).size !== fields.length) {
    context.addIssue({ code: "custom", path: ["questions"], message: "duplicate_question_field" });
  }
});

export type DetectResult = z.infer<typeof detectResultSchema>;

const jsonText = (maxLength: number) => ({ type: "string", minLength: 1, maxLength });
const jsonNullableText = (maxLength: number) => ({ type: ["string", "null"], minLength: 1, maxLength });

/**
 * Strict JSON Schema sent to the provider (Structured Outputs): every property is
 * required, nullable values use a type array and no additional properties exist.
 * Cross-field rules and grounding are enforced by validateDetectResult afterwards.
 */
export const detectResultJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schema_version", "potential", "suggestion", "questions"],
  properties: {
    schema_version: { type: "string", enum: [DETECT_SCHEMA_VERSION] },
    potential: { type: "boolean" },
    suggestion: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["title", "contribution", "outcome", "role", "scope", "cv_bullet", "metrics", "skills"],
          properties: {
            title: jsonText(DETECT_LIMITS.title),
            contribution: jsonText(DETECT_LIMITS.contribution),
            outcome: jsonText(DETECT_LIMITS.outcome),
            role: jsonNullableText(DETECT_LIMITS.role),
            scope: jsonNullableText(DETECT_LIMITS.scope),
            cv_bullet: jsonText(DETECT_LIMITS.cvBullet),
            metrics: {
              type: "array",
              maxItems: DETECT_LIMITS.metrics,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["label", "value", "unit", "baseline"],
                properties: {
                  label: jsonText(DETECT_LIMITS.metricLabel),
                  value: { type: "number" },
                  unit: jsonText(DETECT_LIMITS.metricUnit),
                  baseline: { type: ["number", "null"] },
                },
              },
            },
            skills: { type: "array", maxItems: DETECT_LIMITS.skills, items: jsonText(DETECT_LIMITS.skill) },
          },
        },
        { type: "null" },
      ],
    },
    questions: {
      type: "array",
      maxItems: DETECT_LIMITS.questions,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "text"],
        properties: {
          field: { type: "string", enum: [...DETECT_QUESTION_FIELDS] },
          text: jsonText(DETECT_LIMITS.questionText),
        },
      },
    },
  },
} as const;

const NUMBER_PATTERN = /\d+(?:[.,]\d+)*/g;

/** Every number written in `source`, read with both decimal conventions (1.000 / 1,000 / 5,5). */
export function numbersIn(source: string): Set<number> {
  const found = new Set<number>();
  for (const match of source.matchAll(NUMBER_PATTERN)) {
    const token = match[0];
    const candidates = [
      token.replaceAll(",", ""),
      token.replaceAll(".", "").replace(",", "."),
      token.replace(",", "."),
    ];
    for (const candidate of candidates) {
      const value = Number(candidate);
      if (Number.isFinite(value)) found.add(value);
    }
  }
  return found;
}

function inputNumbers(input: DetectInput): Set<number> {
  return numbersIn([input.raw_text, input.role, input.scope, input.outcome].filter(Boolean).join("\n"));
}

/** Every metric value (and baseline) must literally appear in the user's own text. */
export function hasGroundedMetrics(result: DetectResult, input: DetectInput): boolean {
  if (!result.suggestion) return true;
  const available = inputNumbers(input);
  return result.suggestion.metrics.every((metric) =>
    available.has(metric.value) && (metric.baseline === null || available.has(metric.baseline)));
}

/** Every number written in the suggestion's free text must also appear in the user's own text. */
export function hasGroundedText(result: DetectResult, input: DetectInput): boolean {
  if (!result.suggestion) return true;
  const available = inputNumbers(input);
  const { title, contribution, outcome, scope, cv_bullet } = result.suggestion;
  const text = [title, contribution, outcome, scope, cv_bullet].filter((value): value is string => value !== null).join("\n");
  for (const value of numbersIn(text)) {
    if (!available.has(value)) return false;
  }
  return true;
}

export type DetectValidation = { ok: true; result: DetectResult } | { ok: false };
export type DetectValidationOptions = { kind?: "detect" | "refine" };

export function validateDetectResult(raw: unknown, input: DetectInput, options: DetectValidationOptions = {}): DetectValidation {
  const parsed = detectResultSchema.safeParse(raw);
  if (!parsed.success) return { ok: false };
  if (options.kind === "refine" && parsed.data.questions.length > 0) return { ok: false };
  if (!hasGroundedMetrics(parsed.data, input) || !hasGroundedText(parsed.data, input)) return { ok: false };
  return { ok: true, result: parsed.data };
}
