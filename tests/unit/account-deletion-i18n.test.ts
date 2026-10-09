import { describe, expect, it } from "vitest";

import { ACCOUNT_DELETION_MESSAGE_KEYS } from "@/features/account/deletion-service";
import { t, type MessageKey } from "@/i18n/messages";

const KEYS = [
  "auth.accountDeleted", "auth.accountDeleting", "cv.export.error.retryUnavailable", "import.review.autoCancelNotice",
  "account.delete.title", "account.delete.privacy", "account.delete.trigger", "account.delete.dialogTitle",
  "account.delete.dialogDescription", "account.delete.previewHeading", "account.delete.previewLoading",
  "account.delete.previewUnavailable", "account.delete.countActivities", "account.delete.countAchievements",
  "account.delete.countProjects", "account.delete.countEvidence", "account.delete.countImports",
  "account.delete.countExports", "account.delete.cvPresent", "account.delete.cvAbsent", "account.delete.passwordLabel",
  "account.delete.passwordHelp", "account.delete.confirmLabel", "account.delete.confirmHelp", "account.delete.cancel",
  "account.delete.confirm", "account.delete.submitting", "account.delete.error.invalidPassword",
  "account.delete.error.passwordRequired", "account.delete.error.confirmationMismatch",
] as const satisfies readonly MessageKey[];

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

describe("T23 account deletion copy", () => {
  it("has English and Indonesian text for every new key", () => {
    for (const key of KEYS) {
      expect(t("en", key).trim(), `${key} en`).not.toBe("");
      expect(t("id", key).trim(), `${key} id`).not.toBe("");
    }
  });

  it("uses the same placeholders in both languages", () => {
    for (const key of KEYS) expect(placeholders(t("id", key)), key).toEqual(placeholders(t("en", key)));
  });

  it("covers every deletion error code with a key", () => {
    for (const messageKey of Object.values(ACCOUNT_DELETION_MESSAGE_KEYS)) {
      expect(t("en", messageKey).trim(), messageKey).not.toBe("");
      expect(t("id", messageKey).trim(), messageKey).not.toBe("");
    }
  });

  it("contains no em dash and no emoji", () => {
    for (const key of KEYS) {
      for (const locale of ["en", "id"] as const) {
        const text = t(locale, key, { count: 1, email: "a@b.co", date: "1 Jan" });
        expect(text, `${key} ${locale}`).not.toMatch(/—/);
        expect(text, `${key} ${locale}`).not.toMatch(/\p{Extended_Pictographic}/u);
      }
    }
  });

  it("states the 24 hour and 30 day windows in the privacy detail", () => {
    for (const locale of ["en", "id"] as const) {
      const text = t(locale, "account.delete.privacy");
      expect(text).toContain("24");
      expect(text).toContain("30");
    }
  });
});
