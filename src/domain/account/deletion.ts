import * as z from "zod";

export const ACCOUNT_DELETION_ERROR_CODES = [
  "VALIDATION",
  "CONFIRMATION_MISMATCH",
  "INVALID_PASSWORD",
  "RATE_LIMITED",
  "UNAUTHENTICATED",
  "UNAVAILABLE",
] as const;
export type AccountDeletionErrorCode = (typeof ACCOUNT_DELETION_ERROR_CODES)[number];

export const accountDeletionInputSchema = z.strictObject({
  password: z.string().min(1).max(200),
  confirmation: z.string().min(1).max(320),
});
export type AccountDeletionInput = z.infer<typeof accountDeletionInputSchema>;

/** The typed email must equal the session email, ignoring case and surrounding spaces. */
export function confirmationMatches(sessionEmail: string | null | undefined, typed: string): boolean {
  const expected = (sessionEmail ?? "").trim().toLowerCase();
  const actual = typed.trim().toLowerCase();
  return expected !== "" && expected === actual;
}

const count = z.number().int().min(0);

/** Counts shown in the confirmation dialog; no record content. */
export const accountDeletionPreviewSchema = z.strictObject({
  activities: count,
  achievements: count,
  projects: count,
  evidence_files: count,
  import_batches: count,
  has_cv: z.boolean(),
  cv_exports: count,
});
export type AccountDeletionPreview = z.infer<typeof accountDeletionPreviewSchema>;
