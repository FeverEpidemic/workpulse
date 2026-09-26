import Link from "next/link";

import { InlineError } from "@/components/ui/inline-error";
import { t, type Locale, type MessageKey } from "@/i18n/messages";

export function DashboardIssue({
  locale,
  retryHref,
  correlationId,
  titleKey = "dashboard.unavailableTitle",
  messageKey = "error.unavailable",
  signInReturnTo,
}: {
  locale: Locale;
  retryHref: string;
  correlationId?: string;
  titleKey?: MessageKey;
  messageKey?: MessageKey;
  signInReturnTo?: string;
}) {
  return (
    <section className="dashboard-issue" aria-labelledby="dashboard-issue-title">
      <h2 id="dashboard-issue-title">{t(locale, titleKey)}</h2>
      <InlineError correlationId={correlationId}>
        <p>{t(locale, messageKey)}</p>
        <div className="dashboard-issue-actions">
          <Link className="button-secondary" href={retryHref}>{t(locale, "dashboard.retry")}</Link>
          {signInReturnTo ? (
            <Link className="button-secondary" href={`/sign-in?returnTo=${encodeURIComponent(signInReturnTo)}`}>
              {t(locale, "auth.signIn")}
            </Link>
          ) : null}
        </div>
      </InlineError>
    </section>
  );
}
