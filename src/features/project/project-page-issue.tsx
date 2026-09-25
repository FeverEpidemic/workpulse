import Link from "next/link";

import { InlineError } from "@/components/ui/inline-error";
import type { Locale, MessageKey } from "@/i18n/messages";
import { t } from "@/i18n/messages";

export function ProjectPageIssue({
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
    <section className="space-y-3" aria-labelledby="project-page-issue-title">
      <h2 id="project-page-issue-title" className="text-lg font-semibold">{t(locale, "project.listUnavailableTitle")}</h2>
      <InlineError correlationId={correlationId}>
        <p>{t(locale, messageKey)}</p>
        <div className="flex flex-wrap gap-2">
          <Link className="button-secondary" href={retryHref}>{t(locale, "project.retry")}</Link>
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
