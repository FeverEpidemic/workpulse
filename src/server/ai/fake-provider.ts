import type { AiJobKind } from "../../domain/ai/contracts.ts";
import type { DetectInput } from "../../domain/ai/minimize.ts";
import type { AIProvider, AIProviderResult } from "./provider.ts";

export const FAKE_AI_SCENARIOS = [
  "valid", "malformed", "refusal", "ungrounded", "slow", "unavailable",
  "no_potential", "fabricated_text", "many_questions", "with_skills",
] as const;
export type FakeAIScenario = (typeof FAKE_AI_SCENARIOS)[number];

export const FAKE_AI_MODEL = "workpulse-explicit-test-fake";

function firstNumber(text: string): number | null {
  const match = text.match(/\d+/);
  return match ? Number(match[0]) : null;
}

/**
 * Deterministic provider for development and tests only (resolveAIProvider refuses it
 * in production). Output depends only on the input and never contacts a network.
 */
export class ExplicitTestFakeAIProvider implements AIProvider {
  readonly kind = "fake" as const;
  readonly calls: DetectInput[] = [];
  private readonly scenario: FakeAIScenario;
  private readonly onDetect?: (input: DetectInput) => Promise<void> | void;

  constructor(scenario: FakeAIScenario = "valid", onDetect?: (input: DetectInput) => Promise<void> | void) {
    this.scenario = scenario;
    this.onDetect = onDetect;
  }

  async detect(input: DetectInput, signal: AbortSignal, jobKind: AiJobKind = "detect"): Promise<AIProviderResult> {
    this.calls.push(input);
    await this.onDetect?.(input);

    switch (this.scenario) {
      case "refusal":
        return { status: "error", code: "AI_REFUSED" };
      case "unavailable":
        return { status: "error", code: "AI_PROVIDER_UNAVAILABLE" };
      case "malformed":
        return { status: "ok", output: { schema_version: "detect.v1", unexpected: true }, model: FAKE_AI_MODEL };
      case "no_potential":
        return {
          status: "ok", model: FAKE_AI_MODEL,
          output: { schema_version: "detect.v1", potential: false, suggestion: null, questions: [] },
        };
      case "fabricated_text":
        return {
          status: "ok", model: FAKE_AI_MODEL,
          output: {
            schema_version: "detect.v1",
            potential: true,
            suggestion: {
              title: "Delivered the described work",
              contribution: "Completed the work described in the note.",
              outcome: "The described work was delivered.",
              role: input.role, scope: input.scope,
              // 4173 never appears in any test fixture's input text: guaranteed ungrounded.
              cv_bullet: "Delivered the work, impacting 4173 people.",
              metrics: [],
              skills: [],
            },
            questions: [],
          },
        };
      case "many_questions":
        return {
          status: "ok", model: FAKE_AI_MODEL,
          output: {
            schema_version: "detect.v1",
            potential: true,
            suggestion: {
              title: "Delivered the described work",
              contribution: "Completed the work described in the note.",
              outcome: "The described work was delivered.",
              role: input.role, scope: input.scope,
              cv_bullet: "Delivered the work described in the note.",
              metrics: [],
              skills: [],
            },
            questions: [
              { field: "role", text: "What was your role?" },
              { field: "scope", text: "What was the scope?" },
              { field: "outcome", text: "What was the outcome?" },
              { field: "role", text: "Anything else about your role?" },
            ],
          },
        };
      case "slow":
        return new Promise((resolve) => {
          const finish = () => resolve({ status: "error", code: "AI_PROVIDER_TIMEOUT" });
          if (signal.aborted) finish();
          else signal.addEventListener("abort", finish, { once: true });
        });
      default:
        break;
    }

    const value = this.scenario === "ungrounded" ? 40 : firstNumber(input.raw_text);
    return {
      status: "ok",
      model: FAKE_AI_MODEL,
      output: {
        schema_version: "detect.v1",
        potential: true,
        suggestion: {
          title: "Delivered the described work",
          contribution: "Completed the work described in the note.",
          outcome: "The described work was delivered.",
          role: input.role,
          scope: input.scope,
          cv_bullet: "Delivered the work described in the note.",
          metrics: value === null ? [] : [{ label: "Stated count", value, unit: "items", baseline: null }],
          skills: this.scenario === "with_skills" ? ["Data pipelines", "Reporting"] : [],
        },
        questions: jobKind === "refine" || input.outcome !== null
          ? []
          : [{ field: "outcome", text: input.locale === "id" ? "Apa hasilnya?" : "What was the result?" }],
      },
    };
  }
}
