"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useFormStatus } from "react-dom";

export { fieldErrorControlProps, fieldErrorId } from "@/components/forms/field-error-binding";
import { InlineError } from "@/components/ui/inline-error";
import { useToast } from "@/components/ui/toast";
import type { ActionState } from "@/server/action-result";
import { t, type Locale } from "@/i18n/messages";

export function ActionFeedback({
  state,
  locale,
  returnTo,
}: {
  state: ActionState;
  locale: Locale;
  returnTo?: string;
}) {
  const showToast = useToast();
  const { pending } = useFormStatus();

  useEffect(() => {
    if (state.status === "success" && state.messageKey) {
      showToast(t(locale, state.messageKey), "success");
    } else if (state.status === "error") {
      showToast(t(locale, state.error.messageKey), "danger");
    }
  }, [locale, showToast, state]);

  if (pending || state.status === "idle") return null;
  if (state.status === "success") {
    return state.messageKey ? (
      <p role="status" className="ui-message ui-message--success">
        {t(locale, state.messageKey)}
      </p>
    ) : null;
  }

  return (
    <InlineError correlationId={state.error.correlationId} className="space-y-2">
      <p>{t(locale, state.error.messageKey)}</p>
      {state.error.code === "UNAUTHENTICATED" ? (
        <Link
          className="font-semibold underline underline-offset-4"
          href={"/sign-in?returnTo=" + encodeURIComponent(returnTo ?? "/settings/profile")}
        >
          {t(locale, "auth.signIn")}
        </Link>
      ) : null}
    </InlineError>
  );
}

export function FieldError({
  state,
  field,
  locale,
  id,
}: {
  state: ActionState;
  field: string;
  locale: Locale;
  id: string;
}) {
  if (state.status !== "error") {
    return <span id={id} className="sr-only" />;
  }
  const messageKey = state.error.fieldErrors?.[field];
  return (
    <span
      id={id}
      role={messageKey ? "status" : undefined}
      aria-live={messageKey ? "polite" : undefined}
      className={messageKey ? "field-error" : "sr-only"}
    >
      {messageKey ? t(locale, messageKey) : ""}
    </span>
  );
}
