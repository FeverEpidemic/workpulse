import type { AiJobKind } from "../../domain/ai/contracts.ts";
import type { DetectInput } from "../../domain/ai/minimize.ts";
import type { AIProvider, AIProviderResult, ImportExtractInput } from "./provider.ts";

export const FAKE_AI_SCENARIOS = [
  "valid", "malformed", "refusal", "ungrounded", "slow", "unavailable",
  "no_potential", "fabricated_text", "many_questions", "with_skills",
  "import_empty", "import_partial", "import_ungrounded", "import_numbers",
] as const;

type FakeDate = { year: number; month: null; day: null } | null;
const fakeYear = (value: string | undefined): FakeDate =>
  value && /^\d{4}$/.test(value.trim()) ? { year: Number(value.trim()), month: null, day: null } : null;

/**
 * Deterministic import extraction from fixture lines (EXP|org|role|start|end, EDU|...,
 * CERT|name|issuer|year, SKILL|name, ACH|title|org). Excerpts are the exact lines.
 */
function fakeImportResult(text: string, scenario: FakeAIScenario): Record<string, unknown> {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const experiences: Array<Record<string, unknown>> = [];
  const education: Array<Record<string, unknown>> = [];
  const certifications: Array<Record<string, unknown>> = [];
  const skills: Array<Record<string, unknown>> = [];
  const achievements: Array<Record<string, unknown>> = [];
  if (scenario === "import_empty") {
    return { schema_version: "import.v1", profile: null, experiences, education, certifications, skills, achievements };
  }
  for (const line of lines) {
    const [tag, a, b, c, d] = line.split("|");
    if (tag === "EXP") {
      experiences.push({
        ref: `exp-${experiences.length + 1}`, organization: a ?? null,
        role_title: scenario === "import_partial" ? null : (b ?? null),
        kind: "employment", description: null, start: fakeYear(c), end: fakeYear(d),
        is_current: (d ?? "").trim() === "", excerpt: line,
      });
    } else if (tag === "EDU") {
      education.push({
        institution: a ?? null, qualification: b ?? null, field_of_study: null, description: null,
        start: fakeYear(c), end: fakeYear(d), is_current: false, excerpt: line,
      });
    } else if (tag === "CERT") {
      certifications.push({ name: a ?? null, issuer: b ?? null, issued: fakeYear(c), credential_url: null, excerpt: line });
    } else if (tag === "SKILL") {
      skills.push({ name: a ?? null, excerpt: line });
    } else if (tag === "ACH") {
      const experience = experiences.find((row) => row.organization === b);
      achievements.push({
        title: scenario === "import_numbers" ? `${a} for 4173 users` : (a ?? null),
        contribution: null, outcome: null, achieved_on: null,
        experience_ref: (experience?.ref as string | undefined) ?? null, cv_bullet: null, metrics: [], excerpt: line,
      });
    }
  }
  if (scenario === "import_ungrounded") {
    // One candidate whose excerpt is not in the text (dropped) and one invented employer
    // attached to a real excerpt (cleared and flagged).
    experiences.push({
      ref: "exp-invented", organization: "Invented Corp", role_title: "CEO", kind: "employment", description: null,
      start: null, end: null, is_current: false, excerpt: "EXP|Invented Corp|CEO|2010|2012",
    });
    if (experiences[0]) experiences[0] = { ...experiences[0], organization: "Fabricated Holdings" };
  }
  return { schema_version: "import.v1", profile: null, experiences, education, certifications, skills, achievements };
}
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
  readonly importCalls: ImportExtractInput[] = [];
  /** Test seam: runs while an import extraction is "in flight" (e.g. to cancel concurrently). */
  onImport?: (input: ImportExtractInput) => Promise<void> | void;

  async extractImport(input: ImportExtractInput, signal: AbortSignal): Promise<AIProviderResult> {
    this.importCalls.push(input);
    await this.onImport?.(input);
    switch (this.scenario) {
      case "refusal":
        return { status: "error", code: "AI_REFUSED" };
      case "unavailable":
        return { status: "error", code: "AI_PROVIDER_UNAVAILABLE" };
      case "malformed":
        return { status: "ok", output: { schema_version: "import.v1", unexpected: true }, model: FAKE_AI_MODEL };
      case "slow":
        return new Promise((resolve) => {
          const finish = () => resolve({ status: "error", code: "AI_PROVIDER_TIMEOUT" });
          if (signal.aborted) finish();
          else signal.addEventListener("abort", finish, { once: true });
        });
      default:
        return { status: "ok", output: fakeImportResult(input.text, this.scenario), model: FAKE_AI_MODEL };
    }
  }
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
