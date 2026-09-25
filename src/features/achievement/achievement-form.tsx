"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import { ActionFeedback, FieldError, fieldErrorControlProps, fieldErrorId } from "@/components/forms/action-feedback";
import { useCreateOperationKey } from "@/components/forms/operation-key";
import { clearSessionDraftForForm, useSessionDraft } from "@/components/forms/session-draft";
import { SubmitButton } from "@/components/forms/submit-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/field-control";
import { RevisionConflict } from "@/components/ui/revision-conflict";
import { clearUnsavedForm, useUnsavedForm } from "@/components/ui/unsaved-changes";
import type { AchievementContextOptions, AchievementDetail, AchievementRow } from "@/domain/achievement/contracts";
import { availableAchievementActions, isAchievementAction, nextAchievementStatus } from "@/domain/achievement/transition";
import { createAchievementAction, saveAchievementAction } from "@/features/achievement/actions";
import { MetricsEditor } from "@/features/achievement/metrics-editor";
import { SkillTags } from "@/features/achievement/skill-tags";
import { t, type Locale } from "@/i18n/messages";
import { IDLE_ACTION_STATE, type ActionState } from "@/server/action-result";

export function AchievementForm({
  locale,
  ownerId,
  contextOptions,
  returnTo,
  createPath,
  achievement,
  detail,
  activityId,
  sourceActivity,
  initialProjectId = "",
  initialExperienceId = "",
}: {
  locale: Locale;
  ownerId: string;
  contextOptions: AchievementContextOptions;
  returnTo: string;
  createPath?: string;
  achievement?: AchievementRow;
  detail?: AchievementDetail;
  activityId?: string | null;
  sourceActivity?: AchievementDetail["activity"] | null;
  initialProjectId?: string;
  initialExperienceId?: string;
}) {
  const isEditing = Boolean(achievement);
  const formId = achievement ? `achievement-edit-form-${achievement.id}` : "achievement-create-form";
  const formKey = achievement ? `achievement-edit-${achievement.id}` : "achievement-create";
  const [state, formAction, isPending] = useActionState(isEditing ? saveAchievementAction : createAchievementAction, IDLE_ACTION_STATE);
  const { formRef, onInputCapture, onChangeCapture } = useSessionDraft(formKey, ownerId, state);
  const unsaved = useUnsavedForm(formId, state);
  const operationKey = useCreateOperationKey(ownerId, isEditing ? null : "achievement-create", state);
  const router = useRouter();
  const [projectId, setProjectId] = useState(initialProjectId || achievement?.project_id || "");
  const [experienceId, setExperienceId] = useState(initialExperienceId || achievement?.experience_id || "");
  const [skills, setSkills] = useState(detail?.skills.map((skill) => skill.name) ?? []);
  const initialRevision = achievement?.revision ?? 1;
  const handledSuccess = useRef("");
  const latestConflict = state.status === "error" && state.error.code === "CONFLICT" && state.error.latestRecord
    ? state.error.latestRecord as AchievementRow
    : null;

  useEffect(() => {
    if (state.status !== "error") return;
    const firstInvalid = ["title", "contribution", "outcome", "achieved_on", "cv_bullet", "scope", "metrics_json", "skill_names"]
      .find((field) => state.error.fieldErrors?.[field]);
    const control = firstInvalid
      ? formRef.current?.elements.namedItem(firstInvalid) ?? (firstInvalid === "metrics_json" ? formRef.current?.querySelector('input[name^="metric_"]') ?? null : null)
      : null;
    if (control instanceof HTMLElement) requestAnimationFrame(() => control.focus({ preventScroll: true }));
  }, [formRef, state]);

  useEffect(() => {
    if (!isPending && latestConflict) {
      window.requestAnimationFrame(() => {
        formRef.current?.querySelector<HTMLButtonElement>("[data-conflict-recovery]")?.focus({ preventScroll: true });
      });
    }
  }, [formRef, isPending, latestConflict]);

  useEffect(() => {
    if (state.status !== "success" || handledSuccess.current === state.correlationId) return;
    handledSuccess.current = state.correlationId;
    clearUnsavedForm(formId);
    if (!isEditing) {
      const receipt = state.data as { achievementId?: string } | undefined;
      if (receipt?.achievementId) router.push(`/achievements/${receipt.achievementId}?${new URLSearchParams({ returnTo }).toString()}`);
    } else router.refresh();
  }, [formId, isEditing, returnTo, router, state]);

  function reloadServer() {
    clearSessionDraftForForm(ownerId, formKey);
    clearUnsavedForm(formId);
    window.location.assign(window.location.href);
  }

  if (!isEditing) {
    return (
      <form ref={formRef} id={formId} action={formAction} className="achievement-form" onInputCapture={(event) => { onInputCapture(event); unsaved.onInputCapture(event); }} onChangeCapture={(event) => { onChangeCapture(event); unsaved.onChangeCapture(event); }}>
        <input type="hidden" name="operation_key" value={operationKey ?? ""} />
        <input type="hidden" name="activity_id" value={activityId ?? ""} />
        <input type="hidden" name="project_id" value={projectId} />
        <input type="hidden" name="experience_id" value={projectId ? "" : experienceId} />
        <Card>
          <h2 className="text-lg font-semibold">{activityId ? t(locale, "achievement.createFromActivity") : projectId ? t(locale, "achievement.createFromProject") : t(locale, "achievement.standalone")}</h2>
          <p className="field-help mt-2">{t(locale, "achievement.description")}</p>
          {sourceActivity ? <div className="achievement-source-preview mt-4"><p className="field-label">{t(locale, "achievement.source")}</p><p>{sourceActivity.raw_text}</p></div> : null}
          <div className="achievement-form-grid mt-4">
            {!activityId ? (
              <label className="field-label">{t(locale, "achievement.project")}
                <Select value={projectId} onChange={(event) => { const nextProjectId = event.currentTarget.value; setProjectId(nextProjectId); setExperienceId(contextOptions.projects.find((item) => item.id === nextProjectId)?.experience_id ?? ""); }}>
                  <option value="">{t(locale, "achievement.noProject")}</option>
                  {contextOptions.projects.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                </Select>
              </label>
            ) : null}
            {!activityId && !projectId ? (
              <label className="field-label">{t(locale, "achievement.experience")}
                <Select value={experienceId} onChange={(event) => setExperienceId(event.currentTarget.value)}>
                  <option value="">{t(locale, "achievement.noExperience")}</option>
                  {contextOptions.experiences.map((item) => <option key={item.id} value={item.id}>{item.role_title} · {item.organization}</option>)}
                </Select>
              </label>
            ) : null}
          </div>
          {projectId ? <p className="field-help mt-2">{t(locale, "achievement.projectSetsExperience")}</p> : null}
          <ActionFeedback state={state} locale={locale} returnTo={createPath ?? returnTo} />
          <div className="mt-4 flex flex-wrap gap-2">
            <SubmitButton disabled={!operationKey} pendingLabel={t(locale, "achievement.saving")}>{t(locale, "achievement.new")}</SubmitButton>
            <a className="button-secondary" href={returnTo}>{t(locale, "common.cancel")}</a>
          </div>
        </Card>
      </form>
    );
  }

  const current = achievement as AchievementRow;
  const actionRecord = state.status === "success" ? state.data as AchievementRow | undefined : undefined;
  const submittedAction = state.status === "error" && isAchievementAction(state.error.retryAction) ? state.error.retryAction : null;
  const submittedRevision = actionRecord?.revision ?? initialRevision;
  const revisionForSubmission = latestConflict?.revision ?? submittedRevision;
  return (
    <form
      ref={formRef}
      id={formId}
      action={formAction}
      className="achievement-form space-y-5"
      onInputCapture={(event) => { onInputCapture(event); unsaved.onInputCapture(event); }}
      onChangeCapture={(event) => { onChangeCapture(event); unsaved.onChangeCapture(event); }}
    >
      <input type="hidden" name="achievement_id" value={current.id} />
      <input type="hidden" name="expected_revision" value={revisionForSubmission} />
      <Card>
        <div className="achievement-form-grid">
          <div>
            <label className="field-label" htmlFor={`${formId}-title`}>{t(locale, "achievement.titleField")}
              <Input id={`${formId}-title`} name="title" maxLength={200} defaultValue={current.title ?? ""} {...fieldErrorControlProps(state, "title", fieldErrorId(formId, "title"))} />
            </label>
            <FieldError state={state} field="title" locale={locale} id={fieldErrorId(formId, "title")} />
          </div>
          <label className="field-label">{t(locale, "achievement.date")}
            <Input name="achieved_on" type="date" defaultValue={current.achieved_on ?? ""} {...fieldErrorControlProps(state, "achieved_on", fieldErrorId(formId, "achieved_on"))} />
          </label>
        </div>
        <FieldError state={state} field="achieved_on" locale={locale} id={fieldErrorId(formId, "achieved_on")} />
        <label className="field-label mt-4" htmlFor={`${formId}-contribution`}>{t(locale, "achievement.contribution")}
          <Textarea id={`${formId}-contribution`} name="contribution" rows={5} maxLength={5000} defaultValue={current.contribution ?? ""} {...fieldErrorControlProps(state, "contribution", fieldErrorId(formId, "contribution"))} />
        </label>
        <FieldError state={state} field="contribution" locale={locale} id={fieldErrorId(formId, "contribution")} />
        <label className="field-label mt-4" htmlFor={`${formId}-scope`}>{t(locale, "achievement.scope")}
          <Textarea id={`${formId}-scope`} name="scope" rows={3} maxLength={5000} defaultValue={current.scope ?? ""} />
        </label>
        <label className="field-label mt-4" htmlFor={`${formId}-outcome`}>{t(locale, "achievement.outcome")}
          <Textarea id={`${formId}-outcome`} name="outcome" rows={5} maxLength={5000} defaultValue={current.outcome ?? ""} {...fieldErrorControlProps(state, "outcome", fieldErrorId(formId, "outcome"))} />
        </label>
        <FieldError state={state} field="outcome" locale={locale} id={fieldErrorId(formId, "outcome")} />
        <label className="field-label mt-4" htmlFor={`${formId}-cv-bullet`}>{t(locale, "achievement.cvBullet")}
          <Textarea id={`${formId}-cv-bullet`} name="cv_bullet" rows={4} maxLength={2000} defaultValue={current.cv_bullet ?? ""} {...fieldErrorControlProps(state, "cv_bullet", fieldErrorId(formId, "cv_bullet"))} />
        </label>
        <FieldError state={state} field="cv_bullet" locale={locale} id={fieldErrorId(formId, "cv_bullet")} />
        <p className="field-help mt-1">{t(locale, "achievement.cvBulletHelp")}</p>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">{t(locale, "achievement.skills")}</h2>
        <p className="field-help mt-1">{t(locale, "achievement.skillsHelp")}</p>
        <div className="mt-3"><SkillTags locale={locale} value={skills} onChange={setSkills} /></div>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">{t(locale, "achievement.metrics")}</h2>
        <p className="field-help mt-1">{t(locale, "achievement.metricsHelp")}</p>
        <div className="mt-3"><MetricsEditor locale={locale} initialValue={current.metrics} /></div>
      </Card>

      <ActionFeedback state={state} locale={locale} returnTo={returnTo} />
      {latestConflict ? (
        <RevisionConflict title={t(locale, "achievement.conflictTitle")} labelledBy={`${formId}-conflict`}>
          <p>{t(locale, "achievement.conflictDescription")}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" disabled={isPending} onClick={reloadServer}>{t(locale, "achievement.reloadServer")}</Button>
            {submittedAction && nextAchievementStatus(latestConflict.status, submittedAction) !== null ? (
              <Button type="submit" name="achievement_action" value={submittedAction} disabled={isPending} data-conflict-recovery>{t(locale, "achievement.retryChanges")}</Button>
            ) : null}
          </div>
          {!submittedAction || nextAchievementStatus(latestConflict.status, submittedAction) === null ? (
            <div className="mt-3 space-y-2">
              <p className="field-help">{t(locale, "achievement.conflictChooseAction")}</p>
              <div className="flex flex-wrap gap-2">
                {availableAchievementActions(latestConflict.status).map((action) => (
                  <Button key={action} type="submit" name="achievement_action" value={action} disabled={isPending} data-conflict-recovery>
                    {t(locale, action === "save_draft" ? "achievement.save" : action === "confirm" ? "achievement.confirm" : action === "dismiss" ? "achievement.dismiss" : action === "reopen" ? "achievement.reopen" : "achievement.saveChanges")}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </RevisionConflict>
      ) : (
        <div className="flex flex-wrap gap-2">
          {current.status === "draft" ? <>
            <Button type="submit" name="achievement_action" value="save_draft" disabled={isPending}>{t(locale, "achievement.save")}</Button>
            <Button type="submit" name="achievement_action" value="confirm" variant="secondary" disabled={isPending}>{t(locale, "achievement.confirm")}</Button>
            <Button type="submit" name="achievement_action" value="dismiss" variant="secondary" disabled={isPending}>{t(locale, "achievement.dismiss")}</Button>
          </> : current.status === "dismissed" ? (
            <Button type="submit" name="achievement_action" value="reopen" disabled={isPending}>{t(locale, "achievement.reopen")}</Button>
          ) : (
            <Button type="submit" name="achievement_action" value="save_changes" disabled={isPending}>{t(locale, "achievement.saveChanges")}</Button>
          )}
          <a className="button-secondary" href={returnTo}>{t(locale, "common.cancel")}</a>
        </div>
      )}
      {current.status === "confirmed" ? <p className="field-help">{t(locale, "achievement.confirmedNoCv")}</p> : null}
    </form>
  );
}
