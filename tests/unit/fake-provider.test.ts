import { describe, expect, it } from "vitest";

import { buildDetectInput } from "@/domain/ai/minimize";
import { ExplicitTestFakeAIProvider } from "@/server/ai/fake-provider";

const input = buildDetectInput({ raw_text: "Migrated 3 reports", role: null, scope: null, outcome: null, locale: "en" });
const signal = () => new AbortController().signal;

describe("ExplicitTestFakeAIProvider", () => {
  it("valid scenario asks about outcome for a detect job when outcome is missing", async () => {
    const result = await new ExplicitTestFakeAIProvider("valid").detect(input, signal(), "detect");
    expect(result).toMatchObject({ status: "ok" });
    const output = (result as { output: { questions: unknown[] } }).output;
    expect(output.questions).toHaveLength(1);
  });

  it("valid scenario returns no questions for a refine job even when outcome is missing", async () => {
    const result = await new ExplicitTestFakeAIProvider("valid").detect(input, signal(), "refine");
    const output = (result as { output: { questions: unknown[] } }).output;
    expect(output.questions).toEqual([]);
  });

  it("no_potential scenario returns potential=false with no suggestion", async () => {
    const result = await new ExplicitTestFakeAIProvider("no_potential").detect(input, signal());
    expect(result).toMatchObject({ status: "ok", output: { potential: false, suggestion: null, questions: [] } });
  });

  it("fabricated_text scenario writes a number in cv_bullet that is never in the input", async () => {
    const result = await new ExplicitTestFakeAIProvider("fabricated_text").detect(input, signal());
    const output = (result as { output: { suggestion: { cv_bullet: string } } }).output;
    expect(output.suggestion.cv_bullet).toContain("4173");
    expect(input.raw_text).not.toContain("4173");
  });

  it("many_questions scenario returns 4 questions regardless of kind", async () => {
    const detect = await new ExplicitTestFakeAIProvider("many_questions").detect(input, signal(), "detect");
    expect((detect as { output: { questions: unknown[] } }).output.questions).toHaveLength(4);
    const refine = await new ExplicitTestFakeAIProvider("many_questions").detect(input, signal(), "refine");
    expect((refine as { output: { questions: unknown[] } }).output.questions).toHaveLength(4);
  });
});
