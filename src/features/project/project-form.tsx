"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import { ActionFeedback, FieldError, fieldErrorControlProps, fieldErrorId } from "@/components/forms/action-feedback";
import { useCreateOperationKey } from "@/components/forms/operation-key";
import {
  clearSessionDraftForForm,
  hasSessionDraft,
  readSessionDraftMetadata,
  sessionDraftStorageKey,
  writeSessionDraftMetadata,
  useSessionDraft,
  type SessionDraftMetadataState,
} from "@/components/forms/session-draft";
import { SubmitButton } from "@/components/forms/submit-button";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/field-control";
import { RevisionConflict } from "@/components/ui/revision-conflict";
import { clearUnsavedForm, useUnsavedForm } from "@/components/ui/unsaved-changes";
import type { ProjectExperienceSummary } from "@/domain/project/contracts";
import type { ProjectRow } from "@/domain/database-types";
import { t, type Locale } from "@/i18n/messages";
import { IDLE_ACTION_STATE, type ActionState } from "@/server/action-result";
import { createProjectAction, updateProjectAction } from "@/features/project/actions";

function dateParts(date: string | null, precision: string | null): { precision: string; year: string; month: string; day: string } {
  if (!date || !precision) return { precision: "unknown", year: "", month: "", day: "" };
  return {
    precision,
    year: date.slice(0, 4),
    month: precision === "month" || precision === "day" ? String(Number(date.slice(5, 7))) : "",
    day: precision === "day" ? String(Number(date.slice(8, 10))) : "",
  };
}

function DateFields({ prefix, label, date, precision, formId, state, locale }: {
  prefix: "start" | "end";
  label: string;
  date: string | null;
  precision: string | null;
  formId: string;
  state: ActionState;
  locale: Locale;
}) {
  const parts = dateParts(date, precision);
  const helpId = `${formId}-${prefix}-help`;
  const dateError = fieldErrorId(formId, `${prefix}_date`);
  return (
    <fieldset className="space-y-2">
      <legend className="field-label">{label}</legend>
      <div className="grid gap-2 sm:grid-cols-4">
        <label className="text-xs font-medium">
          {t(locale, "profile.precision")}
          <Select className="mt-1" name={`${prefix}_precision`} defaultValue={parts.precision} {...fieldErrorControlProps(state, `${prefix}_date`, dateError, [helpId])}>
            <option value="unknown">{t(locale, "profile.unknownDate")}</option>
            <option value="year">{t(locale, "profile.year")}</option>
            <option value="month">{t(locale, "profile.month")}</option>
            <option value="day">{t(locale, "profile.day")}</option>
          </Select>
        </label>
        <label className="text-xs font-medium">
          {t(locale, "profile.year")}
          <Input className="mt-1" name={`${prefix}_year`} inputMode="numeric" pattern="[0-9]{4}" maxLength={4} defaultValue={parts.year} aria-label={`${label}: ${t(locale, "profile.year")}`} />
        </label>
        <label className="text-xs font-medium">
          {t(locale, "profile.month")}
          <Input className="mt-1" name={`${prefix}_month`} inputMode="numeric" pattern="[0-9]{1,2}" maxLength={2} defaultValue={parts.month} aria-label={`${label}: ${t(locale, "profile.month")}`} />
        </label>
        <label className="text-xs font-medium">
          {t(locale, "profile.day")}
          <Input className="mt-1" name={`${prefix}_day`} inputMode="numeric" pattern="[0-9]{1,2}" maxLength={2} defaultValue={parts.day} aria-label={`${label}: ${t(locale, "profile.day")}`} />
        </label>
      </div>
      <p id={helpId} className="field-help">{t(locale, "profile.dateHelp")}</p>
      <FieldError state={state} field={`${prefix}_date`} locale={locale} id={dateError} />
    </fieldset>
  );
}

export function ProjectForm({
  locale,
  ownerId,
  experiences,
  project,
  linkedActivityCount = 0,
  returnTo,
}: {
  locale: Locale;
  ownerId: string;
  experiences: ProjectExperienceSummary[];
  project?: ProjectRow;
  linkedActivityCount?: number;
  returnTo: string;
}) {
  const isEditing = Boolean(project);
  const formId = project ? `project-edit-form-${project.id}` : "project-create-form";
  const formKey = project ? `project-edit-${project.id}` : "project-create";
  const [state, formAction] = useActionState(isEditing ? updateProjectAction : createProjectAction, IDLE_ACTION_STATE);
  const { formRef, onInputCapture, onChangeCapture } = useSessionDraft(formKey, ownerId, state);
  const unsaved = useUnsavedForm(formId, state);
  const operationKey = useCreateOperationKey(ownerId, isEditing ? null : "project-create", state);
  const router = useRouter();
  const [statusValue, setStatusValue] = useState(project?.status ?? "planned");
  const [currentValue, setCurrentValue] = useState(Boolean(project?.is_current));
  const [experienceValue, setExperienceValue] = useState(project?.experience_id ?? "");
  const [contextDialogOpen, setContextDialogOpen] = useState(false);
  const [expectedRevisionOverride, setExpectedRevisionOverride] = useState<number | null>(null);
  const [draftRevisionState, setDraftRevisionState] = useState<"none" | "same" | "mismatch" | "unknown">("none");
  const projectDraftRestored = useRef(false);
  const projectDraftMetadata = useRef<SessionDraftMetadataState>({ status: "missing" });
  const contextConfirmed = useRef(false);
  const handledSuccess = useRef("");
  const storageKey = sessionDraftStorageKey(ownerId, formKey);
  const stateCorrelationId = state.status === "error" ? state.error.correlationId : state.status === "success" ? state.correlationId : "";
  const restoredDraftMismatch = isEditing && (draftRevisionState === "mismatch" || draftRevisionState === "unknown");

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const status = form.elements.namedItem("status");
    const current = form.elements.namedItem("is_current");
    const experience = form.elements.namedItem("experience_id");
    if (status instanceof HTMLSelectElement && ["planned", "active", "completed"].includes(status.value)) setStatusValue(status.value as "planned" | "active" | "completed");
    if (current instanceof HTMLInputElement) setCurrentValue(current.checked);
    if (experience instanceof HTMLSelectElement) setExperienceValue(experience.value);
    if (project && storageKey) {
      try {
        const restored = hasSessionDraft(sessionStorage, ownerId, formKey);
        let metadata = readSessionDraftMetadata(sessionStorage, ownerId, formKey);
        if (!restored && metadata.status !== "missing") {
          clearSessionDraftForForm(ownerId, formKey);
          metadata = { status: "missing" };
        }
        projectDraftRestored.current = restored;
        projectDraftMetadata.current = metadata;
        setDraftRevisionState(
          !restored
            ? "none"
            : metadata.status !== "valid"
              ? "unknown"
              : metadata.metadata.baseRevision === project.revision
                ? "same"
                : "mismatch",
        );
      } catch {
        projectDraftRestored.current = true;
        projectDraftMetadata.current = { status: "invalid" };
        setDraftRevisionState("unknown");
      }
    } else if (project) {
      projectDraftRestored.current = false;
      projectDraftMetadata.current = { status: "missing" };
      setDraftRevisionState("none");
    }
  }, [formKey, formRef, ownerId, project, state, storageKey]);

  useEffect(() => {
    if (state.status !== "error") return;
    const form = formRef.current;
    if (!form) return;
    const fieldOrder = ["title", "status", "experience_id", "user_role", "description", "start_date", "end_date", "outcome"];
    const firstInvalid = fieldOrder.find((field) => state.error.fieldErrors?.[field]);
    if (!firstInvalid) return;
    const control = form.elements.namedItem(firstInvalid);
    requestAnimationFrame(() => {
      if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement) control.focus({ preventScroll: true });
    });
  }, [formRef, state, stateCorrelationId]);

  useEffect(() => {
    if (state.status !== "success" || handledSuccess.current === state.correlationId) return;
    handledSuccess.current = state.correlationId;
    clearUnsavedForm(formId);
    if (!isEditing) {
      const receipt = state.data as { projectId?: string } | undefined;
      if (receipt?.projectId) router.push(`/projects/${receipt.projectId}?${new URLSearchParams({ returnTo }).toString()}`);
      return;
    }
    router.refresh();
  }, [formId, isEditing, returnTo, router, state]);

  const latestConflict = state.status === "error" && state.error.code === "CONFLICT" && state.error.latestRecord
    ? state.error.latestRecord as ProjectRow
    : null;
  const latest = restoredDraftMismatch && project ? project : latestConflict;
  const expectedRevision = expectedRevisionOverride ?? project?.revision ?? 1;
  const experienceChanged = Boolean(project && (experienceValue || null) !== project.experience_id);

  function ensureProjectDraftMetadata() {
    if (!project || !storageKey || projectDraftRestored.current || projectDraftMetadata.current.status !== "missing") return;
    try {
      writeSessionDraftMetadata(sessionStorage, ownerId, formKey, project.revision);
      projectDraftMetadata.current = { status: "valid", metadata: { schemaVersion: 1, baseRevision: project.revision } };
    } catch {
      // Browser storage failures must not block the explicit save action.
    }
  }

  function reloadServerVersion() {
    clearSessionDraftForForm(ownerId, formKey);
    clearUnsavedForm(formId);
    window.location.assign(window.location.href);
  }

  function retryLocalChanges() {
    if (!latest || !formRef.current) return;
    setExpectedRevisionOverride(latest.revision);
    try {
      writeSessionDraftMetadata(sessionStorage, ownerId, formKey, latest.revision);
      projectDraftMetadata.current = { status: "valid", metadata: { schemaVersion: 1, baseRevision: latest.revision } };
    } catch {
      // The server-side expected revision remains authoritative when storage is unavailable.
    }
    projectDraftRestored.current = true;
    setDraftRevisionState("same");
    clearUnsavedForm(formId);
    window.requestAnimationFrame(() => formRef.current?.requestSubmit());
  }

  function confirmContextChange() {
    contextConfirmed.current = true;
    setContextDialogOpen(false);
    window.requestAnimationFrame(() => formRef.current?.requestSubmit());
  }

  return (
    <>
      <form
        ref={formRef}
        id={formId}
        action={formAction}
        className="project-form"
        onInputCapture={(event) => { ensureProjectDraftMetadata(); onInputCapture(event); unsaved.onInputCapture(event); }}
        onChangeCapture={(event) => { ensureProjectDraftMetadata(); onChangeCapture(event); unsaved.onChangeCapture(event); }}
        onSubmitCapture={(event) => {
          if (restoredDraftMismatch) {
            event.preventDefault();
            return;
          }
          if (isEditing && linkedActivityCount > 0 && experienceChanged && !contextConfirmed.current) {
            event.preventDefault();
            setContextDialogOpen(true);
          }
        }}
      >
        {project ? <input type="hidden" name="project_id" value={project.id} /> : <input type="hidden" name="operation_key" value={operationKey ?? ""} />}
        {project ? <input type="hidden" name="expected_revision" value={expectedRevision} /> : null}

        <div className="project-form-grid">
          <div>
            <label className="field-label" htmlFor={`${formId}-title`}>{t(locale, "project.title")}
              <Input id={`${formId}-title`} name="title" required maxLength={200} defaultValue={project?.title ?? ""} {...fieldErrorControlProps(state, "title", fieldErrorId(formId, "title"))} />
            </label>
            <FieldError state={state} field="title" locale={locale} id={fieldErrorId(formId, "title")} />
          </div>
          <div>
            <label className="field-label" htmlFor={`${formId}-status`}>{t(locale, "project.statusLabel")}
              <Select id={`${formId}-status`} name="status" value={statusValue} onChange={(event) => { setStatusValue(event.currentTarget.value as typeof statusValue); if (event.currentTarget.value === "completed") setCurrentValue(false); }}>
                <option value="planned">{t(locale, "project.planned")}</option>
                <option value="active">{t(locale, "project.active")}</option>
                <option value="completed">{t(locale, "project.completed")}</option>
              </Select>
            </label>
            <FieldError state={state} field="status" locale={locale} id={fieldErrorId(formId, "status")} />
          </div>
          <div>
            <label className="field-label" htmlFor={`${formId}-experience`}>{t(locale, "project.experience")}
              <Select id={`${formId}-experience`} name="experience_id" value={experienceValue} onChange={(event) => { setExperienceValue(event.currentTarget.value); contextConfirmed.current = false; }}>
                <option value="">{t(locale, "project.noExperience")}</option>
                {experiences.map((experience) => <option key={experience.id} value={experience.id}>{experience.role_title} · {experience.organization}</option>)}
              </Select>
            </label>
            <FieldError state={state} field="experience_id" locale={locale} id={fieldErrorId(formId, "experience_id")} />
          </div>
          <div>
            <label className="field-label" htmlFor={`${formId}-role`}>{t(locale, "project.role")}
              <Input id={`${formId}-role`} name="user_role" maxLength={200} defaultValue={project?.user_role ?? ""} {...fieldErrorControlProps(state, "user_role", fieldErrorId(formId, "user_role"))} />
            </label>
            <FieldError state={state} field="user_role" locale={locale} id={fieldErrorId(formId, "user_role")} />
          </div>
        </div>

        <label className="field-label" htmlFor={`${formId}-description`}>{t(locale, "project.descriptionField")}
          <Textarea id={`${formId}-description`} name="description" rows={4} maxLength={5000} defaultValue={project?.description ?? ""} {...fieldErrorControlProps(state, "description", fieldErrorId(formId, "description"))} />
        </label>
        <FieldError state={state} field="description" locale={locale} id={fieldErrorId(formId, "description")} />

        <div className="project-date-grid">
          <DateFields prefix="start" label={t(locale, "project.startDate")} date={project?.start_date ?? null} precision={project?.start_precision ?? null} formId={formId} state={state} locale={locale} />
          <DateFields prefix="end" label={t(locale, "project.endDate")} date={project?.end_date ?? null} precision={project?.end_precision ?? null} formId={formId} state={state} locale={locale} />
        </div>

        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" name="is_current" checked={currentValue} disabled={statusValue === "completed"} onChange={(event) => setCurrentValue(event.currentTarget.checked)} />
          {t(locale, "project.current")}
        </label>

        <div>
          <label className="field-label" htmlFor={`${formId}-outcome`}>{t(locale, "project.outcome")}
            <Textarea id={`${formId}-outcome`} name="outcome" rows={4} maxLength={5000} defaultValue={project?.outcome ?? ""} {...fieldErrorControlProps(state, "outcome", fieldErrorId(formId, "outcome"))} />
          </label>
          <FieldError state={state} field="outcome" locale={locale} id={fieldErrorId(formId, "outcome")} />
          <p className="field-help">{t(locale, "project.outcomeHelp")}</p>
          {statusValue === "completed" && !project?.outcome ? <p className="ui-message ui-message--warning mt-2" role="status"><strong>{t(locale, "project.needsOutcome")}</strong> {t(locale, "project.needsOutcomeHelp")}</p> : null}
        </div>

        <ActionFeedback state={state} locale={locale} returnTo={returnTo} />
        {latest ? (
          <RevisionConflict title={t(locale, "project.conflictTitle")} labelledBy={`${formId}-conflict`}>
            <p>{t(locale, restoredDraftMismatch ? "project.restoredDraftDescription" : "error.conflict")}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={reloadServerVersion}>{t(locale, "project.reloadServer")}</Button>
              <Button type="button" variant="primary" onClick={retryLocalChanges}>{t(locale, "project.retryChanges")}</Button>
            </div>
          </RevisionConflict>
        ) : null}
        {!project && !operationKey ? <p className="field-help" role="status">{t(locale, "project.operationKeyUnavailable")}</p> : null}
        <div className="flex flex-wrap gap-2">
          <SubmitButton disabled={(!project && !operationKey) || restoredDraftMismatch} pendingLabel={t(locale, "project.saving")}>
            {project ? t(locale, "project.saveChanges") : t(locale, "project.save")}
          </SubmitButton>
          <a className="button-secondary" href={returnTo}>{t(locale, "common.cancel")}</a>
        </div>
      </form>
      <Dialog open={contextDialogOpen} onOpenChange={setContextDialogOpen} title={t(locale, "project.contextWarning").replace("{count}", String(linkedActivityCount))} description={t(locale, "project.contextWarningDescription")}>
        <p className="mt-4 ui-message ui-message--warning">{t(locale, "project.contextWarning", { count: linkedActivityCount })}</p>
        <div className="ui-dialog-actions">
          <Button variant="secondary" autoFocus onClick={() => setContextDialogOpen(false)}>{t(locale, "common.cancel")}</Button>
          <Button variant="primary" onClick={confirmContextChange}>{t(locale, "project.contextConfirm")}</Button>
        </div>
      </Dialog>
    </>
  );
}
