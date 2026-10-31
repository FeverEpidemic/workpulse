import type { Metadata } from "next";

import { legalMetadata } from "@/features/legal/documents";
import { LegalPage, legalPageSignedIn } from "@/features/legal/legal-page";
import { getRequestContext, getRequestLocale } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return legalMetadata("privacy", await getRequestLocale());
}

export default async function PrivacyPage() {
  const [context, locale] = await Promise.all([getRequestContext(), getRequestLocale()]);
  return <LegalPage kind="privacy" locale={locale} signedIn={legalPageSignedIn(context)} />;
}
