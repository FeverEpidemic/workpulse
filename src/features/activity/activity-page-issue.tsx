import Link from "next/link";

import { InlineError } from "@/components/ui/inline-error";
import type { MessageKey, Locale } from "@/i18n/messages";
import { t } from "@/i18n/messages";

export function ActivityPageIssue({
  locale,
  messageKey = "error.unavailable",
  correlationId,
  retryHref,
  signInReturnTo,
}: {
  locale: Locale;
  messageKey?: MessageKey;
  correlationId?: string;
  retryHref: string;
  signInReturnTo?: string;
}) {
  return (
    <section className="space-y-3" aria-labelledby="activity-page-issue-title">
      <h2 id="activity-page-issue-title" className="text-lg font-semibold">{t(locale, "activity.listUnavailableTitle")}</h2>
      <InlineError correlationId={correlationId}>
        <p>{t(locale, messageKey)}</p>
        <div className="flex flex-wrap gap-2">
          <Link className="button-secondary" href={retryHref}>{t(locale, "activity.retry")}</Link>
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
