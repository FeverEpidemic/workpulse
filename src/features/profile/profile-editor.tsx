"use client";

import { useActionState } from "react";

import { ActionFeedback, FieldError, fieldErrorControlProps, fieldErrorId } from "@/components/forms/action-feedback";
import { ConflictControls } from "@/components/forms/conflict-controls";
import { SubmitButton } from "@/components/forms/submit-button";
import { useSessionDraft } from "@/components/forms/session-draft";
import { useUnsavedForm } from "@/components/ui/unsaved-changes";
import { Input, Select, Textarea } from "@/components/ui/field-control";
import { saveProfileAction } from "@/features/profile/actions";
import { IDLE_ACTION_STATE } from "@/server/action-result";
import type { ProfileRow } from "@/domain/database-types";
import { t, type Locale } from "@/i18n/messages";
import { PROFILE_FIELD_LIMITS } from "@/domain/profile/field-contract";

export function ProfileEditor({ profile, userEmail, locale }: { profile: ProfileRow; userEmail: string; locale: Locale }) {
  const [state, action] = useActionState(saveProfileAction, IDLE_ACTION_STATE);
  const { formRef, onInputCapture, onChangeCapture } = useSessionDraft("profile-settings", profile.id, state);
  const unsaved = useUnsavedForm("profile-settings-form", state);
  const errorIds = {
    display_name: fieldErrorId("profile-settings-form", "display_name"),
    headline: fieldErrorId("profile-settings-form", "headline"),
    summary: fieldErrorId("profile-settings-form", "summary"),
    contact_email: fieldErrorId("profile-settings-form", "contact_email"),
    phone: fieldErrorId("profile-settings-form", "phone"),
    location: fieldErrorId("profile-settings-form", "location"),
    website: fieldErrorId("profile-settings-form", "website"),
    locale: fieldErrorId("profile-settings-form", "locale"),
    timezone: fieldErrorId("profile-settings-form", "timezone"),
  };

  return (
    <form
      id="profile-settings-form"
      ref={formRef}
      action={action}
      onInputCapture={(event) => {
        onInputCapture(event);
        unsaved.onInputCapture(event);
      }}
      onChangeCapture={(event) => {
        onChangeCapture(event);
        unsaved.onChangeCapture(event);
      }}
      className="space-y-5"
    >
      <input type="hidden" name="expected_revision" defaultValue={profile.revision} />
      <p className="text-sm text-[var(--wp-muted)]"><span className="font-semibold">{t(locale, "profile.signInEmail")}:</span> {userEmail}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="field-label" htmlFor="profile-display-name">
            {t(locale, "onboarding.displayName")}
            <Input className="mt-1" id="profile-display-name" name="display_name" defaultValue={profile.display_name} autoComplete="name" maxLength={PROFILE_FIELD_LIMITS.displayName} required {...fieldErrorControlProps(state, "display_name", errorIds.display_name)} />
          </label>
          <FieldError state={state} field="display_name" locale={locale} id={errorIds.display_name} />
        </div>
        <div className="sm:col-span-2">
          <label className="field-label" htmlFor="profile-headline">
            {t(locale, "profile.headline")}
            <Input className="mt-1" id="profile-headline" name="headline" defaultValue={profile.headline ?? ""} maxLength={PROFILE_FIELD_LIMITS.headline} {...fieldErrorControlProps(state, "headline", errorIds.headline)} />
          </label>
          <FieldError state={state} field="headline" locale={locale} id={errorIds.headline} />
        </div>
        <div className="sm:col-span-2">
          <label className="field-label" htmlFor="profile-summary">
            {t(locale, "profile.summary")}
            <Textarea className="mt-1 min-h-28" id="profile-summary" name="summary" defaultValue={profile.summary ?? ""} maxLength={PROFILE_FIELD_LIMITS.summary} rows={4} {...fieldErrorControlProps(state, "summary", errorIds.summary)} />
          </label>
          <FieldError state={state} field="summary" locale={locale} id={errorIds.summary} />
        </div>
        <div>
          <label className="field-label" htmlFor="profile-contact-email">
            {t(locale, "profile.contactEmail")}
            <Input className="mt-1" id="profile-contact-email" name="contact_email" type="email" defaultValue={profile.contact_email ?? ""} maxLength={PROFILE_FIELD_LIMITS.contactEmail} autoComplete="email" {...fieldErrorControlProps(state, "contact_email", errorIds.contact_email)} />
          </label>
          <FieldError state={state} field="contact_email" locale={locale} id={errorIds.contact_email} />
        </div>
        <div>
          <label className="field-label" htmlFor="profile-phone">
            {t(locale, "profile.phone")}
            <Input className="mt-1" id="profile-phone" name="phone" type="tel" defaultValue={profile.phone ?? ""} maxLength={PROFILE_FIELD_LIMITS.phone} autoComplete="tel" {...fieldErrorControlProps(state, "phone", errorIds.phone)} />
          </label>
          <FieldError state={state} field="phone" locale={locale} id={errorIds.phone} />
        </div>
        <div>
          <label className="field-label" htmlFor="profile-location">
            {t(locale, "profile.location")}
            <Input className="mt-1" id="profile-location" name="location" defaultValue={profile.location ?? ""} maxLength={PROFILE_FIELD_LIMITS.location} autoComplete="address-level2" {...fieldErrorControlProps(state, "location", errorIds.location)} />
          </label>
          <FieldError state={state} field="location" locale={locale} id={errorIds.location} />
        </div>
        <div>
          <label className="field-label" htmlFor="profile-website">
            {t(locale, "profile.website")}
            <Input className="mt-1" id="profile-website" name="website" type="url" defaultValue={profile.website ?? ""} maxLength={PROFILE_FIELD_LIMITS.website} autoComplete="url" {...fieldErrorControlProps(state, "website", errorIds.website)} />
          </label>
          <FieldError state={state} field="website" locale={locale} id={errorIds.website} />
        </div>
        <div>
          <label className="field-label" htmlFor="profile-locale">
            {t(locale, "onboarding.language")}
            <Select className="mt-1" id="profile-locale" name="locale" defaultValue={profile.locale} {...fieldErrorControlProps(state, "locale", errorIds.locale, ["profile-locale-help"])}>
              <option value="en">English</option>
              <option value="id">Bahasa Indonesia</option>
            </Select>
          </label>
          <FieldError state={state} field="locale" locale={locale} id={errorIds.locale} />
        </div>
        <div>
          <label className="field-label" htmlFor="profile-timezone">
            {t(locale, "onboarding.timezone")}
            <Input className="mt-1" id="profile-timezone" name="timezone" defaultValue={profile.timezone} maxLength={PROFILE_FIELD_LIMITS.timezone} {...fieldErrorControlProps(state, "timezone", errorIds.timezone)} />
          </label>
          <FieldError state={state} field="timezone" locale={locale} id={errorIds.timezone} />
        </div>
      </div>
      <p id="profile-locale-help" className="field-help">{t(locale, "profile.localeNote")}</p>
      <ActionFeedback state={state} locale={locale} returnTo="/settings/profile" />
      <ConflictControls
        state={state}
        formId="profile-settings-form"
        locale={locale}
        formKind="profile"
        ownerId={profile.id}
        draftKey="profile-settings"
      />
      <SubmitButton pendingLabel={t(locale, "common.loading")}>{t(locale, "profile.save")}</SubmitButton>
    </form>
  );
}
