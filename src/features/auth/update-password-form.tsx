"use client";

import { useActionState } from "react";

import { ActionFeedback, FieldError, fieldErrorControlProps, fieldErrorId } from "@/components/forms/action-feedback";
import { SubmitButton } from "@/components/forms/submit-button";
import { updatePasswordAction } from "@/server/auth/actions";
import { IDLE_ACTION_STATE } from "@/server/action-result";
import { t, type Locale } from "@/i18n/messages";
import { AUTH_FIELD_LIMITS } from "@/domain/profile/field-contract";

export function UpdatePasswordForm({ locale }: { locale: Locale }) {
  const [state, action] = useActionState(updatePasswordAction, IDLE_ACTION_STATE);
  const passwordErrorId = fieldErrorId("update-password-form", "password");
  const confirmPasswordErrorId = fieldErrorId("update-password-form", "confirm_password");
  return (
    <form id="update-password-form" action={action} className="space-y-4">
      <label className="field-label" htmlFor="new-password">
        {t(locale, "auth.password")}
        <input className="field-input mt-1" id="new-password" name="password" type="password" autoComplete="new-password" minLength={8} maxLength={AUTH_FIELD_LIMITS.password} required {...fieldErrorControlProps(state, "password", passwordErrorId)} />
      </label>
      <FieldError state={state} field="password" locale={locale} id={passwordErrorId} />
      <label className="field-label" htmlFor="confirm-password">
        {t(locale, "auth.confirmPassword")}
        <input className="field-input mt-1" id="confirm-password" name="confirm_password" type="password" autoComplete="new-password" minLength={8} maxLength={AUTH_FIELD_LIMITS.password} required {...fieldErrorControlProps(state, "confirm_password", confirmPasswordErrorId)} />
      </label>
      <FieldError state={state} field="confirm_password" locale={locale} id={confirmPasswordErrorId} />
      <ActionFeedback state={state} locale={locale} returnTo="/dashboard" />
      <SubmitButton pendingLabel={t(locale, "common.loading")}>{t(locale, "auth.updatePassword")}</SubmitButton>
    </form>
  );
}
