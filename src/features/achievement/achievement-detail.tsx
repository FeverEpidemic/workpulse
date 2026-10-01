"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";

import { ActionFeedback } from "@/components/forms/action-feedback";
import { SubmitButton } from "@/components/forms/submit-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field-control";
import { NamedDeleteDialog } from "@/components/ui/named-delete-dialog";
import { formatActivityDate } from "@/domain/activity/activity-display";
import type { AchievementContextOptions, AchievementDetail as AchievementDetailData } from "@/domain/achievement/contracts";
import { deleteAchievementAction, relinkAchievementAction } from "@/features/achievement/actions";
import { AchievementForm } from "@/features/achievement/achievement-form";
import { AchievementSourceCard } from "@/features/achievement/achievement-source-card";
import type { AchievementAiSuggestion } from "@/features/ai/achievement-ai-suggestion";
import { AiSuggestionAside } from "@/features/ai/ai-suggestion-aside";
import { EvidenceAttachments } from "@/features/evidence/evidence-attachments";
import { t, type Locale } from "@/i18n/messages";
import { IDLE_ACTION_STATE } from "@/server/action-result";

function RelinkForm({ locale, detail, options }: { locale: Locale; detail: AchievementDetailData; options: AchievementContextOptions }) {
  const [state, action] = useActionState(relinkAchievementAction, IDLE_ACTION_STATE);
  const [projectId, setProjectId] = useState(detail.achievement.project_id ?? "");
  const handled = useRef("");
  useEffect(() => {
    if (state.status === "success" && handled.current !== state.correlationId) {
      handled.current = state.correlationId;
      window.location.reload();
    }
  }, [state]);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="achievement_id" value={detail.achievement.id} />
      <input type="hidden" name="expected_revision" value={detail.achievement.revision} />
      <label className="field-label min-w-56">{t(locale, "achievement.project")}
        <Select name="project_id" value={projectId} onChange={(event) => setProjectId(event.currentTarget.value)}>
          <option value="">{t(locale, "achievement.noProject")}</option>
          {options.projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
        </Select>
      </label>
      <SubmitButton className="button-secondary" pendingLabel={t(locale, "achievement.saving")}>{t(locale, "achievement.saveChanges")}</SubmitButton>
      <ActionFeedback state={state} locale={locale} />
    </form>
  );
}

export function AchievementDetail({
  locale,
  ownerId,
  detail,
  contextOptions,
  returnTo,
  aiSuggestion = null,
}: {
  locale: Locale;
  ownerId: string;
  detail: AchievementDetailData;
  contextOptions: AchievementContextOptions;
  returnTo: string;
  aiSuggestion?: AchievementAiSuggestion | null;
}) {
  const { achievement, activity, skills } = detail;
  const [evidenceCount, setEvidenceCount] = useState<number | null>(null);
  const [deleteState, deleteAction] = useActionState(deleteAchievementAction, IDLE_ACTION_STATE);
  const detailReturn = `/achievements/${achievement.id}?${new URLSearchParams({ returnTo }).toString()}`;
  return (
    <section className="space-y-5">
      <header className="workspace-page-header">
        <Link className="button-secondary mb-4" href={returnTo}>{t(locale, "achievement.back")}</Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="field-help">{t(locale, `achievement.${achievement.status}`)}</p>
            <h1 className="text-3xl font-semibold tracking-tight">{achievement.title ?? t(locale, "achievement.untitledDraft")}</h1>
            <p className="mt-2 text-[var(--color-text-secondary)]">{achievement.origin === "activity" ? t(locale, "achievement.createFromActivity") : achievement.origin === "import" ? t(locale, "achievement.importedFromCv") : achievement.project_id ? t(locale, "achievement.createFromProject") : t(locale, "achievement.standalone")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
          {achievement.status === "confirmed" ? (
            <Link className="button-secondary" href={`/cv?highlight=${achievement.id}`} aria-describedby="achievement-add-to-cv-help">{t(locale, "cv.addToCv")}</Link>
          ) : null}
          <NamedDeleteDialog
            title={t(locale, "common.deleteTitle")}
            description={t(locale, "achievement.deleteDescription")}
            recordName={achievement.title ?? t(locale, "achievement.untitledDraft")}
            triggerLabel={t(locale, "common.delete")}
            cancelLabel={t(locale, "common.cancel")}
            confirmLabel={t(locale, "common.delete")}
            formId={`delete-achievement-${achievement.id}`}
            disabled={evidenceCount === null}
            successful={deleteState.status === "success"}
          >
            <form id={`delete-achievement-${achievement.id}`} action={deleteAction} className="mt-4 space-y-3">
              <input type="hidden" name="achievement_id" value={achievement.id} />
              <input type="hidden" name="expected_revision" value={achievement.revision} />
              <input type="hidden" name="return_to" value={returnTo} />
              <p className="text-sm text-[var(--color-text-secondary)]">{t(locale, "achievement.deleteRetained")}</p>
              <p className="text-sm text-[var(--color-text-secondary)]">{evidenceCount === null ? t(locale, "evidence.directDeleteCountUnavailable") : t(locale, "evidence.directDeleteCount", { count: evidenceCount })}</p>
              <ActionFeedback state={deleteState} locale={locale} returnTo={returnTo} />
            </form>
          </NamedDeleteDialog>
          </div>
        </div>
        {achievement.status === "confirmed" ? <p id="achievement-add-to-cv-help" className="field-help mt-2">{t(locale, "cv.addToCvHelp")}</p> : null}
      </header>

      <AchievementSourceCard locale={locale} achievement={achievement} activity={activity} detailReturn={detailReturn} />

      <Card>
        <div className="achievement-detail-context mb-4">
          <span>{t(locale, "achievement.project")}: {detail.projectTitle ?? t(locale, "achievement.noProject")}</span>
          <span>{t(locale, "achievement.experience")}: {detail.experienceLabel ?? t(locale, "achievement.noExperience")}</span>
          <span>{achievement.achieved_on ? `${t(locale, "achievement.date")}: ${formatActivityDate(achievement.achieved_on, locale)}` : t(locale, "achievement.dateNotSet")}</span>
          {skills.length ? <span>{t(locale, "achievement.skills")}: {skills.map((skill) => `${skill.name} (${skill.demonstratedCount})`).join(", ")}</span> : null}
        </div>
        {!achievement.activity_id ? <RelinkForm locale={locale} detail={detail} options={contextOptions} /> : null}
      </Card>

      <Card>
        <EvidenceAttachments
          locale={locale}
          parentKind="achievement"
          parentId={achievement.id}
          expectedParentRevision={achievement.revision}
          onItemCountChange={setEvidenceCount}
        />
      </Card>

      {aiSuggestion?.showAside ? (
        <AiSuggestionAside locale={locale} suggestion={aiSuggestion.suggestion} blockReason={aiSuggestion.blockReason} />
      ) : null}

      <AchievementForm
        locale={locale}
        ownerId={ownerId}
        contextOptions={contextOptions}
        returnTo={returnTo}
        achievement={achievement}
        detail={detail}
        suggestedSkills={aiSuggestion?.skills}
      />
    </section>
  );
}
