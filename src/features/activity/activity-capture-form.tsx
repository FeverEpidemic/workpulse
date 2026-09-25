"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ChangeEvent, ClipboardEvent, FormEvent } from "react";
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
import { clearUnsavedForm, useUnsavedForm } from "@/components/ui/unsaved-changes";
import { formatActivityDate, projectExperienceId, resolveActivityContext, type ActivityContextOptions } from "@/domain/activity/activity-display";
import type { ActivityCaptureMode, ActivityRow } from "@/domain/activity/contracts";
import type { ActivityContextIssue } from "@/features/activity/activity-context-service";
import { t, type Locale } from "@/i18n/messages";
import { IDLE_ACTION_STATE, type ActionState } from "@/server/action-result";
import { createActivityAction, updateActivityAction } from "@/features/activity/actions";

function captureModeLabel(locale: Locale, mode: ActivityCaptureMode): string {
  const key = mode === "note" ? "activity.noteMode" : mode === "form" ? "activity.formMode" : "activity.chatMode";
  return t(locale, key);
}

function recordFromAction(state: ActionState): ActivityRow | null {
  if (state.status !== "success" || !state.data || typeof state.data !== "object") return null;
  const value = state.data as Partial<ActivityRow>;
  return typeof value.id === "string" && typeof value.user_id === "string" &&
    typeof value.revision === "number" && typeof value.raw_text === "string" &&
    typeof value.occurred_on === "string"
    ? value as ActivityRow
    : null;
}

function latestConflictRecord(
  state: ActionState,
  ownerId: string,
  activityId: string,
  mode: ActivityCaptureMode,
): ActivityRow | null {
  if (state.status !== "error" || state.error.code !== "CONFLICT" || !state.error.latestRecord) return null;
  const value = state.error.latestRecord as Partial<ActivityRow>;
  return value.id === activityId && value.user_id === ownerId && value.capture_mode === mode &&
    typeof value.revision === "number" && value.revision > 0 &&
    typeof value.raw_text === "string" && typeof value.occurred_on === "string"
    ? value as ActivityRow
    : null;
}

function createdActivityId(state: ActionState): string | null {
  if (state.status !== "success" || !state.data || typeof state.data !== "object") return null;
  const activityId = (state.data as Record<string, unknown>).activityId;
  return typeof activityId === "string" && /^[0-9a-f-]{36}$/i.test(activityId) ? activityId : null;
}

function isFieldControl(value: Element | RadioNodeList | null): value is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  return value instanceof HTMLInputElement || value instanceof HTMLSelectElement || value instanceof HTMLTextAreaElement;
}

function wouldExceedCodePointLimit(textarea: HTMLTextAreaElement, insertion: string): boolean {
  const candidate = textarea.value.slice(0, textarea.selectionStart) + insertion +
    textarea.value.slice(textarea.selectionEnd);
  return Array.from(candidate).length > 10_000;
}

export function ActivityCaptureForm({
  locale,
  ownerId,
  defaultOccurredOn,
  options,
  contextIssue,
  initialProjectId,
  returnTo,
  activity,
  onSaved,
  onCancel,
}: {
  locale: Locale;
  ownerId: string;
  defaultOccurredOn: string;
  options: ActivityContextOptions;
  contextIssue?: ActivityContextIssue;
  initialProjectId?: string;
  returnTo: string;
  activity?: ActivityRow;
  onSaved?: (record: ActivityRow) => void;
  onCancel?: () => void;
}) {
  const isEditing = Boolean(activity);
  const formId = activity ? `activity-edit-form-${activity.id}` : "quick-log-note-form";
  const formKey = activity ? `activity-edit-${activity.id}` : "quick-log-note";
  const serverAction = activity ? updateActivityAction : createActivityAction;
  const [state, formAction] = useActionState(serverAction, IDLE_ACTION_STATE);
  const { formRef, onInputCapture: persistInput, onChangeCapture: persistChange } = useSessionDraft(formKey, ownerId, state);
  const unsaved = useUnsavedForm(formId, state);
  const markDirty = unsaved.markDirty;
  const operationKey = useCreateOperationKey(ownerId, isEditing ? null : "activity-create", state);
  const router = useRouter();
  const [mode, setMode] = useState<ActivityCaptureMode>(activity?.capture_mode ?? "note");
  const [textLength, setTextLength] = useState(Array.from(activity?.raw_text ?? "").length);
  const [selectedProjectId, setSelectedProjectId] = useState(activity?.project_id ?? initialProjectId ?? "");
  const [experienceId, setExperienceId] = useState(activity?.experience_id ?? "");
  const [draftReady, setDraftReady] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [expectedRevisionOverride, setExpectedRevisionOverride] = useState<number | null>(null);
  const [draftRevisionState, setDraftRevisionState] = useState<"none" | "same" | "mismatch" | "unknown">("none");
  const activityDraftRestored = useRef(false);
  const activityDraftMetadata = useRef<SessionDraftMetadataState>({ status: "missing" });
  const conflictHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusedErrorId = useRef("");
  const handledSuccessId = useRef("");
  const initialFocusDone = useRef(false);
  const storageKey = sessionDraftStorageKey(ownerId, formKey);
  const selectedProjectExperienceId = selectedProjectId
    ? projectExperienceId(selectedProjectId, options.projects)
    : undefined;
  const contextExperienceId = selectedProjectId
    ? selectedProjectExperienceId === undefined
      ? activity?.experience_id ?? ""
      : selectedProjectExperienceId ?? ""
    : experienceId;
  const experienceLocked = draftReady && Boolean(selectedProjectId);
  const sourceId = activity ? `${formId}-raw-text` : "quick-log-note";
  const rawTextErrorId = fieldErrorId(formId, "raw_text");
  const rawTextLimitErrorId = `${formId}-raw-text-limit-error`;
  const dateErrorId = fieldErrorId(formId, "occurred_on");
  const roleErrorId = fieldErrorId(formId, "role");
  const scopeErrorId = fieldErrorId(formId, "scope");
  const outcomeErrorId = fieldErrorId(formId, "outcome");
  const projectErrorId = fieldErrorId(formId, "project_id");
  const experienceErrorId = fieldErrorId(formId, "experience_id");
  const retryReturnTo = isEditing
    ? `/activity/${activity?.id}?${new URLSearchParams({ returnTo }).toString()}`
    : `/activity/new?${new URLSearchParams({ returnTo }).toString()}`;
  const detailFieldError = state.status === "error" &&
    ["role", "scope", "outcome"].some((field) => Boolean(state.error.fieldErrors?.[field]));
  const stateCorrelationId = state.status === "error" ? state.error.correlationId :
    state.status === "success" ? state.correlationId : "";
  const restoredDraftMismatch = isEditing && (draftRevisionState === "mismatch" || draftRevisionState === "unknown");
  const latestVersion = activity && restoredDraftMismatch
    ? activity
    : activity
      ? latestConflictRecord(state, ownerId, activity.id, activity.capture_mode)
      : null;
  const latestVersionRevision = latestVersion?.revision ?? 0;

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;

    const rawText = form.elements.namedItem("raw_text");
    if (rawText instanceof HTMLTextAreaElement) setTextLength(Array.from(rawText.value).length);

    if (!isEditing) {
      const selectedMode = form.querySelector<HTMLInputElement>('input[name="capture_mode"]:checked')?.value;
      if (selectedMode === "note" || selectedMode === "form" || selectedMode === "chat") setMode(selectedMode);
      if (!initialFocusDone.current) {
        initialFocusDone.current = true;
        form.querySelector<HTMLTextAreaElement>("#quick-log-note")?.focus({ preventScroll: true });
      }
    }

    const projectControl = form.elements.namedItem("project_id");
    const experienceControl = form.elements.namedItem("experience_id");
    const projectId = projectControl instanceof HTMLSelectElement ? projectControl.value : "";
    const savedExperienceId = experienceControl instanceof HTMLSelectElement ? experienceControl.value : "";
    setSelectedProjectId(projectId);
    const linkedExperienceId = projectId ? projectExperienceId(projectId, options.projects) : undefined;
    setExperienceId(projectId
      ? linkedExperienceId === undefined ? activity?.experience_id ?? "" : linkedExperienceId ?? ""
      : savedExperienceId);
    setDraftReady(true);

    if (activity && storageKey) {
      try {
        const restored = hasSessionDraft(sessionStorage, ownerId, formKey);
        let metadata = readSessionDraftMetadata(sessionStorage, ownerId, formKey);
        if (!restored && metadata.status !== "missing") {
          clearSessionDraftForForm(ownerId, formKey);
          metadata = { status: "missing" };
        }
        activityDraftRestored.current = restored;
        activityDraftMetadata.current = metadata;
        setDraftRevisionState(
          !restored
            ? "none"
            : metadata.status !== "valid"
              ? "unknown"
              : metadata.metadata.baseRevision === activity.revision
                ? "same"
                : "mismatch",
        );
      } catch {
        activityDraftRestored.current = true;
        activityDraftMetadata.current = { status: "invalid" };
        setDraftRevisionState("unknown");
      }
    } else if (activity) {
      activityDraftRestored.current = false;
      activityDraftMetadata.current = { status: "missing" };
      setDraftRevisionState("none");
    }

    if (!hasChanges && storageKey) {
      try {
        const rawDraft = sessionStorage.getItem(storageKey);
        if (rawDraft) {
          const parsed: unknown = JSON.parse(rawDraft);
          if (parsed !== null && typeof parsed === "object" && Object.keys(parsed).length > 0) {
            setHasChanges(true);
            markDirty();
          }
        }
      } catch {
        // An unavailable or malformed tab draft does not block capture.
      }
    }
  }, [activity, formKey, formRef, hasChanges, initialProjectId, isEditing, markDirty, options.projects, ownerId, stateCorrelationId, storageKey]);

  useEffect(() => {
    if (state.status !== "error" || focusedErrorId.current === state.error.correlationId) return;
    focusedErrorId.current = state.error.correlationId;
    const form = formRef.current;
    if (!form) return;
    const fieldOrder = ["raw_text", "occurred_on", "project_id", "experience_id", "role", "scope", "outcome"];
    const firstInvalid = fieldOrder.find((field) => state.error.fieldErrors?.[field]);
    if (!firstInvalid) return;
    const control = form.elements.namedItem(firstInvalid);
    requestAnimationFrame(() => {
      if (isFieldControl(control) && !control.disabled) control.focus({ preventScroll: true });
    });
  }, [formRef, state]);

  useEffect(() => {
    if (latestVersionRevision > 0) conflictHeadingRef.current?.focus({ preventScroll: true });
  }, [latestVersionRevision]);

  useEffect(() => {
    if (state.status !== "success" || handledSuccessId.current === state.correlationId) return;
    handledSuccessId.current = state.correlationId;
    clearUnsavedForm(formId);
    setHasChanges(false);

    if (!isEditing) {
      const activityId = createdActivityId(state);
      if (!activityId) return;
      const query = new URLSearchParams({ returnTo }).toString();
      router.push(`/activity/${activityId}?${query}`);
      return;
    }

    const savedRecord = recordFromAction(state);
    if (savedRecord && onSaved) window.setTimeout(() => onSaved(savedRecord), 0);
  }, [formId, isEditing, onSaved, returnTo, router, state]);

  function updateProject(event: ChangeEvent<HTMLSelectElement>) {
    const projectId = event.currentTarget.value;
    setSelectedProjectId(projectId);
    const linkedExperienceId = projectId ? projectExperienceId(projectId, options.projects) : undefined;
    setExperienceId(projectId
      ? linkedExperienceId === undefined ? activity?.experience_id ?? "" : linkedExperienceId ?? ""
      : "");
  }

  function ensureActivityDraftMetadata() {
    if (!activity || !storageKey || activityDraftRestored.current || activityDraftMetadata.current.status !== "missing") return;
    try {
      writeSessionDraftMetadata(sessionStorage, ownerId, formKey, activity.revision);
      activityDraftMetadata.current = {
        status: "valid",
        metadata: { schemaVersion: 1, baseRevision: activity.revision },
      };
    } catch {
      // Browser storage failures must not block the explicit save action.
    }
  }

  function requestCancelEdit() {
    if (hasChanges) setCancelDialogOpen(true);
    else onCancel?.();
  }

  function discardEdit() {
    clearSessionDraftForForm(ownerId, formKey);
    clearUnsavedForm(formId);
    setHasChanges(false);
    setCancelDialogOpen(false);
    onCancel?.();
  }

  function reloadServerVersion() {
    clearSessionDraftForForm(ownerId, formKey);
    clearUnsavedForm(formId);
    window.location.assign(window.location.href);
  }

  function retryLocalChanges() {
    if (!latestVersion || !formRef.current) return;
    const revisionControl = formRef.current.elements.namedItem("expected_revision");
    if (revisionControl instanceof HTMLInputElement) revisionControl.value = String(latestVersion.revision);
    try {
      writeSessionDraftMetadata(sessionStorage, ownerId, formKey, latestVersion.revision);
      activityDraftMetadata.current = {
        status: "valid",
        metadata: { schemaVersion: 1, baseRevision: latestVersion.revision },
      };
    } catch {
      // The server-side expected revision remains authoritative when storage is unavailable.
    }
    activityDraftRestored.current = true;
    setDraftRevisionState("same");
    setExpectedRevisionOverride(latestVersion.revision);
    window.requestAnimationFrame(() => formRef.current?.requestSubmit());
  }

  const latestContext = latestVersion ? resolveActivityContext(latestVersion, options) : null;
  const showEditableStructuredFields = !activity || activity.capture_mode === "form";
  const hasStructuredFields = Boolean(activity?.role || activity?.scope || activity?.outcome);

  return (
    <>
      <form
        id={formId}
        ref={formRef}
        action={formAction}
        className="workspace-activity-form"
        aria-label={t(locale, "quickLog.title")}
        onSubmitCapture={(event) => {
          if (restoredDraftMismatch) {
            event.preventDefault();
            conflictHeadingRef.current?.focus({ preventScroll: true });
          }
        }}
        onInputCapture={(event) => {
          ensureActivityDraftMetadata();
          persistInput(event);
          unsaved.onInputCapture(event);
          setHasChanges(true);
        }}
        onChangeCapture={(event) => {
          ensureActivityDraftMetadata();
          persistChange(event);
          unsaved.onChangeCapture(event);
          setHasChanges(true);
        }}
      >
        {activity ? (
          <>
            <input type="hidden" name="activity_id" value={activity.id} />
            <input type="hidden" name="expected_revision" value={expectedRevisionOverride ?? activity.revision} />
          </>
        ) : (
          <input type="hidden" name="operation_key" value={operationKey ?? ""} />
        )}

        {activity ? (
          <p className="activity-capture-mode-readonly">
            <span className="field-label">{t(locale, "quickLog.modeLabel")}</span>
            <span className="activity-mode-choice is-selected">{captureModeLabel(locale, activity.capture_mode)}</span>
          </p>
        ) : (
          <fieldset className="activity-mode-fieldset" aria-label={t(locale, "quickLog.modeLabel")}>
            <legend className="field-label">{t(locale, "quickLog.modeLabel")}</legend>
            <div className="activity-mode-options">
              {(["note", "form", "chat"] as const).map((captureMode) => (
                <label className="activity-mode-choice" key={captureMode}>
                  <input
                    type="radio"
                    name="capture_mode"
                    value={captureMode}
                    defaultChecked={captureMode === "note"}
                    onChange={() => setMode(captureMode)}
                  />
                  <span>{t(locale, `quickLog.${captureMode}Mode`)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div className="space-y-2">
          <label className="field-label" htmlFor={sourceId}>
            {mode === "chat" ? t(locale, "quickLog.chatLabel") : t(locale, "quickLog.noteLabel")}
          </label>
          <Textarea
            id={sourceId}
            name="raw_text"
            className="workspace-quick-log-note"
            maxLength={20000}
            required
            placeholder={t(locale, "quickLog.notePlaceholder")}
            defaultValue={activity?.raw_text ?? ""}
            aria-invalid={textLength > 10_000 || fieldErrorControlProps(state, "raw_text", rawTextErrorId)["aria-invalid"]}
            aria-describedby={fieldErrorControlProps(state, "raw_text", rawTextErrorId, [
              "quick-log-length-help",
              ...(textLength > 10_000 ? [rawTextLimitErrorId] : []),
            ])["aria-describedby"]}
            onBeforeInput={(event: FormEvent<HTMLTextAreaElement>) => {
              const inputEvent = event.nativeEvent as InputEvent;
              if (inputEvent.inputType.startsWith("delete")) return;
              const insertion = inputEvent.data ??
                (inputEvent.inputType === "insertLineBreak" || inputEvent.inputType === "insertParagraph" ? "\n" : null);
              if (insertion !== null && wouldExceedCodePointLimit(event.currentTarget, insertion)) event.preventDefault();
            }}
            onPaste={(event: ClipboardEvent<HTMLTextAreaElement>) => {
              const pastedText = event.clipboardData.getData("text");
              if (wouldExceedCodePointLimit(event.currentTarget, pastedText)) event.preventDefault();
            }}
            onInput={(event) => setTextLength(Array.from(event.currentTarget.value).length)}
          />
          <p id="quick-log-length-help" className="field-help">
            {t(locale, "quickLog.lengthHelp")} <span aria-hidden="true">·</span> {textLength.toLocaleString(locale === "id" ? "id-ID" : "en-US")}/10,000
          </p>
          {textLength > 10_000 ? (
            <p id={rawTextLimitErrorId} className="field-error" role="status" aria-live="polite">
              {t(locale, "quickLog.tooLong")}
            </p>
          ) : null}
          <FieldError state={state} field="raw_text" locale={locale} id={rawTextErrorId} />
          {mode === "chat" ? <p className="field-help">{t(locale, "quickLog.chatHelp")}</p> : null}
          {mode === "form" ? <p className="field-help">{t(locale, "quickLog.formHelp")}</p> : null}
        </div>

        <label className="field-label" htmlFor={`${formId}-occurred-on`}>
          {t(locale, "quickLog.dateLabel")}
          <Input
            className="mt-1"
            id={`${formId}-occurred-on`}
            name="occurred_on"
            type="date"
            required
            defaultValue={activity?.occurred_on ?? defaultOccurredOn}
            {...fieldErrorControlProps(state, "occurred_on", dateErrorId)}
          />
          <FieldError state={state} field="occurred_on" locale={locale} id={dateErrorId} />
        </label>

        <fieldset className="activity-context-fields">
          <legend className="field-label">{t(locale, "quickLog.contextLabel")}</legend>
          {contextIssue ? (
            <p className="ui-message ui-message--info" role="status" data-testid="activity-context-issue">
              {t(locale, contextIssue.messageKey)}{" "}
              <span data-testid="activity-context-reference">
                {t(locale, "activity.referenceId", { id: contextIssue.correlationId })}
              </span>
            </p>
          ) : options.projects.length === 0 && !activity?.project_id ? (
            <p className="field-help">{t(locale, "quickLog.noProjects")}</p>
          ) : null}
          <label className="field-label" htmlFor={`${formId}-project`}>
            {t(locale, "quickLog.projectLabel")}
            <Select
              className="mt-1"
              id={`${formId}-project`}
              name="project_id"
              defaultValue={activity?.project_id ?? initialProjectId ?? ""}
              onChange={updateProject}
              {...fieldErrorControlProps(state, "project_id", projectErrorId)}
            >
              <option value="">{t(locale, "activity.noProject")}</option>
              {activity?.project_id && !options.projects.some((project) => project.id === activity.project_id) ? (
                <option value={activity.project_id}>{t(locale, "activity.contextUnavailable")}</option>
              ) : null}
              {options.projects.map((project) => (
                <option key={project.id} value={project.id}>{project.title}</option>
              ))}
            </Select>
            <FieldError state={state} field="project_id" locale={locale} id={projectErrorId} />
          </label>
          <label className="field-label" htmlFor={`${formId}-experience`}>
            {t(locale, "quickLog.experienceLabel")}
            <Select
              className="mt-1"
              id={`${formId}-experience`}
              name={experienceLocked ? undefined : "experience_id"}
              value={contextExperienceId}
              disabled={experienceLocked}
              onChange={(event) => setExperienceId(event.currentTarget.value)}
              {...fieldErrorControlProps(state, "experience_id", experienceErrorId)}
            >
              <option value="">{t(locale, "activity.noExperience")}</option>
              {activity?.experience_id && !options.experiences.some((experience) => experience.id === activity.experience_id) ? (
                <option value={activity.experience_id}>{t(locale, "activity.contextUnavailable")}</option>
              ) : null}
              {options.experiences.map((experience) => (
                <option key={experience.id} value={experience.id}>
                  {experience.role_title} · {experience.organization}
                </option>
              ))}
            </Select>
            {experienceLocked ? <input type="hidden" name="experience_id" value={contextExperienceId} /> : null}
            <FieldError state={state} field="experience_id" locale={locale} id={experienceErrorId} />
            <span className="field-help">
              {selectedProjectId ? t(locale, "quickLog.projectHelp") : t(locale, "quickLog.standaloneHelp")}
            </span>
          </label>
        </fieldset>

        {showEditableStructuredFields ? (
          <details className="activity-details-disclosure" hidden={!activity && mode !== "form"} open={detailFieldError || undefined}>
            <summary>{t(locale, "quickLog.addDetails")}</summary>
            <div className="activity-details-fields">
              <label className="field-label" htmlFor={`${formId}-role`}>
                {t(locale, "quickLog.role")}
                <Input className="mt-1" id={`${formId}-role`} name="role" maxLength={200} defaultValue={activity?.role ?? ""} {...fieldErrorControlProps(state, "role", roleErrorId)} />
                <FieldError state={state} field="role" locale={locale} id={roleErrorId} />
              </label>
              <label className="field-label" htmlFor={`${formId}-scope`}>
                {t(locale, "quickLog.scope")}
                <Textarea className="mt-1 activity-optional-text" id={`${formId}-scope`} name="scope" maxLength={5000} defaultValue={activity?.scope ?? ""} {...fieldErrorControlProps(state, "scope", scopeErrorId)} />
                <FieldError state={state} field="scope" locale={locale} id={scopeErrorId} />
              </label>
              <label className="field-label" htmlFor={`${formId}-outcome`}>
                {t(locale, "quickLog.outcome")}
                <Textarea className="mt-1 activity-optional-text" id={`${formId}-outcome`} name="outcome" maxLength={5000} defaultValue={activity?.outcome ?? ""} {...fieldErrorControlProps(state, "outcome", outcomeErrorId)} />
                <FieldError state={state} field="outcome" locale={locale} id={outcomeErrorId} />
              </label>
            </div>
          </details>
        ) : hasStructuredFields ? (
          <section className="activity-detail-section" aria-labelledby={`${formId}-structured-readonly-heading`}>
            <h2 id={`${formId}-structured-readonly-heading`} className="field-label">{t(locale, "activity.contextDetails")}</h2>
            {activity?.role ? <p><strong>{t(locale, "activity.role")}:</strong> {activity.role}</p> : null}
            {activity?.scope ? <p className="activity-detail-long-text"><strong>{t(locale, "activity.scope")}:</strong> {activity.scope}</p> : null}
            {activity?.outcome ? <p className="activity-detail-long-text"><strong>{t(locale, "activity.outcome")}:</strong> {activity.outcome}</p> : null}
          </section>
        ) : null}

        <ActionFeedback state={state} locale={locale} returnTo={retryReturnTo} />
        {latestVersion ? (
          <section className="activity-conflict" aria-labelledby={`${formId}-conflict-title`} role="group">
            <h3
              id={`${formId}-conflict-title`}
              ref={conflictHeadingRef}
              tabIndex={-1}
              className="text-base font-semibold"
            >
              {restoredDraftMismatch
                ? t(locale, draftRevisionState === "unknown" ? "activity.restoredDraftUnknownTitle" : "activity.restoredDraftTitle")
                : t(locale, "activity.conflictTitle")}
            </h3>
            <p className="field-help">
              {t(locale, restoredDraftMismatch ? "activity.restoredDraftDescription" : "activity.conflictDescription")}
            </p>
            <div className="activity-latest-version">
              <div className="activity-latest-meta">
                <strong>{t(locale, "activity.latestVersion")}</strong>
                <span>{t(locale, "activity.revision", { revision: latestVersion.revision })}</span>
                <time dateTime={latestVersion.occurred_on}>{formatActivityDate(latestVersion.occurred_on, locale)}</time>
              </div>
              <pre className="activity-latest-source">{latestVersion.raw_text}</pre>
              {latestContext && (latestContext.projectLabel || latestContext.experienceLabel || latestContext.projectUnavailable || latestContext.experienceUnavailable) ? (
                <div className="activity-list-context">
                  {latestContext.projectLabel ? <span>{t(locale, "activity.project")}: {latestContext.projectLabel}</span> : null}
                  {latestContext.experienceLabel ? <span>{t(locale, "activity.experience")}: {latestContext.experienceLabel}</span> : null}
                  {latestContext.projectUnavailable || latestContext.experienceUnavailable ? (
                    <span>{t(locale, "activity.contextUnavailable")}</span>
                  ) : null}
                </div>
              ) : null}
              {latestVersion.role ? <p><strong>{t(locale, "activity.role")}:</strong> {latestVersion.role}</p> : null}
              {latestVersion.scope ? <p><strong>{t(locale, "activity.scope")}:</strong> {latestVersion.scope}</p> : null}
              {latestVersion.outcome ? <p><strong>{t(locale, "activity.outcome")}:</strong> {latestVersion.outcome}</p> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={reloadServerVersion}>
                {t(locale, "activity.reloadServer")}
              </Button>
            <Button type="button" onClick={retryLocalChanges}>
              {t(locale, "activity.retryChanges")}
            </Button>
            </div>
          </section>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          {activity ? (
            <Button variant="secondary" type="button" onClick={requestCancelEdit}>{t(locale, "common.cancel")}</Button>
          ) : (
            <Link className="button-secondary" href={returnTo}>{t(locale, "common.cancel")}</Link>
          )}
          <SubmitButton
            pendingLabel={t(locale, "quickLog.saving")}
            disabled={(!activity && !operationKey) || restoredDraftMismatch}
          >
            {t(locale, activity ? "quickLog.saveChanges" : "quickLog.save")}
          </SubmitButton>
          {!activity && !operationKey ? (
            <p id="activity-operation-key-unavailable" className="ui-message ui-message--warning" role="status">
              {t(locale, "quickLog.operationKeyUnavailable")}
            </p>
          ) : null}
        </div>
      </form>
      {activity ? (
        <Dialog
          open={cancelDialogOpen}
          onOpenChange={setCancelDialogOpen}
          title={t(locale, "common.unsavedTitle")}
          description={t(locale, "common.unsavedDescription")}
        >
          <div className="ui-dialog-actions">
            <Button variant="secondary" autoFocus onClick={() => setCancelDialogOpen(false)}>{t(locale, "common.unsavedStay")}</Button>
            <Button variant="primary" onClick={discardEdit}>{t(locale, "common.unsavedContinue")}</Button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
