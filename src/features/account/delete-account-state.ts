import { confirmationMatches, type AccountDeletionPreview } from "../../domain/account/deletion.ts";
import type { MessageKey } from "../../i18n/messages.ts";
import { IDLE_ACTION_STATE, type ActionState } from "../../server/action-result.ts";

/** The confirm button stays disabled until the typed email equals the account email and no request is running. */
export function deletionConfirmEnabled(accountEmail: string, typedConfirmation: string, pending: boolean): boolean {
  return !pending && confirmationMatches(accountEmail, typedConfirmation);
}

export type DeletionFocusTarget = "password" | "confirmation" | "alert";

/** Where focus goes after a failed attempt: the field with the error, or the message when no field is to blame. */
export function deletionFocusTarget(state: ActionState): DeletionFocusTarget | null {
  if (state.status !== "error") return null;
  const fields = state.error.fieldErrors ?? {};
  if (fields.password) return "password";
  if (fields.confirmation) return "confirmation";
  return "alert";
}

/** True when the error belongs to a field and is shown there instead of in the dialog alert. */
export function deletionErrorIsFieldBound(state: ActionState): boolean {
  if (state.status !== "error") return false;
  const fields = state.error.fieldErrors ?? {};
  return Boolean(fields.password || fields.confirmation);
}

/** The action state persists across dialog openings; an error the user closed the dialog on is not shown again. */
export function visibleDeletionState(state: ActionState, dismissedCorrelationId: string | null): ActionState {
  if (state.status === "error" && state.error.correlationId === dismissedCorrelationId) return IDLE_ACTION_STATE;
  return state;
}

export type PreviewLine = { key: MessageKey; params?: { count: number } };

/** One line per kind of data that is lost, in the order the dialog lists them. */
export function previewLines(preview: AccountDeletionPreview): PreviewLine[] {
  return [
    { key: "account.delete.countActivities", params: { count: preview.activities } },
    { key: "account.delete.countAchievements", params: { count: preview.achievements } },
    { key: "account.delete.countProjects", params: { count: preview.projects } },
    { key: "account.delete.countEvidence", params: { count: preview.evidence_files } },
    { key: "account.delete.countImports", params: { count: preview.import_batches } },
    { key: preview.has_cv ? "account.delete.cvPresent" : "account.delete.cvAbsent" },
    { key: "account.delete.countExports", params: { count: preview.cv_exports } },
  ];
}
