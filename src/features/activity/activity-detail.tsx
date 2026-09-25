"use client";

import Link from "next/link";
import { useState } from "react";

import { ActivityCaptureForm } from "@/features/activity/activity-capture-form";
import { ActionFeedback } from "@/components/forms/action-feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ActivityContextOptions } from "@/domain/activity/activity-display";
import { formatActivityDate, resolveActivityContext } from "@/domain/activity/activity-display";
import type { ActivityRow, ChatMessageRow } from "@/domain/activity/contracts";
import type { ActivityContextIssue } from "@/features/activity/activity-context-service";
import { NamedDeleteDialog } from "@/components/ui/named-delete-dialog";
import type { AchievementRow } from "@/domain/achievement/contracts";
import { deleteActivityAction } from "@/features/activity/actions";
import { IDLE_ACTION_STATE } from "@/server/action-result";
import { t, type Locale } from "@/i18n/messages";
import { useActionState } from "react";

function modeKey(mode: ActivityRow["capture_mode"]): "activity.noteMode" | "activity.formMode" | "activity.chatMode" {
  return mode === "note" ? "activity.noteMode" : mode === "form" ? "activity.formMode" : "activity.chatMode";
}

export function ActivityDetailClient({
  locale,
  ownerId,
  activity: initialActivity,
  chatMessages,
  achievement,
  options,
  contextIssue,
  returnTo,
}: {
  locale: Locale;
  ownerId: string;
  activity: ActivityRow;
  chatMessages: ChatMessageRow[];
  achievement?: AchievementRow | null;
  options: ActivityContextOptions;
  contextIssue?: ActivityContextIssue;
  returnTo: string;
}) {
  const [activity, setActivity] = useState(initialActivity);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleteState, deleteAction] = useActionState(deleteActivityAction, IDLE_ACTION_STATE);
  const linkedAchievement = achievement ?? null;
  const context = resolveActivityContext(activity, options);

  function saveRecord(record: ActivityRow) {
    setActivity(record);
    setEditing(false);
    setSaved(true);
  }

  if (editing) {
    return (
      <section className="space-y-6">
        <header className="workspace-page-header">
          <Link className="button-secondary mb-4" href={returnTo}>{t(locale, "activity.back")}</Link>
          <h1 className="text-3xl font-semibold tracking-tight">{t(locale, "activity.editHeading")}</h1>
        </header>
        <Card className="activity-capture-card">
          <ActivityCaptureForm
            locale={locale}
            ownerId={ownerId}
            defaultOccurredOn={activity.occurred_on}
            options={options}
            contextIssue={contextIssue}
            returnTo={returnTo}
            activity={activity}
            onSaved={saveRecord}
            onCancel={() => setEditing(false)}
          />
        </Card>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <header className="workspace-page-header">
        <Link className="button-secondary mb-4" href={returnTo}>{t(locale, "activity.back")}</Link>
        <div className="activity-detail-heading-row">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{t(locale, "activity.detailHeading")}</h1>
            <p>{t(locale, "activity.revision", { revision: activity.revision })}</p>
          </div>
          <Button onClick={() => { setSaved(false); setEditing(true); }}>{t(locale, "activity.edit")}</Button>
          <NamedDeleteDialog
            title={t(locale, "activity.deleteTitle")}
            description={t(locale, "activity.deleteDescription")}
            recordName={activity.raw_text.slice(0, 120)}
            triggerLabel={t(locale, "common.delete")}
            cancelLabel={t(locale, "common.cancel")}
            confirmLabel={t(locale, "common.delete")}
            formId={`delete-activity-${activity.id}`}
            successful={deleteState.status === "success"}
          >
            <form id={`delete-activity-${activity.id}`} action={deleteAction} className="mt-4 space-y-3">
              <input type="hidden" name="activity_id" value={activity.id} />
              <input type="hidden" name="expected_revision" value={activity.revision} />
              <input type="hidden" name="return_to" value={returnTo} />
              <ul className="space-y-2 text-sm text-[var(--color-text-secondary)]">
                <li>{t(locale, "activity.deleteChatRetained", { count: chatMessages.length })}</li>
                <li>{t(locale, "activity.deleteAchievementRetained", { count: linkedAchievement ? 1 : 0 })}</li>
                <li>{t(locale, "activity.deleteSourceRetained")}</li>
              </ul>
              <ActionFeedback state={deleteState} locale={locale} returnTo={returnTo} />
            </form>
          </NamedDeleteDialog>
        </div>
      </header>

      {saved ? <p className="ui-message ui-message--success" role="status">{t(locale, "activity.saved")}</p> : null}
      {contextIssue ? (
        <p className="ui-message ui-message--info" role="status" data-testid="activity-context-issue">
          {t(locale, contextIssue.messageKey)}{" "}
          <span data-testid="activity-context-reference">
            {t(locale, "activity.referenceId", { id: contextIssue.correlationId })}
          </span>
        </p>
      ) : null}

      <Card className="activity-detail-card">
        <div className="activity-detail-meta">
          <time dateTime={activity.occurred_on}>{formatActivityDate(activity.occurred_on, locale)}</time>
          <Badge>{t(locale, modeKey(activity.capture_mode))}</Badge>
          <Badge variant="success">{t(locale, "activity.savedBadge")}</Badge>
        </div>
        <section className="activity-detail-section" aria-labelledby="activity-current-text-heading">
          <h2 id="activity-current-text-heading" className="field-label">{t(locale, "activity.currentText")}</h2>
          <div className="activity-detail-source">{activity.raw_text}</div>
        </section>
        {(context.projectLabel || context.experienceLabel || context.projectUnavailable || context.experienceUnavailable) ? (
          <section className="activity-detail-section" aria-labelledby="activity-context-heading">
            <h2 id="activity-context-heading" className="field-label">{t(locale, "activity.contextDetails")}</h2>
            <div className="activity-list-context">
              {context.projectLabel ? <span>{t(locale, "activity.project")}: {context.projectLabel}</span> : null}
              {context.experienceLabel ? <span>{t(locale, "activity.experience")}: {context.experienceLabel}</span> : null}
              {context.projectUnavailable || context.experienceUnavailable ? (
                <span>{t(locale, "activity.contextUnavailable")}</span>
              ) : null}
            </div>
          </section>
        ) : null}
        {(activity.role || activity.scope || activity.outcome) ? (
          <section className="activity-detail-section" aria-labelledby="activity-structured-context-heading">
            <h2 id="activity-structured-context-heading" className="field-label">{t(locale, "activity.contextDetails")}</h2>
            {activity.role ? <p><strong>{t(locale, "activity.role")}:</strong> {activity.role}</p> : null}
            {activity.scope ? <p className="activity-detail-long-text"><strong>{t(locale, "activity.scope")}:</strong> {activity.scope}</p> : null}
            {activity.outcome ? <p className="activity-detail-long-text"><strong>{t(locale, "activity.outcome")}:</strong> {activity.outcome}</p> : null}
          </section>
        ) : null}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{t(locale, "activity.achievementSection")}</h2>
            <p className="field-help">{t(locale, "activity.achievementSectionHelp")}</p>
          </div>
          {linkedAchievement ? (
            <Link className="button-primary" href={`/achievements/${linkedAchievement.id}?${new URLSearchParams({ returnTo }).toString()}`}>
              {t(locale, "activity.openAchievement")}
            </Link>
          ) : (
            <Link className="button-primary" href={`/achievements/new?${new URLSearchParams({ activity: activity.id, returnTo }).toString()}`}>
              {t(locale, "activity.createAchievement")}
            </Link>
          )}
        </div>
        {linkedAchievement ? (
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            <span className="ui-badge">{t(locale, `achievement.${linkedAchievement.status}`)}</span>
            {linkedAchievement.title ? <span>{linkedAchievement.title}</span> : <span>{t(locale, "achievement.untitledDraft")}</span>}
          </div>
        ) : null}
      </Card>

      {activity.capture_mode === "chat" ? (
        <Card className="activity-chat-card">
          <h2 className="text-lg font-semibold">{t(locale, "activity.originalHistory")}</h2>
          <p className="field-help">{t(locale, "activity.chatHistoryNote")}</p>
          {chatMessages.length === 0 ? (
            <p className="field-help">{t(locale, "activity.noChatHistory")}</p>
          ) : (
            <ol className="activity-chat-history">
              {chatMessages.map((message) => (
                <li key={message.id}>
                  <span className="field-help">{t(locale, "activity.messageNumber", { sequence: message.sequence_no })}</span>
                  <div className="activity-detail-source">{message.content}</div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      ) : null}
    </section>
  );
}
