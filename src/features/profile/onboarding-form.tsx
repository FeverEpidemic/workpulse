"use client";

import { useActionState, useEffect } from "react";

import { ActionFeedback, FieldError, fieldErrorControlProps, fieldErrorId } from "@/components/forms/action-feedback";
import { ConflictControls } from "@/components/forms/conflict-controls";
import { SubmitButton } from "@/components/forms/submit-button";
import { sessionDraftStorageKey, useSessionDraft } from "@/components/forms/session-draft";
import { completeOnboardingAction } from "@/features/profile/actions";
import { IDLE_ACTION_STATE } from "@/server/action-result";
import type { ProfileRow } from "@/domain/database-types";
import { t, type Locale } from "@/i18n/messages";
import { PROFILE_FIELD_LIMITS } from "@/domain/profile/field-contract";

export function OnboardingForm({ profile, locale }: { profile: ProfileRow; locale: Locale }) {
  const [state, action, pending] = useActionState(completeOnboardingAction, IDLE_ACTION_STATE);
  const draftStorageKey = sessionDraftStorageKey(profile.id, "onboarding-profile");
  const { formRef, onInputCapture, onChangeCapture } = useSessionDraft("onboarding-profile", profile.id, state);
  const displayNameErrorId = fieldErrorId("onboarding-profile-form", "display_name");
  const localeErrorId = fieldErrorId("onboarding-profile-form", "locale");
  const timezoneErrorId = fieldErrorId("onboarding-profile-form", "timezone");

  useEffect(() => {
    const form = formRef.current;
    if (!form || profile.timezone !== "UTC") return;
    try {
      if (draftStorageKey && sessionStorage.getItem(draftStorageKey)) return;
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const timezone = form.elements.namedItem("timezone");
      if (timezone instanceof HTMLInputElement && detected) {
        timezone.value = detected;
        timezone.dispatchEvent(new Event("input", { bubbles: true }));
      }
    } catch {
      // UTC remains the safe default when the browser does not report an IANA zone.
    }
  }, [draftStorageKey, formRef, profile.timezone]);

  return (
    <form
      id="onboarding-profile-form"
      ref={formRef}
      action={action}
      onInputCapture={onInputCapture}
      onChangeCapture={onChangeCapture}
      className="space-y-5"
    >
      <input type="hidden" name="expected_revision" defaultValue={profile.revision} />
      <div>
        <label className="field-label" htmlFor="onboarding-display-name">
          {t(locale, "onboarding.displayName")}
          <input
            className="field-input mt-1"
            id="onboarding-display-name"
            name="display_name"
            defaultValue={profile.display_name === "Pending onboarding" ? "" : profile.display_name}
            autoComplete="name"
            maxLength={PROFILE_FIELD_LIMITS.displayName}
            required
            {...fieldErrorControlProps(state, "display_name", displayNameErrorId)}
          />
        </label>
        <FieldError state={state} field="display_name" locale={locale} id={displayNameErrorId} />
      </div>
      <div>
        <label className="field-label" htmlFor="onboarding-locale">
          {t(locale, "onboarding.language")}
          <select className="field-input mt-1" id="onboarding-locale" name="locale" defaultValue={locale} {...fieldErrorControlProps(state, "locale", localeErrorId)}>
            <option value="en">English</option>
            <option value="id">Bahasa Indonesia</option>
          </select>
        </label>
        <FieldError state={state} field="locale" locale={locale} id={localeErrorId} />
      </div>
      <div>
        <label className="field-label" htmlFor="onboarding-timezone">
          {t(locale, "onboarding.timezone")}
          <input className="field-input mt-1" id="onboarding-timezone" name="timezone" defaultValue={profile.timezone || "UTC"} maxLength={PROFILE_FIELD_LIMITS.timezone} {...fieldErrorControlProps(state, "timezone", timezoneErrorId, ["onboarding-timezone-help"])} />
        </label>
        <p id="onboarding-timezone-help" className="field-help">{t(locale, "onboarding.timezoneHelp")}</p>
        <FieldError state={state} field="timezone" locale={locale} id={timezoneErrorId} />
      </div>
      <ActionFeedback state={state} locale={locale} returnTo="/settings/profile?mode=onboarding" />
      <ConflictControls
        state={state}
        formId="onboarding-profile-form"
        locale={locale}
        formKind="onboarding"
        ownerId={profile.id}
        draftKey="onboarding-profile"
      />
      <SubmitButton pendingLabel={t(locale, "common.loading")}>{t(locale, "onboarding.continue")}</SubmitButton>
      {pending ? <span className="sr-only" role="status">{t(locale, "common.loading")}</span> : null}
    </form>
  );
}
