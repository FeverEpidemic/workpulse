import { describe, expect, it } from "vitest";

import {
  ACCOUNT_DELETION_ERROR_CODES,
  accountDeletionInputSchema,
  accountDeletionPreviewSchema,
  confirmationMatches,
} from "@/domain/account/deletion";

describe("T23 account deletion domain", () => {
  it("accepts a password and a confirmation, and nothing else", () => {
    expect(accountDeletionInputSchema.safeParse({ password: "secret-pass", confirmation: "ani@example.com" }).success).toBe(true);
    expect(accountDeletionInputSchema.safeParse({ password: "", confirmation: "ani@example.com" }).success).toBe(false);
    expect(accountDeletionInputSchema.safeParse({ password: "x", confirmation: "" }).success).toBe(false);
    expect(accountDeletionInputSchema.safeParse({ password: "x".repeat(201), confirmation: "a@b.co" }).success).toBe(false);
    expect(accountDeletionInputSchema.safeParse({ password: "x", confirmation: "a@b.co", email: "other@example.com" }).success).toBe(false);
  });

  it("matches the session email ignoring case and surrounding spaces", () => {
    expect(confirmationMatches("Ani@Example.com", "ani@example.com")).toBe(true);
    expect(confirmationMatches("ani@example.com", "  ANI@example.COM  ")).toBe(true);
  });

  it("rejects another email, a partial email and an empty confirmation", () => {
    expect(confirmationMatches("ani@example.com", "budi@example.com")).toBe(false);
    expect(confirmationMatches("ani@example.com", "ani@example")).toBe(false);
    expect(confirmationMatches("ani@example.com", "")).toBe(false);
    expect(confirmationMatches("ani@example.com", "   ")).toBe(false);
  });

  it("never matches when the session has no email", () => {
    expect(confirmationMatches(null, "")).toBe(false);
    expect(confirmationMatches(undefined, "anything")).toBe(false);
    expect(confirmationMatches("", "")).toBe(false);
  });

  it("parses the preview counts strictly", () => {
    const preview = { activities: 3, achievements: 2, projects: 1, evidence_files: 0, import_batches: 1, has_cv: true, cv_exports: 4 };
    expect(accountDeletionPreviewSchema.parse(preview)).toEqual(preview);
    expect(accountDeletionPreviewSchema.safeParse({ ...preview, activities: -1 }).success).toBe(false);
    expect(accountDeletionPreviewSchema.safeParse({ ...preview, has_cv: "yes" }).success).toBe(false);
    expect(accountDeletionPreviewSchema.safeParse({ ...preview, raw_text: "secret" }).success).toBe(false);
  });

  it("lists the error codes the service and the actions use", () => {
    expect([...ACCOUNT_DELETION_ERROR_CODES]).toEqual([
      "VALIDATION", "CONFIRMATION_MISMATCH", "INVALID_PASSWORD", "RATE_LIMITED", "UNAUTHENTICATED", "UNAVAILABLE",
    ]);
  });
});
