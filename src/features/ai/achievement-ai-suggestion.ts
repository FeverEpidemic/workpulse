import type { ApplyBlockReason } from "@/domain/ai/analysis-view";
import type { DetectResult } from "@/domain/ai/detect-result";
import type { AnalysisViewPayload } from "@/features/ai/ai-review-service";

export interface AchievementAiSuggestion {
  suggestion: NonNullable<DetectResult["suggestion"]>;
  /** Read-only aside is shown only when a newer suggestion exists that must not overwrite this record. */
  showAside: boolean;
  blockReason: ApplyBlockReason | null;
  /** Skill labels the user may add explicitly; never linked automatically. */
  skills: string[];
}

/** S08 view of the source activity's latest analysis. Null when nothing usable exists. */
export function toAchievementAiSuggestion(
  payload: AnalysisViewPayload | null,
  achievementId: string,
  achievementStatus: "draft" | "confirmed" | "dismissed",
): AchievementAiSuggestion | null {
  const suggestion = payload?.job?.result?.suggestion ?? null;
  if (!payload || !suggestion) return null;
  if (payload.achievement?.id !== achievementId) return null;
  const { state, applyBlockReason } = payload.view;
  if (state !== "suggestion" && state !== "applied") return null;

  const overwriteBlocked = applyBlockReason === "DRAFT_EDITED"
    || applyBlockReason === "ACHIEVEMENT_CONFIRMED"
    || applyBlockReason === "ACHIEVEMENT_DISMISSED";
  return {
    suggestion,
    showAside: state === "suggestion" && overwriteBlocked,
    blockReason: applyBlockReason,
    skills: achievementStatus === "draft" ? suggestion.skills : [],
  };
}
