import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { ActivityAnalysisPanel } from "@/features/ai/activity-analysis-panel";
import { AiSuggestionAside } from "@/features/ai/ai-suggestion-aside";
import type { AnalysisViewPayload } from "@/features/ai/ai-review-service";
import type { AnalysisState, ApplyBlockReason } from "@/domain/ai/analysis-view";
import type { DetectResult } from "@/domain/ai/detect-result";

const ACTIVITY_ID = "11111111-1111-4111-8111-111111111111";
const JOB_ID = "22222222-2222-4222-8222-222222222222";
const ACHIEVEMENT_ID = "33333333-3333-4333-8333-333333333333";
const SOURCE = "Cut the nightly reconciliation run from four hours to forty minutes.";

const RESULT: DetectResult = {
  schema_version: "detect.v1",
  potential: true,
  suggestion: {
    title: "Faster reconciliation",
    contribution: "Reworked the nightly reconciliation run.",
    outcome: "Runtime fell from four hours to forty minutes.",
    role: null,
    scope: null,
    cv_bullet: "Cut nightly reconciliation from 4h to 40m.",
    metrics: [],
    skills: ["SQL", "Performance tuning"],
  },
  questions: [{ field: "role", text: "What was your role?" }, { field: "outcome", text: "What changed afterwards?" }],
};

function payload(state: AnalysisState, over: {
  status?: "queued" | "running" | "succeeded" | "failed";
  attempt?: number;
  errorCode?: string | null;
  canRetry?: boolean;
  canApply?: boolean;
  block?: ApplyBlockReason | null;
  result?: DetectResult | null;
  questions?: boolean;
  achievement?: AnalysisViewPayload["achievement"];
} = {}): AnalysisViewPayload {
  const status = over.status ?? (state === "queued" ? "queued" : state === "running" ? "running" : state === "failed" ? "failed" : "succeeded");
  return {
    activityRevision: 1,
    job: state === "none" ? null : {
      id: JOB_ID, kind: "detect", status, inputRevision: state === "stale" ? 0 : 1,
      attemptCount: over.attempt ?? 1, errorCode: over.errorCode ?? null,
      result: over.result === undefined ? (status === "succeeded" ? RESULT : null) : over.result,
    },
    achievement: over.achievement ?? null,
    view: {
      state,
      canRetry: over.canRetry ?? false,
      canApply: over.canApply ?? false,
      applyBlockReason: over.block ?? null,
      visibleQuestions: over.questions === false ? [] : (state === "suggestion" ? RESULT.questions : []),
    },
  };
}

function render(p: AnalysisViewPayload | null, options: { granted?: boolean; locale?: "en" | "id" } = {}): string {
  return renderToStaticMarkup(
    <ActivityAnalysisPanel
      locale={options.locale ?? "en"}
      activityId={ACTIVITY_ID}
      activityRevision={1}
      rawText={SOURCE}
      consent={{ granted: options.granted ?? true, profileRevision: 3 }}
      initialPayload={p}
      returnTo="/activity"
    />,
  );
}

describe("ActivityAnalysisPanel", () => {
  it("offers Analyze with AI and labels the panel as AI without decoration", () => {
    const html = render(payload("none"));
    expect(html).toContain("Analyze with AI");
    expect(html).toContain("ui-badge");
    expect(html).toMatch(/>AI</);
    expect(html.toLowerCase()).not.toContain("gradient");
    expect(html.toLowerCase()).not.toContain("sparkle");
  });

  it("still offers Analyze when consent is missing (the dialog asks first)", () => {
    expect(render(payload("none"), { granted: false })).toContain("Analyze with AI");
  });

  it("shows Waiting to start as a status and makes no result claims while queued", () => {
    const html = render(payload("queued"));
    expect(html).toContain("Waiting to start");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("Review as draft");
    expect(html).not.toContain("Faster reconciliation");
  });

  it("shows Analyzing while running", () => {
    const html = render(payload("running"));
    expect(html).toContain("Analyzing");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("Review as draft");
  });

  it("keeps the source visible and offers Retry and manual creation when failed", () => {
    const html = render(payload("failed", { errorCode: "AI_PROVIDER_UNAVAILABLE", canRetry: true }));
    expect(html).toContain("unavailable");
    expect(html).toContain("Retry");
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>[^<]*Retry/);
    expect(html).toContain("Create achievement manually");
    expect(html).toContain(SOURCE);
    expect(html).not.toContain("Review as draft");
  });

  it("disables Retry with a reason after three attempts", () => {
    const html = render(payload("failed", { attempt: 3, errorCode: "AI_UNAVAILABLE", canRetry: false }));
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*Retry/);
    expect(html).toContain("failed three times");
  });

  it("disables Retry with a consent reason when consent is missing", () => {
    const html = render(payload("failed", { attempt: 1, errorCode: "AI_TIMEOUT", canRetry: false }), { granted: false });
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*Retry/);
    expect(html).toContain("Allow AI processing");
  });

  it("says the activity changed when the analysis is stale", () => {
    const html = render(payload("stale"));
    expect(html).toContain("This activity changed after analysis");
    expect(html).toContain("Analyze again");
    expect(html).not.toContain("Faster reconciliation");
  });

  it("explains no potential without discarding the log entry", () => {
    const html = render(payload("no_potential", { result: { schema_version: "detect.v1", potential: false, suggestion: null, questions: [] } }));
    expect(html).toContain("No achievement detected. This activity stays in your log.");
  });

  it("shows the suggestion beside the source with questions, skip and review actions", () => {
    const html = render(payload("suggestion", { canApply: true }));
    expect(html).toContain("Faster reconciliation");
    expect(html).toContain("Cut nightly reconciliation from 4h to 40m.");
    expect(html).toContain(SOURCE);
    expect(html).toContain("What was your role?");
    expect(html).toContain("What changed afterwards?");
    expect(html).toContain("Answer");
    expect(html).toContain("Skip questions");
    expect(html).toContain("Save for later");
    expect(html).toContain("Review as draft");
    expect(html).toContain("Dismiss suggestion");
    expect(html).toContain("SQL");
  });

  it("hides questions once none are visible", () => {
    const html = render(payload("suggestion", { canApply: true, questions: false }));
    expect(html).not.toContain("Skip questions");
    expect(html).toContain("Review as draft");
  });

  it("turns the primary action into Open achievement when a confirmed one exists", () => {
    const html = render(payload("suggestion", {
      canApply: false, block: "ACHIEVEMENT_CONFIRMED", questions: false,
      achievement: { id: ACHIEVEMENT_ID, revision: 4, status: "confirmed", appliedRevision: 1 },
    }));
    expect(html).toContain("Open Achievement");
    expect(html).not.toContain("Review as draft");
    expect(html).toContain(`/achievements/${ACHIEVEMENT_ID}`);
  });

  it("offers Open achievement plus Review as draft when a refresh is allowed", () => {
    const html = render(payload("suggestion", {
      canApply: true, questions: false,
      achievement: { id: ACHIEVEMENT_ID, revision: 2, status: "draft", appliedRevision: 2 },
    }));
    expect(html).toContain("Open Achievement");
    expect(html).toContain("Review as draft");
  });

  it("shows a suppressed suggestion without apply controls", () => {
    const html = render(payload("suppressed", { block: "AI_SUGGESTION_DISMISSED" }));
    expect(html).toContain("dismissed");
    expect(html).not.toContain("Review as draft");
  });

  it("links to the draft when the suggestion was applied", () => {
    const html = render(payload("applied", { achievement: { id: ACHIEVEMENT_ID, revision: 2, status: "draft", appliedRevision: 2 } }));
    expect(html).toContain("Open Achievement");
    expect(html).not.toContain("Review as draft");
  });

  it("renders Indonesian copy", () => {
    const html = render(payload("none"), { locale: "id" });
    expect(html).toContain("Analisis dengan AI");
  });

  it("renders a loading status before the first payload arrives", () => {
    const html = render(null);
    expect(html).toContain('role="status"');
  });
});

describe("AiSuggestionAside", () => {
  it("is read-only and labelled as not applied", () => {
    const html = renderToStaticMarkup(
      <AiSuggestionAside locale="en" suggestion={RESULT.suggestion!} blockReason="DRAFT_EDITED" />,
    );
    expect(html).toContain("AI suggestion (not applied)");
    expect(html).toContain("Faster reconciliation");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<form");
  });
});

