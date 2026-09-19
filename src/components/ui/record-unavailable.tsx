import Link from "next/link";

import { t, type Locale } from "@/i18n/messages";

export function RecordUnavailable({
  locale,
  backHref = "/dashboard",
  backLabel,
}: {
  locale: Locale;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <section className="app-card space-y-3" aria-labelledby="record-unavailable-title">
      <h1 id="record-unavailable-title" className="text-2xl font-semibold">
        {t(locale, "common.recordUnavailableTitle")}
      </h1>
      <p className="text-sm text-[var(--color-text-secondary)]">
        {t(locale, "common.recordUnavailableDescription")}
      </p>
      <Link className="button-secondary mt-2" href={backHref}>
        {backLabel ?? t(locale, backHref === "/dashboard" ? "workspace.dashboard" : "activity.back")}
      </Link>
    </section>
  );
}
