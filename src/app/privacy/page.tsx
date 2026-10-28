import type { Metadata } from "next";

import { legalMetadata } from "@/features/legal/documents";
import { LegalPage } from "@/features/legal/legal-page";
import { getRequestLocale } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  return legalMetadata("privacy", await getRequestLocale());
}

export default async function PrivacyPage() {
  return <LegalPage kind="privacy" locale={await getRequestLocale()} />;
}
