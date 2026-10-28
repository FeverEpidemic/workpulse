import { redirect } from "next/navigation";

import { rootDestination } from "@/domain/routes/root-destination";
import { t } from "@/i18n/messages";
import { getRequestContext, getRequestLocale } from "@/server/auth/context";

export default async function HomePage() {
  const [context, locale] = await Promise.all([getRequestContext(), getRequestLocale()]);
  const destination = rootDestination(context);
  if (destination.kind === "redirect") redirect(destination.to);

  // T32 Fase 2 placeholder; Fase 3 replaces it with the landing page.
  return (
    <main id="main-content">
      <h1>{t(locale, "landing.hero.title")}</h1>
    </main>
  );
}
