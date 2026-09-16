"use client";

import { useActionState } from "react";

import { ActionFeedback, FieldError } from "@/components/forms/action-feedback";
import { ConflictControls } from "@/components/forms/conflict-controls";
import { SubmitButton } from "@/components/forms/submit-button";
import { useSessionDraft } from "@/components/forms/session-draft";
import { useUnsavedForm } from "@/components/ui/unsaved-changes";
import { Input, Select, Textarea } from "@/components/ui/field-control";
import { saveProfileAction } from "@/features/profile/actions";
import { IDLE_ACTION_STATE } from "@/server/action-result";
import type { ProfileRow } from "@/domain/database-types";
import { t, type Locale } from "@/i18n/messages";

export function ProfileEditor({ profile, userEmail, locale }: { profile: ProfileRow; userEmail: string; locale: Locale }) {
  const [state, action] = useActionState(saveProfileAction, IDLE_ACTION_STATE);
  const { formRef, onInputCapture, onChangeCapture } = useSessionDraft("profile-settings", profile.id, state);
  const unsaved = useUnsavedForm("profile-settings-form", state);

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
        <label className="field-label sm:col-span-2" htmlFor="profile-display-name">
          {t(locale, "onboarding.displayName")}
          <Input className="mt-1" id="profile-display-name" name="display_name" defaultValue={profile.display_name} autoComplete="name" maxLength={80} required aria-describedby="display_name-error" />
          <FieldError state={state} field="display_name" locale={locale} id="display_name-error" />
        </label>
        <label className="field-label sm:col-span-2" htmlFor="profile-headline">
          {t(locale, "profile.headline")}
          <Input className="mt-1" id="profile-headline" name="headline" defaultValue={profile.headline ?? ""} maxLength={120} aria-describedby="profile-headline-error" />
          <FieldError state={state} field="headline" locale={locale} id="profile-headline-error" />
        </label>
        <label className="field-label sm:col-span-2" htmlFor="profile-summary">
          {t(locale, "profile.summary")}
          <Textarea className="mt-1 min-h-28" id="profile-summary" name="summary" defaultValue={profile.summary ?? ""} maxLength={2000} rows={4} aria-describedby="profile-summary-error" />
          <FieldError state={state} field="summary" locale={locale} id="profile-summary-error" />
        </label>
        <label className="field-label" htmlFor="profile-contact-email">
          {t(locale, "profile.contactEmail")}
          <Input className="mt-1" id="profile-contact-email" name="contact_email" type="email" defaultValue={profile.contact_email ?? ""} maxLength={320} autoComplete="email" aria-describedby="profile-contact-email-error" />
          <FieldError state={state} field="contact_email" locale={locale} id="profile-contact-email-error" />
        </label>
        <label className="field-label" htmlFor="profile-phone">
          {t(locale, "profile.phone")}
          <Input className="mt-1" id="profile-phone" name="phone" type="tel" defaultValue={profile.phone ?? ""} maxLength={40} autoComplete="tel" aria-describedby="profile-phone-error" />
          <FieldError state={state} field="phone" locale={locale} id="profile-phone-error" />
        </label>
        <label className="field-label" htmlFor="profile-location">
          {t(locale, "profile.location")}
          <Input className="mt-1" id="profile-location" name="location" defaultValue={profile.location ?? ""} maxLength={120} autoComplete="address-level2" aria-describedby="profile-location-error" />
          <FieldError state={state} field="location" locale={locale} id="profile-location-error" />
        </label>
        <label className="field-label" htmlFor="profile-website">
          {t(locale, "profile.website")}
          <Input className="mt-1" id="profile-website" name="website" type="url" defaultValue={profile.website ?? ""} maxLength={2048} autoComplete="url" aria-describedby="profile-website-error" />
          <FieldError state={state} field="website" locale={locale} id="profile-website-error" />
        </label>
        <label className="field-label" htmlFor="profile-locale">
          {t(locale, "onboarding.language")}
          <Select className="mt-1" id="profile-locale" name="locale" defaultValue={profile.locale} aria-describedby="profile-locale-error">
            <option value="en">English</option>
            <option value="id">Bahasa Indonesia</option>
          </Select>
          <FieldError state={state} field="locale" locale={locale} id="profile-locale-error" />
        </label>
        <label className="field-label" htmlFor="profile-timezone">
          {t(locale, "onboarding.timezone")}
          <Input className="mt-1" id="profile-timezone" name="timezone" defaultValue={profile.timezone} maxLength={100} aria-describedby="profile-timezone-error" />
          <FieldError state={state} field="timezone" locale={locale} id="profile-timezone-error" />
        </label>
      </div>
      <p className="field-help">{t(locale, "profile.localeNote")}</p>
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
