import { describe, expect, it } from "vitest";

import { detectResultJsonSchema, detectResultSchema, validateDetectResult, type DetectResult } from "@/domain/ai/detect-result";
import { buildDetectInput } from "@/domain/ai/minimize";

const input = buildDetectInput({
  raw_text: "Led migration of 3 reports; cut weekly prep from 5 to 2 hours.",
  role: null,
  scope: null,
  outcome: null,
  locale: "en",
});

type Metric = { label: string; value: number; unit: string; baseline: number | null };
type ValidResult = DetectResult & { suggestion: NonNullable<DetectResult["suggestion"]> };

function valid(): ValidResult {
  return {
    schema_version: "detect.v1",
    potential: true,
    suggestion: {
      title: "Migrated weekly reports",
      contribution: "Led the migration of 3 reports.",
      outcome: "Weekly prep dropped from 5 to 2 hours.",
      role: null,
      scope: "3 reports",
      cv_bullet: "Migrated 3 reports, cutting weekly prep from 5 to 2 hours.",
      metrics: [{ label: "Weekly prep", value: 2, unit: "hours", baseline: 5 }] as Metric[],
      skills: ["Reporting"],
    },
    questions: [{ field: "role", text: "What was your role?" }],
  };
}

describe("detect.v1 result", () => {
  it("accepts a grounded structured result", () => {
    expect(validateDetectResult(valid(), input)).toEqual({ ok: true, result: valid() });
  });

  it("accepts routine activity without potential", () => {
    const routine = { schema_version: "detect.v1", potential: false, suggestion: null, questions: [] };
    expect(validateDetectResult(routine, input).ok).toBe(true);
  });

  it.each([
    ["unknown top-level key", { ...valid(), extra: 1 }],
    ["wrong version", { ...valid(), schema_version: "detect.v2" }],
    ["potential without suggestion", { ...valid(), suggestion: null }],
    ["no potential with suggestion", { ...valid(), potential: false }],
    ["no potential with questions", { schema_version: "detect.v1", potential: false, suggestion: null, questions: [{ field: "role", text: "Role?" }] }],
    ["four questions", { ...valid(), questions: [
      { field: "role", text: "a" }, { field: "scope", text: "b" }, { field: "outcome", text: "c" }, { field: "role", text: "d" },
    ] }],
    ["duplicate question field", { ...valid(), questions: [{ field: "role", text: "a" }, { field: "role", text: "b" }] }],
    ["blank title", { ...valid(), suggestion: { ...valid().suggestion, title: "   " } }],
    ["unknown suggestion key", { ...valid(), suggestion: { ...valid().suggestion, impact: "huge" } }],
    ["string metric value", { ...valid(), suggestion: { ...valid().suggestion, metrics: [{ label: "x", value: "2", unit: "h", baseline: null }] } }],
  ])("rejects %s", (_name, value) => {
    expect(validateDetectResult(value, input)).toEqual({ ok: false });
  });

  it("rejects metrics whose numbers are not written in the user's text", () => {
    const ungrounded = valid();
    ungrounded.suggestion.metrics = [{ label: "Adoption", value: 40, unit: "%", baseline: 5 }];
    expect(validateDetectResult(ungrounded, input)).toEqual({ ok: false });

    const inventedBaseline = valid();
    inventedBaseline.suggestion.metrics = [{ label: "Weekly prep", value: 2, unit: "hours", baseline: 9 }];
    expect(validateDetectResult(inventedBaseline, input)).toEqual({ ok: false });
  });

  it("grounds metrics written with Indonesian decimal or thousand separators", () => {
    const idInput = buildDetectInput({ raw_text: "Memproses 1.500 dokumen, akurasi naik ke 98,5 persen.", role: null, scope: null, outcome: null, locale: "id" });
    const result = valid();
    result.suggestion.title = "Memproses dokumen batch";
    result.suggestion.contribution = "Memproses seluruh dokumen batch.";
    result.suggestion.outcome = "Akurasi meningkat signifikan.";
    result.suggestion.scope = null;
    result.suggestion.cv_bullet = "Memproses dokumen batch dengan akurasi tinggi.";
    result.suggestion.metrics = [
      { label: "Dokumen", value: 1500, unit: "dokumen", baseline: null },
      { label: "Akurasi", value: 98.5, unit: "persen", baseline: null },
    ];
    expect(validateDetectResult(result, idInput).ok).toBe(true);
  });

  it("rejects a fabricated number in title, contribution, outcome or cv_bullet", () => {
    const fabricatedTitle = valid();
    fabricatedTitle.suggestion.title = "Migrated 40 weekly reports";
    expect(validateDetectResult(fabricatedTitle, input)).toEqual({ ok: false });

    const fabricatedOutcome = valid();
    fabricatedOutcome.suggestion.outcome = "Weekly prep dropped from 5 to 2 hours, a 40% cut";
    expect(validateDetectResult(fabricatedOutcome, input)).toEqual({ ok: false });

    const fabricatedBullet = valid();
    fabricatedBullet.suggestion.cv_bullet = "Migrated 3 reports for a team of 12 people";
    expect(validateDetectResult(fabricatedBullet, input)).toEqual({ ok: false });
  });

  it("accepts a number in suggestion text that only appears in role/scope/outcome input, not raw_text", () => {
    const withOutcome = buildDetectInput({ raw_text: "Led a migration project", role: null, scope: null, outcome: "Cut costs by 12 percent", locale: "en" });
    const result = valid();
    result.suggestion.title = "Led a migration project";
    result.suggestion.contribution = "Led the migration end to end.";
    result.suggestion.outcome = "Cut costs by 12 percent";
    result.suggestion.scope = null;
    result.suggestion.cv_bullet = "Led a migration that cut costs by 12 percent.";
    result.suggestion.metrics = [];
    expect(validateDetectResult(result, withOutcome).ok).toBe(true);
  });

  it("rejects a refine result that carries any questions", () => {
    const withQuestions = { ...valid(), questions: [] as const };
    expect(validateDetectResult(withQuestions, input, { kind: "refine" }).ok).toBe(true);
    expect(validateDetectResult(valid(), input, { kind: "refine" })).toEqual({ ok: false });
  });

  it("keeps the strict JSON Schema aligned with the Zod shape", () => {
    const zodKeys = Object.keys(valid()).sort();
    expect(detectResultSchema.safeParse(valid()).success).toBe(true);
    expect([...detectResultJsonSchema.required].sort()).toEqual(zodKeys);
    expect(Object.keys(detectResultJsonSchema.properties).sort()).toEqual(zodKeys);

    const suggestion = detectResultJsonSchema.properties.suggestion.anyOf[0];
    expect([...suggestion.required].sort()).toEqual(Object.keys(suggestion.properties).sort());
    expect(Object.keys(suggestion.properties).sort()).toEqual(Object.keys(valid().suggestion).sort());
    expect(suggestion.additionalProperties).toBe(false);
    expect(detectResultJsonSchema.additionalProperties).toBe(false);
    const metric = suggestion.properties.metrics.items;
    expect([...metric.required].sort()).toEqual(Object.keys(valid().suggestion.metrics[0] ?? {}).sort());
  });
});
