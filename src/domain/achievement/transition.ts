import type { AchievementStatus } from "@/domain/achievement/contracts";

export type AchievementAction = "save_draft" | "confirm" | "dismiss" | "reopen" | "save_changes";

const ACHIEVEMENT_ACTIONS: readonly AchievementAction[] = ["save_draft", "confirm", "dismiss", "reopen", "save_changes"];

export function isAchievementAction(value: unknown): value is AchievementAction {
  return typeof value === "string" && ACHIEVEMENT_ACTIONS.includes(value as AchievementAction);
}

export function nextAchievementStatus(current: AchievementStatus, action: AchievementAction): AchievementStatus | null {
  if (action === "save_draft") return current === "confirmed" ? null : current === "dismissed" ? "dismissed" : "draft";
  if (action === "confirm") return current === "draft" ? "confirmed" : null;
  if (action === "dismiss") return current === "draft" ? "dismissed" : null;
  if (action === "reopen") return current === "confirmed" || current === "dismissed" ? "draft" : null;
  if (action === "save_changes") return current === "confirmed" ? "confirmed" : null;
  return null;
}

export function availableAchievementActions(current: AchievementStatus): AchievementAction[] {
  return ACHIEVEMENT_ACTIONS.filter((action) =>
    nextAchievementStatus(current, action) !== null && !(current === "dismissed" && action === "save_draft"),
  );
}

export function isAchievementConfirmable(status: AchievementStatus): boolean {
  return status === "draft";
}
