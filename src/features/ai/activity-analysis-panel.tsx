"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { useFormStatus } from "react-dom";

import { ActionFeedback } from "@/components/forms/action-feedback";
import { AiConsentDialog } from "@/components/ui/ai-consent-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/field-control";
import { InlineError } from "@/components/ui/inline-error";
import { RevisionConflict } from "@/components/ui/revision-conflict";
import type { AnalysisViewPayload } from "@/features/ai/ai-review-service";
import type { ApplyBlockReason } from "@/domain/ai/analysis-view";
import type { DetectResult } from "@/domain/ai/detect-result";
import {
  answerQuestionsAction,
  applySuggestionAction,
  dismissSuggestionAction,
  requestAnalysisAction,
  retryAnalysisAction,
  setAiConsentAction,
  skipQuestionsAction,
} from "@/features/ai/actions";
import { EVIDENCE_POLL_DELAYS } from "@/features/evidence/evidence-attachments";
import { IDLE_ACTION_STATE, type ActionState } from "@/server/action-result";
import { t, type Locale, type MessageKey } from "@/i18n/messages";

export type AnalysisPanelConsent = { granted: boolean; profileRevision: number };

export type ActivityAnalysisPanelProps = {
  locale: Locale;
  activityId: string;
  activityRevision: number;
  rawText: string;
  consent: AnalysisPanelConsent;
  returnTo: string;
  initialPayload?: AnalysisViewPayload | null;
};

const FAILURE_KEYS: Record<string, MessageKey> = {
  AI_TIMEOUT: "ai.analysis.failed.timeout",
  AI_PROVIDER_TIMEOUT: "ai.analysis.failed.timeout",
  AI_PROVIDER_UNAVAILABLE: "ai.analysis.failed.unavailable",
  AI_UNAVAILABLE: "ai.analysis.failed.unavailable",
  AI_CONFIG_INVALID: "ai.analysis.failed.unavailable",
  AI_RATE_LIMITED: "ai.analysis.failed.rateLimited",
  AI_REFUSED: "ai.analysis.failed.refused",
  AI_OUTPUT_INVALID: "ai.analysis.failed.invalid",
};

const BLOCK_KEYS: Record<ApplyBlockReason, MessageKey | null> = {
  ACHIEVEMENT_CONFIRMED: "error.achievementConfirmed",
  ACHIEVEMENT_DISMISSED: "error.achievementDismissed",
  DRAFT_EDITED: "error.draftEdited",
  AI_SUGGESTION_DISMISSED: null,
  CONSENT_REQUIRED: "error.consentRequired",
};

const ANSWER_LIMITS = { role: 200, scope: 5000, outcome: 5000 } as const;

function SubmitButton({
  children,
  variant = "primary",
  disabled = false,
  loadingLabel,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  disabled?: boolean;
  loadingLabel: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={disabled} loading={pending} loadingLabel={loadingLabel}>
      {children}
    </Button>
  );
}

/** Failure or conflict result of one AI action. A conflict offers reload without touching local input. */
function ActionResult({ state, locale, returnTo, onReload }: {
  state: ActionState;
  locale: Locale;
  returnTo: string;
  onReload: () => void;
}) {
  if (state.status === "error" && state.error.code === "CONFLICT") {
    return (
      <RevisionConflict title={t(locale, "ai.analysis.conflictTitle")} labelledBy="ai-analysis-conflict-title">
        <p>{t(locale, state.error.messageKey)}</p>
        <Button variant="secondary" onClick={onReload}>{t(locale, "ai.analysis.reload")}</Button>
      </RevisionConflict>
    );
  }
  return <ActionFeedback state={state} locale={locale} returnTo={returnTo} />;
}

/** One AI review action as its own form so each keeps its own pending and result state. */
function ActionForm({
  action,
  fields,
  locale,
  returnTo,
  onSuccess,
  onReload,
  className,
  children,
}: {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  fields: Record<string, string | number>;
  locale: Locale;
  returnTo: string;
  onSuccess?: (state: Extract<ActionState, { status: "success" }>) => void;
  onReload: () => void;
  className?: string;
  children: ReactNode;
}) {
  const [state, formAction] = useActionState(action, IDLE_ACTION_STATE);
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (state.status !== "success" || handled.current === state.correlationId) return;
    handled.current = state.correlationId;
    onSuccess?.(state);
  }, [state, onSuccess]);

  return (
    <form action={formAction} className={className}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} readOnly />
      ))}
      {children}
      <ActionResult state={state} locale={locale} returnTo={returnTo} onReload={onReload} />
    </form>
  );
}

function ResultFields({ locale, suggestion }: { locale: Locale; suggestion: NonNullable<DetectResult["suggestion"]> }) {
  const rows: Array<[MessageKey, string | null]> = [
    ["ai.analysis.field.title", suggestion.title],
    ["ai.analysis.field.contribution", suggestion.contribution],
    ["ai.analysis.field.outcome", suggestion.outcome],
    ["ai.analysis.field.role", suggestion.role],
    ["ai.analysis.field.scope", suggestion.scope],
    ["ai.analysis.field.cvBullet", suggestion.cv_bullet],
  ];
  return (
    <dl className="ai-analysis-fields">
      {rows.filter((row): row is [MessageKey, string] => row[1] !== null).map(([key, value]) => (
        <div key={key} className="ai-analysis-field">
          <dt className="field-label">{t(locale, key)}</dt>
          <dd>{value}</dd>
        </div>
      ))}
      {suggestion.metrics.length > 0 ? (
        <div className="ai-analysis-field">
          <dt className="field-label">{t(locale, "ai.analysis.field.metrics")}</dt>
          <dd>
            <ul className="ai-analysis-list">
              {suggestion.metrics.map((metric) => (
                <li key={`${metric.label}-${metric.value}-${metric.unit}`}>
                  {metric.label}: {metric.value} {metric.unit}
                  {metric.baseline !== null ? ` (${t(locale, "ai.analysis.metricBaseline", { baseline: metric.baseline })})` : ""}
                </li>
              ))}
            </ul>
          </dd>
        </div>
      ) : null}
      {suggestion.skills.length > 0 ? (
        <div className="ai-analysis-field">
          <dt className="field-label">{t(locale, "ai.analysis.field.skills")}</dt>
          <dd className="ai-analysis-skills">
            {suggestion.skills.map((skill) => <Badge key={skill}>{skill}</Badge>)}
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

/** S06 AI analysis panel: request, follow the job, then review, answer, dismiss or open the draft. */
export function ActivityAnalysisPanel({
  locale,
  activityId,
  activityRevision,
  rawText,
  consent,
  returnTo,
  initialPayload = null,
}: ActivityAnalysisPanelProps) {
  const router = useRouter();
  const [payload, setPayload] = useState<AnalysisViewPayload | null>(initialPayload);
  const [loadFailed, setLoadFailed] = useState(false);
  const [dialogOpenRaw, setDialogOpen] = useState(false);
  const [deferred, setDeferred] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [requestState, requestAction] = useActionState(requestAnalysisAction, IDLE_ACTION_STATE);
  const [consentState, consentAction] = useActionState(setAiConsentAction, IDLE_ACTION_STATE);
  const consentRevision = (consentState.status === "success" ? (consentState.data as { revision?: number } | undefined)?.revision : undefined);
  const granted = consent.granted || consentState.status === "success";
  const profileRevision = typeof consentRevision === "number" ? consentRevision : consent.profileRevision;
  const dialogOpen = dialogOpenRaw && consentState.status !== "success";
  const mounted = useRef(false);
  const loading = useRef(false);
  const pollIndex = useRef(0);
  const handledRequest = useRef<string | null>(null);
  const handledConsent = useRef<string | null>(null);
  const reviewButton = useRef<HTMLButtonElement>(null);
  const focusReview = useRef(false);

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const response = await fetch(`/api/ai/activities/${activityId}/analysis`, { cache: "no-store" });
      if (!response.ok) throw new Error("analysis status unavailable");
      const next = (await response.json()) as AnalysisViewPayload;
      if (!mounted.current) return;
      setPayload(next);
      setLoadFailed(false);
    } catch {
      if (mounted.current) setLoadFailed(true);
    } finally {
      loading.current = false;
    }
  }, [activityId]);

  const reload = useCallback(() => {
    pollIndex.current = 0;
    router.refresh();
    void load();
  }, [load, router]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (payload !== null && payload.activityRevision === activityRevision) return;
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [activityRevision, load, payload]);

  const state = payload?.view.state ?? null;
  const polling = payload !== null && payload.activityRevision === activityRevision && (state === "queued" || state === "running");
  useEffect(() => {
    if (!polling) {
      pollIndex.current = 0;
      return;
    }
    const delay = EVIDENCE_POLL_DELAYS[Math.min(pollIndex.current, EVIDENCE_POLL_DELAYS.length - 1)];
    const timer = window.setTimeout(() => {
      pollIndex.current += 1;
      if (document.visibilityState !== "hidden") void load();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [polling, load, payload]);

  useEffect(() => {
    if (requestState.status !== "success" || handledRequest.current === requestState.correlationId) return;
    handledRequest.current = requestState.correlationId;
    pollIndex.current = 0;
    void load();
  }, [requestState, load]);

  useEffect(() => {
    if (consentState.status !== "success" || handledConsent.current === consentState.correlationId) return;
    handledConsent.current = consentState.correlationId;
    const form = new FormData();
    form.set("activity_id", activityId);
    form.set("expected_revision", String(activityRevision));
    startTransition(() => requestAction(form));
  }, [consentState, activityId, activityRevision, requestAction]);

  useEffect(() => {
    if (!deferred || !focusReview.current) return;
    focusReview.current = false;
    reviewButton.current?.focus();
  }, [deferred]);

  const view = payload?.view ?? null;
  const job = payload?.job ?? null;
  const achievement = payload?.achievement ?? null;
  const detect = job?.result ?? null;
  const suggestion = detect?.suggestion ?? null;
  const manualHref = `/achievements/new?${new URLSearchParams({ activity: activityId, returnTo }).toString()}`;
  const achievementHref = achievement ? `/achievements/${achievement.id}?${new URLSearchParams({ returnTo }).toString()}` : null;

  const analyzeControl = granted ? (
    <form action={requestAction} className="ai-analysis-actions">
      <input type="hidden" name="activity_id" value={activityId} readOnly />
      <input type="hidden" name="expected_revision" value={activityRevision} readOnly />
      <SubmitButton variant={state === "stale" ? "primary" : "secondary"} loadingLabel={t(locale, "ai.analysis.queued")}>
        {t(locale, state === "stale" ? "ai.analysis.analyzeAgain" : "ai.analysis.analyze")}
      </SubmitButton>
      <ActionResult state={requestState} locale={locale} returnTo={returnTo} onReload={reload} />
    </form>
  ) : (
    <div className="ai-analysis-actions">
      <Button variant={state === "stale" ? "primary" : "secondary"} onClick={() => setDialogOpen(true)}>
        {t(locale, state === "stale" ? "ai.analysis.analyzeAgain" : "ai.analysis.analyze")}
      </Button>
    </div>
  );

  function renderBody(): ReactNode {
    if (view === null || payload === null || payload.activityRevision !== activityRevision) {
      return loadFailed ? (
        <div className="space-y-2">
          <InlineError>{t(locale, "ai.analysis.loadFailed")}</InlineError>
          <Button variant="secondary" onClick={() => void load()}>{t(locale, "common.retry")}</Button>
        </div>
      ) : (
        <p role="status" className="field-help">{t(locale, "ai.analysis.loading")}</p>
      );
    }

    switch (view.state) {
      case "none":
        return analyzeControl;
      case "stale":
        return (
          <div className="space-y-3">
            <p role="status">{t(locale, "ai.analysis.stale")}</p>
            {analyzeControl}
          </div>
        );
      case "queued":
      case "running":
        return (
          <div className="ai-analysis-progress">
            <p role="status" className="ai-analysis-progress-title">
              {t(locale, view.state === "queued" ? "ai.analysis.queued" : "ai.analysis.running")}
            </p>
            <p className="field-help">{t(locale, "ai.analysis.progressHelp")}</p>
          </div>
        );
      case "failed": {
        const errorKey = job?.errorCode ? FAILURE_KEYS[job.errorCode] : undefined;
        const exhausted = !view.canRetry && (job?.attemptCount ?? 0) >= 3;
        const reasonKey: MessageKey | null = view.canRetry ? null : exhausted ? "error.aiRetryExhausted" : !granted ? "error.consentRequired" : null;
        return (
          <div className="space-y-3">
            <div role="status" className="space-y-1">
              <p className="ai-analysis-progress-title">{t(locale, "ai.analysis.failedTitle")}</p>
              <p>{t(locale, errorKey ?? "ai.analysis.failed.generic")}</p>
              {reasonKey ? <p className="field-help">{t(locale, reasonKey)}</p> : null}
            </div>
            <div className="ai-analysis-actions">
              {job ? (
                <ActionForm
                  action={retryAnalysisAction}
                  fields={{ activity_id: activityId, job_id: job.id }}
                  locale={locale}
                  returnTo={returnTo}
                  onSuccess={() => { pollIndex.current = 0; void load(); }}
                  onReload={reload}
                >
                  <SubmitButton variant="secondary" disabled={!view.canRetry} loadingLabel={t(locale, "ai.analysis.queued")}>
                    {t(locale, "ai.analysis.retry")}
                  </SubmitButton>
                </ActionForm>
              ) : null}
              <Link className="button-secondary" href={manualHref}>{t(locale, "ai.analysis.createManually")}</Link>
            </div>
            <div className="ai-analysis-source">
              <h3 className="field-label">{t(locale, "ai.analysis.yourNote")}</h3>
              <div className="activity-detail-source">{rawText}</div>
            </div>
          </div>
        );
      }
      case "no_potential":
        return <p role="status">{t(locale, "ai.analysis.noPotential")}</p>;
      case "suppressed":
        return (
          <div className="space-y-2">
            <p role="status">{t(locale, "ai.analysis.suppressed")}</p>
            {achievementHref ? <Link className="button-secondary" href={achievementHref}>{t(locale, "activity.openAchievement")}</Link> : null}
          </div>
        );
      case "applied":
        return (
          <div className="space-y-2">
            <p role="status">{t(locale, "ai.analysis.applied")}</p>
            {achievementHref ? <Link className="button-primary" href={achievementHref}>{t(locale, "activity.openAchievement")}</Link> : null}
          </div>
        );
      case "suggestion":
        return suggestion && job ? renderSuggestion(view, job.id, suggestion) : null;
      default:
        return null;
    }
  }

  function renderSuggestion(
    current: NonNullable<typeof view>,
    jobId: string,
    result: NonNullable<DetectResult["suggestion"]>,
  ): ReactNode {
    const questions = deferred ? [] : current.visibleQuestions;
    const blockKey = current.applyBlockReason ? BLOCK_KEYS[current.applyBlockReason] : null;
    const hasAnswer = questions.some((question) => (answers[question.field] ?? "").trim() !== "");
    return (
      <div className="space-y-4">
        <div className="ai-analysis-compare">
          <section className="ai-analysis-source" aria-labelledby="ai-analysis-note-heading">
            <h3 id="ai-analysis-note-heading" className="field-label">{t(locale, "ai.analysis.yourNote")}</h3>
            <div className="activity-detail-source">{rawText}</div>
          </section>
          <section className="ai-analysis-suggestion" aria-labelledby="ai-analysis-wording-heading">
            <h3 id="ai-analysis-wording-heading" className="field-label">{t(locale, "ai.analysis.suggestedWording")}</h3>
            <p className="field-help">{t(locale, "ai.analysis.suggestionNotice")}</p>
            <ResultFields locale={locale} suggestion={result} />
          </section>
        </div>

        {questions.length > 0 ? (
          <section className="ai-analysis-questions" aria-labelledby="ai-analysis-questions-heading">
            <h3 id="ai-analysis-questions-heading" className="font-semibold">{t(locale, "ai.analysis.questionsTitle")}</h3>
            <p className="field-help">{t(locale, "ai.analysis.questionsHelp")}</p>
            <ActionForm
              action={answerQuestionsAction}
              fields={{ activity_id: activityId, job_id: jobId, expected_revision: activityRevision }}
              locale={locale}
              returnTo={returnTo}
              onSuccess={() => { setAnswers({}); reload(); }}
              onReload={reload}
              className="space-y-3"
            >
              {questions.map((question) => {
                const inputId = `ai-answer-${question.field}`;
                return (
                  <div key={question.field} className="space-y-1">
                    <label className="field-label" htmlFor={inputId}>{question.text}</label>
                    {question.field === "role" ? (
                      <Input
                        id={inputId}
                        name={`answer_${question.field}`}
                        value={answers[question.field] ?? ""}
                        maxLength={ANSWER_LIMITS.role}
                        onChange={(event) => setAnswers((current) => ({ ...current, [question.field]: event.target.value }))}
                      />
                    ) : (
                      <Textarea
                        id={inputId}
                        name={`answer_${question.field}`}
                        rows={3}
                        value={answers[question.field] ?? ""}
                        maxLength={ANSWER_LIMITS[question.field]}
                        onChange={(event) => setAnswers((current) => ({ ...current, [question.field]: event.target.value }))}
                      />
                    )}
                  </div>
                );
              })}
              <div className="ai-analysis-actions">
                <SubmitButton variant="secondary" disabled={!hasAnswer} loadingLabel={t(locale, "common.loading")}>
                  {t(locale, "ai.analysis.answer")}
                </SubmitButton>
                <Button
                  variant="ghost"
                  onClick={() => { focusReview.current = true; setDeferred(true); }}
                >
                  {t(locale, "ai.analysis.saveForLater")}
                </Button>
              </div>
            </ActionForm>
            <ActionForm
              action={skipQuestionsAction}
              fields={{ activity_id: activityId, job_id: jobId }}
              locale={locale}
              returnTo={returnTo}
              onSuccess={() => { void load(); }}
              onReload={reload}
            >
              <SubmitButton variant="ghost" loadingLabel={t(locale, "common.loading")}>
                {t(locale, "ai.analysis.skipQuestions")}
              </SubmitButton>
            </ActionForm>
          </section>
        ) : null}

        {blockKey && !current.canApply ? <p className="field-help" role="status">{t(locale, blockKey)}</p> : null}

        <div className="ai-analysis-actions">
          {achievementHref ? (
            <Link className={current.canApply ? "button-secondary" : "button-primary"} href={achievementHref}>
              {t(locale, "activity.openAchievement")}
            </Link>
          ) : null}
          {current.canApply ? (
            <ActionForm
              action={applySuggestionAction}
              fields={{
                activity_id: activityId,
                job_id: jobId,
                expected_activity_revision: activityRevision,
                expected_achievement_revision: achievement?.revision ?? "",
              }}
              locale={locale}
              returnTo={returnTo}
              onSuccess={(success) => {
                const data = success.data as { achievementId?: string } | undefined;
                if (data?.achievementId) {
                  router.push(`/achievements/${data.achievementId}?${new URLSearchParams({ returnTo }).toString()}`);
                } else {
                  reload();
                }
              }}
              onReload={reload}
            >
              <ApplyButton
                buttonRef={reviewButton}
                variant={achievementHref ? "secondary" : "primary"}
                label={t(locale, "ai.analysis.reviewAsDraft")}
                loadingLabel={t(locale, "common.loading")}
              />
            </ActionForm>
          ) : null}
          {current.applyBlockReason !== "AI_SUGGESTION_DISMISSED" ? (
            <ActionForm
              action={dismissSuggestionAction}
              fields={{ activity_id: activityId, job_id: jobId }}
              locale={locale}
              returnTo={returnTo}
              onSuccess={() => { void load(); }}
              onReload={reload}
            >
              <SubmitButton variant="ghost" loadingLabel={t(locale, "common.loading")}>
                {t(locale, "ai.analysis.dismiss")}
              </SubmitButton>
            </ActionForm>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <Card className="ai-analysis" aria-labelledby="ai-analysis-title" data-testid="ai-analysis-panel">
      <div className="ai-analysis-header">
        <h2 id="ai-analysis-title" className="text-lg font-semibold">{t(locale, "ai.analysis.title")}</h2>
        <Badge>{t(locale, "ai.label")}</Badge>
      </div>
      <p className="field-help">{t(locale, "ai.analysis.intro")}</p>
      <div className="ai-analysis-body">{renderBody()}</div>

      <form action={consentAction}>
        <input type="hidden" name="expected_revision" value={profileRevision} readOnly />
        <AiConsentDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          locale={locale}
          allowControl={<AllowSubmit locale={locale} />}
        />
        <ActionResult state={consentState} locale={locale} returnTo={returnTo} onReload={reload} />
      </form>
    </Card>
  );
}

function ApplyButton({
  buttonRef,
  variant,
  label,
  loadingLabel,
}: {
  buttonRef: RefObject<HTMLButtonElement | null>;
  variant: "primary" | "secondary";
  label: string;
  loadingLabel: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      ref={buttonRef}
      type="submit"
      className={variant === "primary" ? "button-primary" : "button-secondary"}
      disabled={pending}
      aria-busy={pending || undefined}
    >
      {pending ? loadingLabel : label}
    </button>
  );
}

function AllowSubmit({ locale }: { locale: Locale }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" name="consent" value="allow" loading={pending} loadingLabel={t(locale, "common.loading")}>
      {t(locale, "ai.consent.dialogAllow")}
    </Button>
  );
}
