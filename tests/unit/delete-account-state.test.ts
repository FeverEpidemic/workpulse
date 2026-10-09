import { describe, expect, it } from "vitest";

import {
  deletionConfirmEnabled,
  deletionErrorIsFieldBound,
  deletionFocusTarget,
  previewLines,
} from "@/features/account/delete-account-state";
import { actionFailure, actionSuccess, IDLE_ACTION_STATE } from "@/server/action-result";

const EMAIL = "ani@example.com";

describe("T23 delete account dialog state", () => {
  it("keeps the confirm button disabled until the typed email matches", () => {
    expect(deletionConfirmEnabled(EMAIL, "", false)).toBe(false);
    expect(deletionConfirmEnabled(EMAIL, "ani@example", false)).toBe(false);
    expect(deletionConfirmEnabled(EMAIL, "budi@example.com", false)).toBe(false);
    expect(deletionConfirmEnabled(EMAIL, "ani@example.com", false)).toBe(true);
    expect(deletionConfirmEnabled(EMAIL, "  ANI@Example.com ", false)).toBe(true);
  });

  it("disables the confirm button while the request runs, even with a matching email", () => {
    expect(deletionConfirmEnabled(EMAIL, EMAIL, true)).toBe(false);
  });

  it("sends focus to the field with the error, or to the message when no field is to blame", () => {
    const password = actionFailure("VALIDATION", "account.delete.error.invalidPassword", { fieldErrors: { password: "account.delete.error.invalidPassword" } });
    const confirmation = actionFailure("VALIDATION", "account.delete.error.confirmationMismatch", { fieldErrors: { confirmation: "account.delete.error.confirmationMismatch" } });
    expect(deletionFocusTarget(password)).toBe("password");
    expect(deletionFocusTarget(confirmation)).toBe("confirmation");
    expect(deletionFocusTarget(actionFailure("RATE_LIMITED", "auth.rateLimited"))).toBe("alert");
    expect(deletionFocusTarget(actionFailure("UNAVAILABLE", "error.unavailable"))).toBe("alert");
    expect(deletionFocusTarget(IDLE_ACTION_STATE)).toBeNull();
    expect(deletionFocusTarget(actionSuccess())).toBeNull();
  });

  it("shows a field error at its field and any other error in the dialog alert", () => {
    expect(deletionErrorIsFieldBound(actionFailure("VALIDATION", "error.validation", { fieldErrors: { password: "account.delete.error.passwordRequired" } }))).toBe(true);
    expect(deletionErrorIsFieldBound(actionFailure("RATE_LIMITED", "auth.rateLimited"))).toBe(false);
    expect(deletionErrorIsFieldBound(actionFailure("UNAUTHENTICATED", "auth.signInRequired"))).toBe(false);
    expect(deletionErrorIsFieldBound(IDLE_ACTION_STATE)).toBe(false);
  });

  it("lists each kind of lost data once, with the real counts", () => {
    const lines = previewLines({ activities: 4, achievements: 2, projects: 1, evidence_files: 3, import_batches: 0, has_cv: true, cv_exports: 5 });
    expect(lines).toEqual([
      { key: "account.delete.countActivities", params: { count: 4 } },
      { key: "account.delete.countAchievements", params: { count: 2 } },
      { key: "account.delete.countProjects", params: { count: 1 } },
      { key: "account.delete.countEvidence", params: { count: 3 } },
      { key: "account.delete.countImports", params: { count: 0 } },
      { key: "account.delete.cvPresent" },
      { key: "account.delete.countExports", params: { count: 5 } },
    ]);
    expect(new Set(lines.map((line) => line.key)).size).toBe(lines.length);
  });

  it("says when there is no master CV", () => {
    const lines = previewLines({ activities: 0, achievements: 0, projects: 0, evidence_files: 0, import_batches: 0, has_cv: false, cv_exports: 0 });
    expect(lines.map((line) => line.key)).toContain("account.delete.cvAbsent");
    expect(lines.map((line) => line.key)).not.toContain("account.delete.cvPresent");
  });
});
