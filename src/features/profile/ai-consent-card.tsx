"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { ActionFeedback } from "@/components/forms/action-feedback";
import { AiConsentDialog } from "@/components/ui/ai-consent-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AI_CONSENT_VERSION } from "@/domain/ai/contracts";
import { setAiConsentAction } from "@/features/ai/actions";
import { IDLE_ACTION_STATE } from "@/server/action-result";
import { t, type Locale } from "@/i18n/messages";

export type AiConsentCardProfile = {
  revision: number;
  timezone: string;
  ai_consent_at: string | null;
  ai_consent_version: string | null;
};

const FORM_ID = "ai-consent-form";

function formatConsentDate(value: string, locale: Locale, timezone: string): string {
  try {
    return new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone,
    }).format(new Date(value));
  } catch {
    return new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-US", { dateStyle: "medium", timeZone: "UTC" })
      .format(new Date(value));
  }
}

/** S12 AI processing consent: allow via the shared dialog, withdraw with inline confirmation. */
export function AiConsentCard({ profile, locale }: { profile: AiConsentCardProfile; locale: Locale }) {
  const [state, action] = useActionState(setAiConsentAction, IDLE_ACTION_STATE);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const withdrawTriggerRef = useRef<HTMLButtonElement>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const handledResult = useRef<string | null>(null);
  const focusTarget = useRef<"status" | "feedback" | "withdraw" | null>(null);

  function cancelWithdraw() {
    focusTarget.current = "withdraw";
    setConfirmingWithdraw(false);
  }

  const allowed = profile.ai_consent_at !== null && profile.ai_consent_version === AI_CONSENT_VERSION;
  const outdated = profile.ai_consent_at !== null && !allowed;

  useEffect(() => {
    if (state.status === "idle") return;
    const correlationId = state.status === "success" ? state.correlationId : state.error.correlationId;
    if (handledResult.current === correlationId) return;
    handledResult.current = correlationId;
    // Close the modal on success and on error so the result is visible, then move focus to it.
    focusTarget.current = state.status === "success" ? "status" : "feedback";
    setDialogOpen(false);
    setConfirmingWithdraw(false);
  }, [state]);

  // Runs after the Dialog child has closed (child effects flush first), so the native
  // dialog's focus restoration cannot override the result focus.
  useEffect(() => {
    const target = focusTarget.current;
    if (!target || dialogOpen || confirmingWithdraw) return;
    focusTarget.current = null;
    if (target === "withdraw") withdrawTriggerRef.current?.focus();
    else if (target === "feedback") (feedbackRef.current?.querySelector<HTMLElement>("a") ?? statusRef.current)?.focus();
    else statusRef.current?.focus();
  }, [state, dialogOpen, confirmingWithdraw]);

  return (
    <form id={FORM_ID} action={action} className="ai-consent" aria-labelledby="ai-consent-title">
      <input type="hidden" name="expected_revision" value={profile.revision} readOnly />
      <div className="ai-consent-header">
        <h2 id="ai-consent-title" className="text-xl font-semibold">{t(locale, "ai.consent.title")}</h2>
        <Badge>{t(locale, "ai.label")}</Badge>
      </div>
      <p className="text-sm text-[var(--wp-muted)]">{t(locale, "ai.consent.description")}</p>

      <div className="ai-consent-status">
        <p ref={statusRef} tabIndex={-1} className="ai-consent-status-text" data-testid="ai-consent-status">
          {allowed && profile.ai_consent_at
            ? t(locale, "ai.consent.statusOn", { date: formatConsentDate(profile.ai_consent_at, locale, profile.timezone) })
            : outdated
              ? t(locale, "ai.consent.statusOutdated")
              : t(locale, "ai.consent.statusOff")}
        </p>
        {allowed ? (
          <p className="field-help">{t(locale, "ai.consent.version", { version: AI_CONSENT_VERSION })}</p>
        ) : null}
      </div>

      <div ref={feedbackRef} className="space-y-2">
        <ActionFeedback state={state} locale={locale} returnTo="/settings/profile" />
        {state.status === "error" && state.error.code === "CONFLICT" ? (
          <a className="button-secondary inline-flex" href="/settings/profile">{t(locale, "ai.consent.reload")}</a>
        ) : null}
      </div>

      {allowed ? (
        confirmingWithdraw ? (
          <div className="ai-consent-withdraw" role="group" aria-labelledby="ai-consent-withdraw-help">
            <p id="ai-consent-withdraw-help" className="field-help">{t(locale, "ai.consent.withdrawHelp")}</p>
            <div className="ai-consent-actions">
              <Button variant="secondary" autoFocus onClick={cancelWithdraw}>
                {t(locale, "ai.consent.keep")}
              </Button>
              <WithdrawSubmit locale={locale} />
            </div>
          </div>
        ) : (
          <div className="ai-consent-actions">
            <button ref={withdrawTriggerRef} type="button" className="button-secondary" onClick={() => setConfirmingWithdraw(true)}>
              {t(locale, "ai.consent.withdraw")}
            </button>
          </div>
        )
      ) : (
        <div className="ai-consent-actions">
          <Button variant="secondary" onClick={() => setDialogOpen(true)}>
            {t(locale, "ai.consent.allow")}
          </Button>
        </div>
      )}

      <AiConsentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        locale={locale}
        allowControl={<AllowSubmit locale={locale} />}
      />
    </form>
  );
}

function AllowSubmit({ locale }: { locale: Locale }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" name="consent" value="allow" loading={pending} loadingLabel={t(locale, "common.loading")}>
      {t(locale, "ai.consent.dialogAllow")}
    </Button>
  );
}

function WithdrawSubmit({ locale }: { locale: Locale }) {
  const { pending } = useFormStatus();
  return (
    <Button variant="secondary" type="submit" name="consent" value="withdraw" loading={pending} loadingLabel={t(locale, "common.loading")}>
      {t(locale, "ai.consent.withdrawConfirm")}
    </Button>
  );
}
