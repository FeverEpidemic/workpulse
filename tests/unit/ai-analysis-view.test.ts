import { describe, expect, it } from "vitest";

import { toAnalysisView, type ToAnalysisViewInput } from "@/domain/ai/analysis-view";
import type { DetectResult } from "@/domain/ai/detect-result";

const suggestionResult: DetectResult = {
  schema_version: "detect.v1",
  potential: true,
  suggestion: {
    title: "Migrated 3 reports",
    contribution: "Led the migration",
    outcome: "Reduced manual steps",
    role: null,
    scope: null,
    cv_bullet: "Migrated 3 reports",
    metrics: [],
    skills: [],
  },
  questions: [{ field: "outcome", text: "What was the outcome?" }],
};

const noPotentialResult: DetectResult = { schema_version: "detect.v1", potential: false, suggestion: null, questions: [] };

function base(overrides: Partial<ToAnalysisViewInput> = {}): ToAnalysisViewInput {
  return {
    activity: { revision: 1, role: null, scope: null, outcome: null },
    job: null,
    review: null,
    consent: true,
    derivedAchievement: null,
    ...overrides,
  };
}

describe("toAnalysisView", () => {
  it("is none without a job", () => {
    expect(toAnalysisView(base()).state).toBe("none");
  });

  it("is stale when the job's input revision is behind the activity's current revision", () => {
    const view = toAnalysisView(base({
      activity: { revision: 2, role: null, scope: null, outcome: null },
      job: { id: "j1", kind: "detect", status: "succeeded", inputRevision: 1, attemptCount: 1, errorCode: null, result: suggestionResult },
    }));
    expect(view.state).toBe("stale");
    expect(view.canApply).toBe(false);
    expect(view.canRetry).toBe(false);
  });

  it("reflects queued and running without claiming a result", () => {
    const queued = toAnalysisView(base({ job: { id: "j1", kind: "detect", status: "queued", inputRevision: 1, attemptCount: 0, errorCode: null, result: null } }));
    expect(queued.state).toBe("queued");
    const running = toAnalysisView(base({ job: { id: "j1", kind: "detect", status: "running", inputRevision: 1, attemptCount: 1, errorCode: null, result: null } }));
    expect(running.state).toBe("running");
  });

  it("allows retry only under 3 attempts and with current consent", () => {
    const underLimit = toAnalysisView(base({ job: { id: "j1", kind: "detect", status: "failed", inputRevision: 1, attemptCount: 2, errorCode: "AI_UNAVAILABLE", result: null } }));
    expect(underLimit.state).toBe("failed");
    expect(underLimit.canRetry).toBe(true);

    const atLimit = toAnalysisView(base({ job: { id: "j1", kind: "detect", status: "failed", inputRevision: 1, attemptCount: 3, errorCode: "AI_UNAVAILABLE", result: null } }));
    expect(atLimit.canRetry).toBe(false);

    const noConsent = toAnalysisView(base({
      consent: false,
      job: { id: "j1", kind: "detect", status: "failed", inputRevision: 1, attemptCount: 1, errorCode: "AI_UNAVAILABLE", result: null },
    }));
    expect(noConsent.canRetry).toBe(false);
  });

  it("treats a succeeded job with no result as failed (re-validation failure)", () => {
    const view = toAnalysisView(base({ job: { id: "j1", kind: "detect", status: "succeeded", inputRevision: 1, attemptCount: 1, errorCode: null, result: null } }));
    expect(view.state).toBe("failed");
  });

  it("is no_potential for a succeeded job without a suggestion", () => {
    const view = toAnalysisView(base({ job: { id: "j1", kind: "detect", status: "succeeded", inputRevision: 1, attemptCount: 1, errorCode: null, result: noPotentialResult } }));
    expect(view.state).toBe("no_potential");
    expect(view.canApply).toBe(false);
  });

  it("is suggestion with an applyable state when nothing blocks it", () => {
    const view = toAnalysisView(base({ job: { id: "j1", kind: "detect", status: "succeeded", inputRevision: 1, attemptCount: 1, errorCode: null, result: suggestionResult } }));
    expect(view.state).toBe("suggestion");
    expect(view.canApply).toBe(true);
    expect(view.applyBlockReason).toBeNull();
  });

  it("filters visibleQuestions to fields still empty on the activity", () => {
    const filled = toAnalysisView(base({
      activity: { revision: 1, role: null, scope: null, outcome: "Already answered" },
      job: { id: "j1", kind: "detect", status: "succeeded", inputRevision: 1, attemptCount: 1, errorCode: null, result: suggestionResult },
    }));
    expect(filled.visibleQuestions).toEqual([]);
  });

  it("hides questions after skip or answer", () => {
    const skipped = toAnalysisView(base({
      job: { id: "j1", kind: "detect", status: "succeeded", inputRevision: 1, attemptCount: 1, errorCode: null, result: suggestionResult },
      review: { state: "open", questionsSkippedAt: "2026-09-28T00:00:00Z", answeredAt: null, appliedAchievementId: null, appliedAchievementRevision: null },
    }));
    expect(skipped.visibleQuestions).toEqual([]);
  });

  it("is suppressed once dismissed, and apply is blocked", () => {
    const view = toAnalysisView(base({
      job: { id: "j1", kind: "detect", status: "succeeded", inputRevision: 1, attemptCount: 1, errorCode: null, result: suggestionResult },
      review: { state: "dismissed", questionsSkippedAt: null, answeredAt: null, appliedAchievementId: null, appliedAchievementRevision: null },
    }));
    expect(view.state).toBe("suppressed");
    expect(view.canApply).toBe(false);
    expect(view.applyBlockReason).toBe("AI_SUGGESTION_DISMISSED");
  });

  it("is applied once the review recorded an apply", () => {
    const view = toAnalysisView(base({
      job: { id: "j1", kind: "detect", status: "succeeded", inputRevision: 1, attemptCount: 1, errorCode: null, result: suggestionResult },
      review: { state: "applied", questionsSkippedAt: null, answeredAt: null, appliedAchievementId: "ach1", appliedAchievementRevision: 1 },
      derivedAchievement: { id: "ach1", revision: 1, status: "draft", appliedRevision: 1 },
    }));
    expect(view.state).toBe("applied");
  });

  it("blocks apply when the derived achievement is confirmed or dismissed", () => {
    const confirmed = toAnalysisView(base({
      job: { id: "j1", kind: "detect", status: "succeeded", inputRevision: 1, attemptCount: 1, errorCode: null, result: suggestionResult },
      derivedAchievement: { id: "ach1", revision: 2, status: "confirmed", appliedRevision: 1 },
    }));
    expect(confirmed.canApply).toBe(false);
    expect(confirmed.applyBlockReason).toBe("ACHIEVEMENT_CONFIRMED");

    const dismissed = toAnalysisView(base({
      job: { id: "j1", kind: "detect", status: "succeeded", inputRevision: 1, attemptCount: 1, errorCode: null, result: suggestionResult },
      derivedAchievement: { id: "ach1", revision: 2, status: "dismissed", appliedRevision: 1 },
    }));
    expect(dismissed.applyBlockReason).toBe("ACHIEVEMENT_DISMISSED");
  });

  it("blocks apply on a draft edited since the last apply, allows an untouched one even from an older applied revision", () => {
    // The draft was created by an apply at revision 1 (appliedRevision=1); the user then
    // edited it via save_achievement, bumping its own revision to 2, while a newer
    // suggestion (job at activity revision 2) exists. Edited => blocked.
    const edited = toAnalysisView(base({
      job: { id: "j1", kind: "detect", status: "succeeded", inputRevision: 2, attemptCount: 1, errorCode: null, result: suggestionResult },
      activity: { revision: 2, role: null, scope: null, outcome: null },
      derivedAchievement: { id: "ach1", revision: 2, status: "draft", appliedRevision: 1 },
    }));
    expect(edited.applyBlockReason).toBe("DRAFT_EDITED");

    // Same setup, but nothing touched the draft since that apply (still at revision 1).
    const untouched = toAnalysisView(base({
      job: { id: "j1", kind: "detect", status: "succeeded", inputRevision: 2, attemptCount: 1, errorCode: null, result: suggestionResult },
      activity: { revision: 2, role: null, scope: null, outcome: null },
      derivedAchievement: { id: "ach1", revision: 1, status: "draft", appliedRevision: 1 },
    }));
    expect(untouched.canApply).toBe(true);
    expect(untouched.applyBlockReason).toBeNull();
  });

  it("requires consent to apply even when the suggestion is otherwise applyable", () => {
    const view = toAnalysisView(base({
      consent: false,
      job: { id: "j1", kind: "detect", status: "succeeded", inputRevision: 1, attemptCount: 1, errorCode: null, result: suggestionResult },
    }));
    expect(view.canApply).toBe(false);
    expect(view.applyBlockReason).toBe("CONSENT_REQUIRED");
  });
});
