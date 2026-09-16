"use client";

import { useActionState } from "react";

import { ActionFeedback, FieldError } from "@/components/forms/action-feedback";
import { ConflictControls } from "@/components/forms/conflict-controls";
import { Card } from "@/components/ui/card";
import { NamedDeleteDialog } from "@/components/ui/named-delete-dialog";
import { useUnsavedForm } from "@/components/ui/unsaved-changes";
import { useCreateOperationKey } from "@/components/forms/operation-key";
import { SubmitButton } from "@/components/forms/submit-button";
import { useSessionDraft } from "@/components/forms/session-draft";
import type {
  CertificationRow,
  EducationRow,
  ExperienceRow,
  SkillRow,
} from "@/domain/database-types";
import { t, type Locale } from "@/i18n/messages";
import { deleteFoundationAction, saveFoundationAction } from "@/features/profile/foundation-actions";
import { IDLE_ACTION_STATE, type ActionState } from "@/server/action-result";

type FoundationKind = "experience" | "education" | "certification" | "skill";
type FoundationRecord = ExperienceRow | EducationRow | CertificationRow | SkillRow;

function value(record: FoundationRecord | undefined, name: string): string {
  const field = record ? (record as unknown as Record<string, unknown>)[name] : null;
  return typeof field === "string" ? field : "";
}

function precision(record: FoundationRecord | undefined, prefix: string): string {
  const field = record ? (record as unknown as Record<string, unknown>)[`${prefix}_precision`] : null;
  return typeof field === "string" ? field : "unknown";
}

function checkbox(record: FoundationRecord | undefined, name: string): boolean {
  return record ? Boolean((record as unknown as Record<string, unknown>)[name]) : false;
}

function DateFields({ record, prefix, label, locale, state }: { record?: FoundationRecord; prefix: string; label: string; locale: Locale; state: ActionState }) {
  const date = value(record, `${prefix}_date`);
  const datePrecision = precision(record, prefix);
  const year = datePrecision === "unknown" ? "" : date.slice(0, 4);
  const month = datePrecision === "month" || datePrecision === "day"
    ? String(Number(date.slice(5, 7)))
    : "";
  const day = datePrecision === "day" ? String(Number(date.slice(8, 10))) : "";
  return (
    <fieldset className="space-y-2">
      <legend className="field-label">{label}</legend>
      <div className="grid gap-2 sm:grid-cols-4">
        <label className="text-xs font-medium sm:col-span-1">
          {t(locale, "profile.precision")}
          <select className="field-input mt-1" name={`${prefix}_precision`} defaultValue={datePrecision}>
            <option value="unknown">{t(locale, "profile.unknownDate")}</option>
            <option value="year">{t(locale, "profile.year")}</option>
            <option value="month">{t(locale, "profile.month")}</option>
            <option value="day">{t(locale, "profile.day")}</option>
          </select>
        </label>
        <label className="text-xs font-medium">
          {t(locale, "profile.year")}
          <input className="field-input mt-1" name={`${prefix}_year`} inputMode="numeric" pattern="[0-9]{4}" maxLength={4} defaultValue={year} aria-label={`${label}: ${t(locale, "profile.year")}`} />
          <FieldError state={state} field={`${prefix}_year`} locale={locale} />
        </label>
        <label className="text-xs font-medium">
          {t(locale, "profile.month")}
          <input className="field-input mt-1" name={`${prefix}_month`} inputMode="numeric" pattern="[0-9]{1,2}" maxLength={2} defaultValue={month} aria-label={`${label}: ${t(locale, "profile.month")}`} />
          <FieldError state={state} field={`${prefix}_month`} locale={locale} />
        </label>
        <label className="text-xs font-medium">
          {t(locale, "profile.day")}
          <input className="field-input mt-1" name={`${prefix}_day`} inputMode="numeric" pattern="[0-9]{1,2}" maxLength={2} defaultValue={day} aria-label={`${label}: ${t(locale, "profile.day")}`} />
          <FieldError state={state} field={`${prefix}_day`} locale={locale} />
        </label>
      </div>
      <p className="field-help">{t(locale, "profile.dateHelp")}</p>
    </fieldset>
  );
}

function FoundationInputs({ kind, record, state, locale }: { kind: FoundationKind; record?: FoundationRecord; state: ActionState; locale: Locale }) {
  if (kind === "experience") {
    return (
      <>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="field-label" htmlFor={`${record?.id ?? "new"}-organization`}>{t(locale, "profile.organization")}
            <input className="field-input mt-1" id={`${record?.id ?? "new"}-organization`} name="organization" required maxLength={200} defaultValue={value(record, "organization")} />
            <FieldError state={state} field="organization" locale={locale} />
          </label>
          <label className="field-label" htmlFor={`${record?.id ?? "new"}-role-title`}>{t(locale, "profile.roleTitle")}
            <input className="field-input mt-1" id={`${record?.id ?? "new"}-role-title`} name="role_title" required maxLength={200} defaultValue={value(record, "role_title")} />
            <FieldError state={state} field="role_title" locale={locale} />
          </label>
          <label className="field-label" htmlFor={`${record?.id ?? "new"}-experience-kind`}>{t(locale, "profile.kind")}
            <select className="field-input mt-1" id={`${record?.id ?? "new"}-experience-kind`} name="experience_kind" defaultValue={value(record, "kind") || "employment"}>
              <option value="employment">{t(locale, "profile.kindEmployment")}</option>
              <option value="internship">{t(locale, "profile.kindInternship")}</option>
              <option value="volunteer">{t(locale, "profile.kindVolunteer")}</option>
            </select>
          </label>
          <label className="flex items-center gap-2 self-end pb-3 text-sm font-medium">
            <input type="checkbox" name="is_current" defaultChecked={checkbox(record, "is_current")} />
            {t(locale, "profile.current")}
          </label>
        </div>
        <label className="field-label" htmlFor={`${record?.id ?? "new"}-experience-description`}>{t(locale, "profile.description")}
          <textarea className="field-input mt-1 min-h-20" id={`${record?.id ?? "new"}-experience-description`} name="description" maxLength={5000} rows={3} defaultValue={value(record, "description")} />
        </label>
        <DateFields record={record} prefix="start" label={t(locale, "profile.startDate")} locale={locale} state={state} />
        <DateFields record={record} prefix="end" label={t(locale, "profile.endDate")} locale={locale} state={state} />
      </>
    );
  }

  if (kind === "education") {
    return (
      <>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="field-label" htmlFor={`${record?.id ?? "new"}-institution`}>{t(locale, "profile.institution")}
            <input className="field-input mt-1" id={`${record?.id ?? "new"}-institution`} name="institution" required maxLength={200} defaultValue={value(record, "institution")} />
            <FieldError state={state} field="institution" locale={locale} />
          </label>
          <label className="field-label" htmlFor={`${record?.id ?? "new"}-qualification`}>{t(locale, "profile.qualification")}
            <input className="field-input mt-1" id={`${record?.id ?? "new"}-qualification`} name="qualification" required maxLength={200} defaultValue={value(record, "qualification")} />
            <FieldError state={state} field="qualification" locale={locale} />
          </label>
          <label className="field-label sm:col-span-2" htmlFor={`${record?.id ?? "new"}-field-of-study`}>{t(locale, "profile.fieldOfStudy")}
            <input className="field-input mt-1" id={`${record?.id ?? "new"}-field-of-study`} name="field_of_study" maxLength={200} defaultValue={value(record, "field_of_study")} />
          </label>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" name="is_current" defaultChecked={checkbox(record, "is_current")} />
            {t(locale, "profile.current")}
          </label>
        </div>
        <label className="field-label" htmlFor={`${record?.id ?? "new"}-education-description`}>{t(locale, "profile.description")}
          <textarea className="field-input mt-1 min-h-20" id={`${record?.id ?? "new"}-education-description`} name="description" maxLength={5000} rows={3} defaultValue={value(record, "description")} />
        </label>
        <DateFields record={record} prefix="start" label={t(locale, "profile.startDate")} locale={locale} state={state} />
        <DateFields record={record} prefix="end" label={t(locale, "profile.endDate")} locale={locale} state={state} />
      </>
    );
  }

  if (kind === "certification") {
    return (
      <>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="field-label" htmlFor={`${record?.id ?? "new"}-certification-name`}>{t(locale, "profile.name")}
            <input className="field-input mt-1" id={`${record?.id ?? "new"}-certification-name`} name="name" required maxLength={200} defaultValue={value(record, "name")} />
            <FieldError state={state} field="name" locale={locale} />
          </label>
          <label className="field-label" htmlFor={`${record?.id ?? "new"}-issuer`}>{t(locale, "profile.issuer")}
            <input className="field-input mt-1" id={`${record?.id ?? "new"}-issuer`} name="issuer" maxLength={200} defaultValue={value(record, "issuer")} />
          </label>
          <label className="field-label sm:col-span-2" htmlFor={`${record?.id ?? "new"}-credential-url`}>{t(locale, "profile.credentialUrl")}
            <input className="field-input mt-1" id={`${record?.id ?? "new"}-credential-url`} name="credential_url" type="url" maxLength={2048} defaultValue={value(record, "credential_url")} />
            <FieldError state={state} field="credential_url" locale={locale} />
          </label>
        </div>
        <DateFields record={record} prefix="issued" label={t(locale, "profile.issuedDate")} locale={locale} state={state} />
      </>
    );
  }

  return (
    <label className="field-label" htmlFor={`${record?.id ?? "new"}-skill-name`}>{t(locale, "profile.name")}
      <input className="field-input mt-1" id={`${record?.id ?? "new"}-skill-name`} name="name" required maxLength={100} defaultValue={value(record, "name")} />
      <FieldError state={state} field="name" locale={locale} />
    </label>
  );
}

function FoundationForm({ kind, ownerId, record, locale }: { kind: FoundationKind; ownerId: string; record?: FoundationRecord; locale: Locale }) {
  const [state, action] = useActionState(saveFoundationAction, IDLE_ACTION_STATE);
  const key = `foundation-${kind}-${record?.id ?? "new"}`;
  const { formRef, onInputCapture, onChangeCapture } = useSessionDraft(key, ownerId, state);
  const unsaved = useUnsavedForm(key, state);
  const operationKey = useCreateOperationKey(ownerId, record ? null : key, state);
  const formId = key;

  return (
    <form
      id={formId}
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
      className="space-y-4"
    >
      <input type="hidden" name="kind" value={kind} />
      {record ? <>
        <input type="hidden" name="id" value={record.id} />
        <input type="hidden" name="expected_revision" defaultValue={record.revision} />
      </> : <input type="hidden" name="operation_key" value={operationKey ?? ""} />}
      <FoundationInputs kind={kind} record={record} state={state} locale={locale} />
      <ActionFeedback state={state} locale={locale} returnTo="/settings/profile" />
      <ConflictControls state={state} formId={formId} locale={locale} formKind={kind} ownerId={ownerId} draftKey={key} />
      {!record && !operationKey ? <p className="field-help" role="status">{t(locale, "profile.operationKeyUnavailable")}</p> : null}
      <SubmitButton disabled={!record && !operationKey} pendingLabel={t(locale, "common.loading")}>{t(locale, "profile.saveRecord")}</SubmitButton>
    </form>
  );
}

function DeleteRecordForm({ kind, record, releaseCount, releaseCountUnavailable, locale }: {
  kind: FoundationKind;
  record: FoundationRecord;
  releaseCount?: number;
  releaseCountUnavailable: boolean;
  locale: Locale;
}) {
  const [state, action] = useActionState(deleteFoundationAction, IDLE_ACTION_STATE);
  const formId = `delete-${kind}-${record.id}`;
  const data = state.status === "success" && typeof state.data === "object" && state.data ? state.data as { releasedProjectCount?: number } : null;
  const recordName = kind === "experience"
    ? value(record, "role_title") + " · " + value(record, "organization")
    : kind === "education"
      ? value(record, "qualification") + " · " + value(record, "institution")
      : value(record, "name");
  const description = kind === "experience"
    ? releaseCountUnavailable
      ? t(locale, "profile.projectContextUnavailable")
      : t(locale, "profile.projectContextWarning", { count: releaseCount ?? 0 })
    : t(locale, "common.deleteDescription");

  return (
    <div className="border-t border-[var(--wp-border)] pt-3">
      <NamedDeleteDialog
        title={t(locale, "common.deleteTitle")}
        description={description}
        recordName={recordName}
        triggerLabel={t(locale, "profile.delete")}
        cancelLabel={t(locale, "common.cancel")}
        confirmLabel={t(locale, "common.delete")}
        formId={formId}
        disabled={releaseCountUnavailable && kind === "experience"}
        successful={state.status === "success"}
      >
        <form id={formId} action={action} className="mt-4 space-y-3">
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="id" value={record.id} />
          <input type="hidden" name="expected_revision" defaultValue={record.revision} />
          <ActionFeedback state={state} locale={locale} returnTo="/settings/profile" />
          <ConflictControls state={state} formId={formId} locale={locale} formKind="delete" />
          {data && kind === "experience" ? (
            <p role="status" className="ui-message ui-message--success">
              {t(locale, "profile.experienceDeleted", { count: data.releasedProjectCount ?? 0 })}
            </p>
          ) : null}
        </form>
      </NamedDeleteDialog>
    </div>
  );
}

function RecordEditor({ kind, ownerId, record, releaseCount, releaseCountUnavailable, locale }: {
  kind: FoundationKind;
  ownerId: string;
  record: FoundationRecord;
  releaseCount?: number;
  releaseCountUnavailable: boolean;
  locale: Locale;
}) {
  const summary = kind === "experience"
    ? `${value(record, "role_title")} · ${value(record, "organization")}`
    : kind === "education"
      ? `${value(record, "qualification")} · ${value(record, "institution")}`
      : value(record, "name");

  return (
    <details className="border-t border-[var(--wp-border)] py-4">
      <summary className="cursor-pointer text-sm font-semibold">{summary}</summary>
      <div className="mt-4 space-y-5">
        <FoundationForm kind={kind} ownerId={ownerId} record={record} locale={locale} />
        <DeleteRecordForm
          key={`${kind}-${record.id}-${record.revision}`}
          kind={kind}
          record={record}
          releaseCount={releaseCount}
          releaseCountUnavailable={releaseCountUnavailable}
          locale={locale}
        />
      </div>
    </details>
  );
}

function FoundationSection({ title, kind, ownerId, records, releaseCounts, releaseCountUnavailable, locale }: {
  title: string;
  kind: FoundationKind;
  ownerId: string;
  records: FoundationRecord[];
  releaseCounts?: Record<string, number>;
  releaseCountUnavailable: boolean;
  locale: Locale;
}) {
  return (
    <Card className="space-y-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      {records.length === 0 ? <p className="text-sm text-[var(--wp-muted)]">{t(locale, "profile.noRecords")}</p> : null}
      <div>
        {records.map((record) => (
          <RecordEditor
            key={record.id}
            kind={kind}
            ownerId={ownerId}
            record={record}
            releaseCount={releaseCounts?.[record.id]}
            releaseCountUnavailable={releaseCountUnavailable}
            locale={locale}
          />
        ))}
      </div>
      <details className="rounded-lg bg-[var(--wp-subtle)] p-4">
        <summary className="cursor-pointer text-sm font-semibold">
          {kind === "experience" ? t(locale, "profile.addExperience") : kind === "education" ? t(locale, "profile.addEducation") : kind === "certification" ? t(locale, "profile.addCertification") : t(locale, "profile.addSkill")}
        </summary>
        <div className="mt-4"><FoundationForm kind={kind} ownerId={ownerId} locale={locale} /></div>
      </details>
    </Card>
  );
}

export function FoundationEditors({ ownerId, experiences, education, certifications, skills, releaseCounts, releaseCountUnavailable, locale }: {
  ownerId: string;
  experiences: ExperienceRow[];
  education: EducationRow[];
  certifications: CertificationRow[];
  skills: SkillRow[];
  releaseCounts: Record<string, number>;
  releaseCountUnavailable: boolean;
  locale: Locale;
}) {
  return (
    <div className="space-y-5">
      <FoundationSection title={t(locale, "profile.experience")} kind="experience" ownerId={ownerId} records={experiences} releaseCounts={releaseCounts} releaseCountUnavailable={releaseCountUnavailable} locale={locale} />
      <FoundationSection title={t(locale, "profile.education")} kind="education" ownerId={ownerId} records={education} releaseCountUnavailable={false} locale={locale} />
      <FoundationSection title={t(locale, "profile.certifications")} kind="certification" ownerId={ownerId} records={certifications} releaseCountUnavailable={false} locale={locale} />
      <FoundationSection title={t(locale, "profile.skills")} kind="skill" ownerId={ownerId} records={skills} releaseCountUnavailable={false} locale={locale} />
      <p className="text-sm text-[var(--wp-muted)]">{t(locale, "profile.skillNote")}</p>
    </div>
  );
}
