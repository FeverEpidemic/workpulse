// Pure view model for the S06 analysis panel and S08 aside. No I/O: the caller (a server
// action or route handler) assembles the inputs from activity/job/review/consent rows.

import type { AiJobKind } from "./contracts.ts";
import type { DetectResult } from "./detect-result.ts";

export const ANALYSIS_STATES = [
  "none", "queued", "running", "failed", "stale", "no_potential", "suggestion", "suppressed", "applied",
] as const;
export type AnalysisState = (typeof ANALYSIS_STATES)[number];

export type ApplyBlockReason =
  | "ACHIEVEMENT_CONFIRMED" | "ACHIEVEMENT_DISMISSED" | "DRAFT_EDITED"
  | "AI_SUGGESTION_DISMISSED" | "CONSENT_REQUIRED";

export interface AnalysisViewJob {
  id: string;
  kind: AiJobKind;
  status: "queued" | "running" | "succeeded" | "failed";
  inputRevision: number;
  attemptCount: number;
  errorCode: string | null;
  /** Already parsed and re-validated by the caller; null means invalid/unavailable even if status is succeeded. */
  result: DetectResult | null;
}

export interface AnalysisViewReview {
  state: "open" | "dismissed" | "applied";
  questionsSkippedAt: string | null;
  answeredAt: string | null;
  appliedAchievementId: string | null;
  appliedAchievementRevision: number | null;
}

export interface AnalysisViewActivity {
  revision: number;
  role: string | null;
  scope: string | null;
  outcome: string | null;
}

export interface AnalysisViewAchievement {
  id: string;
  revision: number;
  status: "draft" | "confirmed" | "dismissed";
  /**
   * The Achievement's own revision immediately after whichever apply last touched it
   * (from the review row that recorded that apply, which may be for an older activity
   * revision than the job currently being viewed). Null when it was never applied by AI
   * (a manual draft) or the content is unknown; either way it cannot be proven untouched.
   */
  appliedRevision: number | null;
}

export interface ToAnalysisViewInput {
  activity: AnalysisViewActivity;
  job: AnalysisViewJob | null;
  review: AnalysisViewReview | null;
  consent: boolean;
  derivedAchievement: AnalysisViewAchievement | null;
}

export interface QuestionView {
  field: "role" | "scope" | "outcome";
  text: string;
}

export interface AnalysisView {
  state: AnalysisState;
  canRetry: boolean;
  canApply: boolean;
  applyBlockReason: ApplyBlockReason | null;
  visibleQuestions: QuestionView[];
}

function fieldFilled(activity: AnalysisViewActivity, field: "role" | "scope" | "outcome"): boolean {
  return activity[field] !== null;
}

export function toAnalysisView(input: ToAnalysisViewInput): AnalysisView {
  const { activity, job, review, consent, derivedAchievement } = input;

  if (!job) {
    return { state: "none", canRetry: false, canApply: false, applyBlockReason: null, visibleQuestions: [] };
  }

  if (job.inputRevision < activity.revision) {
    return { state: "stale", canRetry: false, canApply: false, applyBlockReason: null, visibleQuestions: [] };
  }

  if (job.status === "queued") {
    return { state: "queued", canRetry: false, canApply: false, applyBlockReason: null, visibleQuestions: [] };
  }
  if (job.status === "running") {
    return { state: "running", canRetry: false, canApply: false, applyBlockReason: null, visibleQuestions: [] };
  }
  if (job.status === "failed" || (job.status === "succeeded" && job.result === null)) {
    const canRetry = job.attemptCount < 3 && consent;
    return { state: "failed", canRetry, canApply: false, applyBlockReason: null, visibleQuestions: [] };
  }

  // job.status === "succeeded" && job.result !== null
  const result = job.result as DetectResult;
  if (!result.potential || !result.suggestion) {
    return { state: "no_potential", canRetry: false, canApply: false, applyBlockReason: null, visibleQuestions: [] };
  }

  const dismissed = review?.state === "dismissed";
  const applied = review?.state === "applied";
  const state: AnalysisState = dismissed ? "suppressed" : applied ? "applied" : "suggestion";

  let applyBlockReason: ApplyBlockReason | null = null;
  if (dismissed) {
    applyBlockReason = "AI_SUGGESTION_DISMISSED";
  } else if (!consent) {
    applyBlockReason = "CONSENT_REQUIRED";
  } else if (derivedAchievement) {
    if (derivedAchievement.status === "confirmed") applyBlockReason = "ACHIEVEMENT_CONFIRMED";
    else if (derivedAchievement.status === "dismissed") applyBlockReason = "ACHIEVEMENT_DISMISSED";
    else if (derivedAchievement.appliedRevision !== derivedAchievement.revision) applyBlockReason = "DRAFT_EDITED";
  }
  const canApply = state === "suggestion" && applyBlockReason === null;

  const skipped = review?.questionsSkippedAt !== null && review?.questionsSkippedAt !== undefined;
  const answered = review?.answeredAt !== null && review?.answeredAt !== undefined;
  const visibleQuestions: QuestionView[] = state === "suggestion" && !skipped && !answered
    ? result.questions.filter((question) => !fieldFilled(activity, question.field))
    : [];

  return { state, canRetry: false, canApply, applyBlockReason, visibleQuestions };
}
