import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { rootDestination } from "@/domain/routes/root-destination";
import { LandingPage } from "@/features/marketing/landing-page";
import { t } from "@/i18n/messages";
import { getRequestContext, getRequestLocale } from "@/server/auth/context";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return { title: t(locale, "landing.meta.title"), description: t(locale, "landing.meta.description") };
}

export default async function HomePage() {
  const [context, locale] = await Promise.all([getRequestContext(), getRequestLocale()]);
  const destination = rootDestination(context);
  if (destination.kind === "redirect") redirect(destination.to);
  return <LandingPage locale={locale} />;
}
