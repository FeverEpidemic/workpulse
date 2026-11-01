import type { Metadata } from "next";

import { privacyEn } from "@/features/legal/content/privacy.en";
import { privacyId } from "@/features/legal/content/privacy.id";
import { termsEn } from "@/features/legal/content/terms.en";
import { termsId } from "@/features/legal/content/terms.id";
import type { LegalDocument } from "@/features/legal/content/types";
import { LEGAL_DRAFT } from "@/features/legal/legal-status";
import { t, type Locale } from "@/i18n/messages";

export type LegalKind = "privacy" | "terms";

const DOCUMENTS: Record<LegalKind, Record<Locale, LegalDocument>> = {
  privacy: { en: privacyEn, id: privacyId },
  terms: { en: termsEn, id: termsId },
};

export function legalDocument(kind: LegalKind, locale: Locale): LegalDocument {
  return DOCUMENTS[kind][locale];
}

export function legalMetadata(kind: LegalKind, locale: Locale): Metadata {
  return {
    title: `${t(locale, `legal.${kind}.title`)} · WorkPulse`,
    description: t(locale, `legal.${kind}.description`),
    ...(LEGAL_DRAFT ? { robots: { index: false, follow: true } } : {}),
  };
}
