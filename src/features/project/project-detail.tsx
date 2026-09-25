"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import { ActionFeedback } from "@/components/forms/action-feedback";
import { SubmitButton } from "@/components/forms/submit-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { InlineError } from "@/components/ui/inline-error";
import { NamedDeleteDialog } from "@/components/ui/named-delete-dialog";
import { formatActivityDate, activityExcerpt } from "@/domain/activity/activity-display";
import type { AchievementRelinkCandidatePage } from "@/domain/achievement/contracts";
import { formatProjectDateRange, projectExperienceLabel, projectNeedsOutcome } from "@/domain/project/project-display";
import type { ProjectDetail as ProjectDetailData, ProjectRelinkCandidatePage } from "@/domain/project/contracts";
import { achievementDateLabel, achievementStatusLabel } from "@/domain/achievement/achievement-display";
import { listAchievementRelinkCandidatesAction, relinkAchievementAction } from "@/features/achievement/actions";
import { deleteProjectAction, listRelinkCandidatesAction, relinkActivityProjectAction } from "@/features/project/actions";
import { t, type Locale } from "@/i18n/messages";
import { IDLE_ACTION_STATE, type ActionState } from "@/server/action-result";

function RelinkForm({
  locale,
  activityId,
  expectedRevision,
  targetProjectId,
  actionLabel,
  returnTo,
  onSuccess,
}: {
  locale: Locale;
  activityId: string;
  expectedRevision: number;
  targetProjectId: string | null;
  actionLabel: string;
  returnTo: string;
  onSuccess?: () => void;
}) {
  const [state, action] = useActionState(relinkActivityProjectAction, IDLE_ACTION_STATE);
  const router = useRouter();
  const handledSuccess = useRef("");
  useEffect(() => {
    if (state.status !== "success" || handledSuccess.current === state.correlationId) return;
    handledSuccess.current = state.correlationId;
    onSuccess?.();
    router.refresh();
  }, [onSuccess, router, state]);
  const formId = `relink-activity-${activityId}-${targetProjectId ?? "detach"}`;
  return (
    <form id={formId} action={action} className="project-inline-action">
      <input type="hidden" name="activity_id" value={activityId} />
      <input type="hidden" name="activity_expected_revision" value={expectedRevision} />
      <input type="hidden" name="project_id" value={targetProjectId ?? ""} />
      <SubmitButton className="button-secondary" pendingLabel={t(locale, "project.saving")}>{actionLabel}</SubmitButton>
      <ActionFeedback state={state} locale={locale} returnTo={returnTo} />
    </form>
  );
}

function AttachDialog({
  locale,
  projectId,
  candidatePage,
  returnTo,
}: {
  locale: Locale;
  projectId: string;
  candidatePage: ProjectRelinkCandidatePage;
  returnTo: string;
}) {
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState(candidatePage.items);
  const [nextCursor, setNextCursor] = useState(candidatePage.nextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadState, setLoadState] = useState<ActionState>(IDLE_ACTION_STATE);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setLoadState(IDLE_ACTION_STATE);
    try {
      const result = await listRelinkCandidatesAction(projectId, nextCursor);
      if (result.status === "error") {
        setLoadState(result);
        return;
      }
      if (result.status !== "success") {
        setLoadState({ status: "error", error: { code: "UNAVAILABLE", messageKey: "error.unavailable", correlationId: crypto.randomUUID() } });
        return;
      }
      const data = result.data;
      if (!data || typeof data !== "object") {
        setLoadState({ status: "error", error: { code: "UNAVAILABLE", messageKey: "error.unavailable", correlationId: crypto.randomUUID() } });
        return;
      }
      const candidateData = data as { items?: unknown; nextCursor?: unknown };
      if (!Array.isArray(candidateData.items) || !("nextCursor" in candidateData)) {
        setLoadState({ status: "error", error: { code: "UNAVAILABLE", messageKey: "error.unavailable", correlationId: crypto.randomUUID() } });
        return;
      }
      const page = candidateData as unknown as ProjectRelinkCandidatePage;
      setCandidates((current) => {
        const existingIds = new Set(current.map((candidate) => candidate.id));
        return [...current, ...page.items.filter((candidate) => !existingIds.has(candidate.id))];
      });
      setNextCursor(page.nextCursor);
    } catch {
      setLoadState({ status: "error", error: { code: "UNAVAILABLE", messageKey: "error.unavailable", correlationId: crypto.randomUUID() } });
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => { setLoadState(IDLE_ACTION_STATE); setOpen(true); }}>{t(locale, "project.attachExisting")}</Button>
      <Dialog open={open} onOpenChange={setOpen} title={t(locale, "project.attachExisting")} description={t(locale, "project.candidateDescription")} className="project-attach-dialog">
        {loadState.status === "error" ? (
          <InlineError correlationId={loadState.error.correlationId} className="mt-4">
            <p>{t(locale, loadState.error.messageKey)}</p>
            {nextCursor ? <Button type="button" variant="secondary" onClick={() => void loadMore()} disabled={loadingMore}>{t(locale, "project.retry")}</Button> : null}
          </InlineError>
        ) : null}
        {candidates.length === 0 ? (
          <p className="field-help mt-4">{t(locale, "project.noCandidates")}</p>
        ) : (
          <ul className="project-candidate-list mt-4" aria-busy={loadingMore}>
            {candidates.map((candidate) => (
              <li key={candidate.id} className="project-candidate-row">
                <div className="min-w-0">
                  <p className="font-semibold">{activityExcerpt(candidate.raw_text, 140)}</p>
                  <p className="field-help">
                    {formatActivityDate(candidate.occurred_on, locale)} · {candidate.currentProjectTitle ? `${t(locale, "project.move")}: ${candidate.currentProjectTitle}` : t(locale, "project.independent")}
                  </p>
                </div>
                <RelinkForm locale={locale} activityId={candidate.id} expectedRevision={candidate.revision} targetProjectId={projectId} actionLabel={candidate.project_id ? t(locale, "project.move") : t(locale, "project.attach")} returnTo={returnTo} onSuccess={() => setCandidates((current) => current.filter((item) => item.id !== candidate.id))} />
              </li>
            ))}
          </ul>
        )}
        {loadingMore ? <p className="field-help mt-3" role="status" aria-live="polite">{t(locale, "project.loadingCandidates")}</p> : null}
        {!loadingMore && candidates.length > 0 && nextCursor ? (
          <Button type="button" variant="secondary" className="mt-4" onClick={() => void loadMore()} disabled={loadingMore}>{t(locale, "project.loadMoreCandidates")}</Button>
        ) : null}
        {!loadingMore && candidates.length > 0 && !nextCursor ? <p className="field-help mt-3" role="status">{t(locale, "project.candidatesEnd")}</p> : null}
        <div className="ui-dialog-actions">
          <Button variant="secondary" onClick={() => setOpen(false)}>{t(locale, "common.cancel")}</Button>
        </div>
      </Dialog>
    </>
  );
}

function AchievementRelinkForm({
  locale,
  achievementId,
  expectedRevision,
  targetProjectId,
  actionLabel,
  returnTo,
  onSuccess,
}: {
  locale: Locale;
  achievementId: string;
  expectedRevision: number;
  targetProjectId: string | null;
  actionLabel: string;
  returnTo: string;
  onSuccess?: () => void;
}) {
  const [state, action] = useActionState(relinkAchievementAction, IDLE_ACTION_STATE);
  const router = useRouter();
  const handledSuccess = useRef("");
  useEffect(() => {
    if (state.status !== "success" || handledSuccess.current === state.correlationId) return;
    handledSuccess.current = state.correlationId;
    onSuccess?.();
    router.refresh();
  }, [onSuccess, router, state]);
  const formId = `relink-achievement-${achievementId}-${targetProjectId ?? "detach"}`;
  return (
    <form id={formId} action={action} className="project-inline-action">
      <input type="hidden" name="achievement_id" value={achievementId} />
      <input type="hidden" name="expected_revision" value={expectedRevision} />
      <input type="hidden" name="project_id" value={targetProjectId ?? ""} />
      <SubmitButton className="button-secondary" pendingLabel={t(locale, "project.saving")}>{actionLabel}</SubmitButton>
      <ActionFeedback state={state} locale={locale} returnTo={returnTo} />
    </form>
  );
}

function AchievementAttachDialog({
  locale,
  projectId,
  candidatePage,
  returnTo,
}: {
  locale: Locale;
  projectId: string;
  candidatePage: AchievementRelinkCandidatePage;
  returnTo: string;
}) {
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState(candidatePage.items);
  const [nextCursor, setNextCursor] = useState(candidatePage.nextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadState, setLoadState] = useState<ActionState>(IDLE_ACTION_STATE);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setLoadState(IDLE_ACTION_STATE);
    try {
      const result = await listAchievementRelinkCandidatesAction(projectId, nextCursor);
      if (result.status === "error") {
        setLoadState(result);
        return;
      }
      if (result.status !== "success" || !result.data || typeof result.data !== "object") {
        setLoadState({ status: "error", error: { code: "UNAVAILABLE", messageKey: "error.unavailable", correlationId: crypto.randomUUID() } });
        return;
      }
      const candidateData = result.data as { items?: unknown; nextCursor?: unknown };
      if (!Array.isArray(candidateData.items) || !("nextCursor" in candidateData)) {
        setLoadState({ status: "error", error: { code: "UNAVAILABLE", messageKey: "error.unavailable", correlationId: crypto.randomUUID() } });
        return;
      }
      const page = candidateData as unknown as AchievementRelinkCandidatePage;
      setCandidates((current) => {
        const existingIds = new Set(current.map((candidate) => candidate.achievement.id));
        return [...current, ...page.items.filter((candidate) => !existingIds.has(candidate.achievement.id))];
      });
      setNextCursor(page.nextCursor);
    } catch {
      setLoadState({ status: "error", error: { code: "UNAVAILABLE", messageKey: "error.unavailable", correlationId: crypto.randomUUID() } });
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => { setLoadState(IDLE_ACTION_STATE); setOpen(true); }}>{t(locale, "project.attachExistingAchievement")}</Button>
      <Dialog open={open} onOpenChange={setOpen} title={t(locale, "project.attachExistingAchievement")} description={t(locale, "project.achievementCandidateDescription")} className="project-attach-dialog">
        {loadState.status === "error" ? (
          <InlineError correlationId={loadState.error.correlationId} className="mt-4">
            <p>{t(locale, loadState.error.messageKey)}</p>
            {nextCursor ? <Button type="button" variant="secondary" onClick={() => void loadMore()} disabled={loadingMore}>{t(locale, "project.retry")}</Button> : null}
          </InlineError>
        ) : null}
        {candidates.length === 0 ? (
          <p className="field-help mt-4">{t(locale, "project.noAchievementCandidates")}</p>
        ) : (
          <ul className="project-candidate-list mt-4" aria-busy={loadingMore}>
            {candidates.map((candidate) => {
              const achievement = candidate.achievement;
              const actionLabel = candidate.currentProjectTitle ? t(locale, "project.moveAchievement") : t(locale, "project.attachAchievementAction");
              return (
                <li key={achievement.id} className="project-candidate-row">
                  <div className="min-w-0">
                    <p className="font-semibold">{achievement.title ?? t(locale, "achievement.untitledDraft")}</p>
                    <p className="field-help">
                      {achievementStatusLabel(achievement.status, locale)} · {achievementDateLabel(achievement.achieved_on, t(locale, "achievement.dateNotSet"))} · {candidate.currentProjectTitle ? `${t(locale, "project.currentProject")}: ${candidate.currentProjectTitle}` : t(locale, "project.independent")}
                    </p>
                  </div>
                  <AchievementRelinkForm locale={locale} achievementId={achievement.id} expectedRevision={achievement.revision} targetProjectId={projectId} actionLabel={actionLabel} returnTo={returnTo} onSuccess={() => setCandidates((current) => current.filter((item) => item.achievement.id !== achievement.id))} />
                </li>
              );
            })}
          </ul>
        )}
        {loadingMore ? <p className="field-help mt-3" role="status" aria-live="polite">{t(locale, "project.loadingAchievementCandidates")}</p> : null}
        {!loadingMore && candidates.length > 0 && nextCursor ? (
          <Button type="button" variant="secondary" className="mt-4" onClick={() => void loadMore()} disabled={loadingMore}>{t(locale, "project.loadMoreAchievements")}</Button>
        ) : null}
        {!loadingMore && candidates.length > 0 && !nextCursor ? <p className="field-help mt-3" role="status">{t(locale, "project.achievementCandidatesEnd")}</p> : null}
        <div className="ui-dialog-actions">
          <Button variant="secondary" onClick={() => setOpen(false)}>{t(locale, "common.cancel")}</Button>
        </div>
      </Dialog>
    </>
  );
}

function DeleteProjectForm({
  locale,
  project,
  dependencyCount,
  achievementCount,
  returnTo,
}: {
  locale: Locale;
  project: ProjectDetailData["project"];
  dependencyCount: number;
  achievementCount: number;
  returnTo: string;
}) {
  const [state, action] = useActionState(deleteProjectAction, IDLE_ACTION_STATE);
  const formId = `delete-project-${project.id}`;
  return (
    <NamedDeleteDialog
      title={t(locale, "common.deleteTitle")}
      description={t(locale, "project.deleteDescription")}
      recordName={project.title}
      triggerLabel={t(locale, "common.delete")}
      cancelLabel={t(locale, "common.cancel")}
      confirmLabel={t(locale, "common.delete")}
      formId={formId}
      disabled={dependencyCount < 0}
      successful={state.status === "success"}
    >
      <form id={formId} action={action} className="mt-4 space-y-3">
        <input type="hidden" name="project_id" value={project.id} />
        <input type="hidden" name="expected_revision" value={project.revision} />
        <input type="hidden" name="return_to" value={returnTo} />
        <ul className="space-y-2 text-sm text-[var(--color-text-secondary)]">
          <li>{t(locale, "project.deleteRetained", { count: dependencyCount })}</li>
          <li>{t(locale, "project.deleteAchievementsRetained", { count: achievementCount })}</li>
          <li>{t(locale, "project.deleteLinkCleaned")}</li>
          <li>{t(locale, "project.deleteExperienceRetained")}</li>
        </ul>
        <ActionFeedback state={state} locale={locale} returnTo={returnTo} />
      </form>
    </NamedDeleteDialog>
  );
}

export function ProjectDetail({
  locale,
  ownerId: _ownerId,
  detail,
  candidates,
  achievementCandidates,
  returnTo,
}: {
  locale: Locale;
  ownerId: string;
  detail: ProjectDetailData;
  candidates: ProjectRelinkCandidatePage;
  achievementCandidates: AchievementRelinkCandidatePage;
  returnTo: string;
}) {
  const { project, experience, activities, achievements, dependencyCount } = detail;
  const detailReturnTo = `/projects/${project.id}?${new URLSearchParams({ returnTo }).toString()}`;
  const projectActivityReturn = detailReturnTo;
  return (
    <div className="space-y-5">
      <Card className="project-detail-overview">
        <div className="project-detail-heading-row">
          <div>
            <p className="field-help">{t(locale, "project.detailTitle")}</p>
            <h1 className="text-3xl font-semibold tracking-tight">{project.title}</h1>
            <div className="project-list-meta mt-3">
              <span className="ui-badge">{t(locale, `project.${project.status}`)}</span>
              <span>{formatProjectDateRange(project, locale, t(locale, "project.dateNotSet"), t(locale, "project.present"))}</span>
              <span>{projectExperienceLabel(experience, t(locale, "project.independent"))}</span>
            </div>
          </div>
          <Link className="button-secondary" href={returnTo}>{t(locale, "project.back")}</Link>
        </div>
        {project.user_role ? <p><strong>{t(locale, "project.role")}:</strong> {project.user_role}</p> : null}
        {project.description ? <p className="project-detail-long-text">{project.description}</p> : null}
        {project.outcome ? <p className="project-detail-long-text"><strong>{t(locale, "project.outcome")}:</strong> {project.outcome}</p> : null}
        {projectNeedsOutcome(project) ? <p className="ui-message ui-message--warning" role="status"><strong>{t(locale, "project.needsOutcome")}</strong> {t(locale, "project.needsOutcomeHelp")}</p> : null}
        <div className="project-detail-actions">
          <Link className="button-primary" href={`/activity/new?${new URLSearchParams({ project: project.id, returnTo: projectActivityReturn }).toString()}`}>
            {t(locale, "project.logRelatedWork")}
          </Link>
          <AttachDialog key={`${project.revision}:${dependencyCount}:${candidates.items.at(0)?.id ?? "none"}:${candidates.nextCursor ?? "end"}`} locale={locale} projectId={project.id} candidatePage={candidates} returnTo={detailReturnTo} />
          <AchievementAttachDialog key={`${project.revision}:${achievements.length}:${achievementCandidates.items.at(0)?.achievement.id ?? "none"}:${achievementCandidates.nextCursor ?? "end"}`} locale={locale} projectId={project.id} candidatePage={achievementCandidates} returnTo={detailReturnTo} />
          <DeleteProjectForm locale={locale} project={project} dependencyCount={dependencyCount} achievementCount={achievements.length} returnTo={returnTo} />
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-xl font-semibold">{t(locale, "project.linkedAchievements")}</h2><p className="field-help">{t(locale, "project.linkedAchievementCount", { count: achievements.length })}</p></div>
          <Link className="button-secondary" href={`/achievements/new?${new URLSearchParams({ project: project.id, returnTo: detailReturnTo }).toString()}`}>{t(locale, "project.createAchievement")}</Link>
        </div>
        {achievements.length === 0 ? <p className="field-help mt-4">{t(locale, "project.noAchievements")}</p> : (
          <ul className="achievement-list mt-4">
            {achievements.map(({ achievement, skills }) => (
              <li key={achievement.id} className="project-achievement-row">
                <Link className="achievement-list-row" href={`/achievements/${achievement.id}?${new URLSearchParams({ returnTo: detailReturnTo }).toString()}`}><span className="achievement-list-main"><span className="achievement-list-title">{achievement.title ?? t(locale, "achievement.untitledDraft")}</span><span className="achievement-list-meta"><span className="ui-badge">{t(locale, `achievement.${achievement.status}`)}</span>{achievement.achieved_on ?? t(locale, "achievement.dateNotSet")}</span></span><span className="achievement-list-context">{achievement.outcome ?? t(locale, "achievement.noMatchDescription")}{skills.length ? ` · ${skills.map((skill) => skill.name).join(", ")}` : ""}</span></Link>
                <AchievementRelinkForm locale={locale} achievementId={achievement.id} expectedRevision={achievement.revision} targetProjectId={null} actionLabel={t(locale, "project.detachAchievement")} returnTo={detailReturnTo} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">{t(locale, "project.linkedActivities")}</h2>
            <p className="field-help">{t(locale, "project.linkedCount", { count: dependencyCount })}</p>
          </div>
        </div>
        {activities.length === 0 ? <p className="field-help mt-4">{t(locale, "project.noActivities")}</p> : (
          <ul className="project-activity-list mt-4">
            {activities.map((activity) => (
              <li key={activity.id} className="project-activity-row">
                <Link href={`/activity/${activity.id}?${new URLSearchParams({ returnTo: detailReturnTo }).toString()}`} className="project-activity-link">
                  <span className="project-activity-date">{formatActivityDate(activity.occurred_on, locale)}</span>
                  <span className="project-activity-excerpt">{activityExcerpt(activity.raw_text)}</span>
                </Link>
                <RelinkForm locale={locale} activityId={activity.id} expectedRevision={activity.revision} targetProjectId={null} actionLabel={t(locale, "project.detach")} returnTo={detailReturnTo} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
