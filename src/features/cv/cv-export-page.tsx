"use client";

import { CircleAlert, CircleCheck, Clock3, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type RefObject } from "react";

import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/ui/inline-error";
import type { CvExportReadiness, CvExportRow, CvLocale } from "@/domain/cv/contracts";
import { isExportExpired } from "@/domain/cv/export";
import { blockerLink, exportActions, exportStatusView, type ExportAction, type ExportViewState } from "@/domain/cv/export-view";
import type { CvPreviewModel } from "@/domain/cv/preview";
import { t, type Locale, type MessageKey } from "@/i18n/messages";
import { IDLE_ACTION_STATE, type ActionState } from "@/server/action-result";

import { issueCvExportDownloadAction, requestCvExportAction, retryCvExportAction } from "./actions";
import {
  becameTerminal,
  blockerMessageKey,
  classifyExportResult,
  failureMessageKey,
  formatExportTime,
  isActiveExport,
  mergeExportRow,
  parseStatusResponse,
  pollingPlan,
  type ExportOutcome,
} from "./cv-export-page-state";
import { CvPdfPages } from "./cv-pdf-pages";
import { CvPreview } from "./cv-preview";

export interface CvExportPageProps {
  locale: Locale;
  /** The profile's IANA time zone: export times are shown in it. */
  timeZone: string;
  title: string;
  cvLocale: CvLocale;
  /** `cv_documents.revision` as read on the server: the one revision this page previews and exports. */
  savedRevision: number;
  model: CvPreviewModel;
  readiness: CvExportReadiness;
  /** The newest exports, newest first (at most five). */
  exports: CvExportRow[];
  /** Server time of this render, so expiry looks the same on the server and in the browser. */
  nowIso: string;
}

type Notice =
  | { kind: "info"; messageKey: MessageKey }
  | { kind: "stale" }
  | { kind: "error"; messageKey: MessageKey; correlationId?: string };

type RunAction = "export" | "regenerate" | "retry" | "download";

const BADGE: Record<ExportViewState, BadgeVariant> = {
  queued: "neutral", running: "neutral", succeeded: "success", failed: "danger", expired: "warning",
};

function StateIcon({ state }: { state: ExportViewState }) {
  const common = { size: 16, "aria-hidden": true } as const;
  switch (state) {
    case "queued": return <Clock3 {...common} />;
    case "running": return <LoaderCircle {...common} />;
    case "succeeded": return <CircleCheck {...common} />;
    default: return <CircleAlert {...common} />;
  }
}

function subscribeVisibility(callback: () => void) {
  document.addEventListener("visibilitychange", callback);
  return () => document.removeEventListener("visibilitychange", callback);
}
const isHidden = () => document.visibilityState === "hidden";
const neverHidden = () => false;

/** The browser saves the file by following the short-lived URL; the URL is not kept anywhere. */
function startDownload(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noopener";
  link.download = "";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
}

interface ActionButtonProps {
  locale: Locale;
  action: ExportAction;
  primary: boolean;
  /** Export and Regenerate cannot be requested now (the saved CV is blocked); the reason is shown beside them. */
  blocked: boolean;
  reasonId: string;
  pending: { action: RunAction; id: string | null } | null;
  latestId: string | null;
  onRun: (action: RunAction, exportId?: string) => void;
}

/** One action of the newest export. Export and Regenerate stay focusable when blocked, with the reason attached. */
function ActionButton({ locale, action, primary, blocked, reasonId, pending, latestId, onRun }: ActionButtonProps) {
  const variant = primary ? "primary" : "secondary";
  const text = t(locale, `cv.exportPage.action.${action}`);
  const working = t(locale, "cv.exportPage.action.working");
  switch (action) {
    case "export":
    case "regenerate":
      return (
        <Button
          variant={variant} data-testid={`cv-export-${action}`}
          aria-disabled={blocked || undefined} aria-describedby={blocked ? reasonId : undefined}
          loading={pending?.action === action} loadingLabel={working}
          onClick={() => { if (!blocked) onRun(action); }}
        >
          {text}
        </Button>
      );
    case "retry":
    case "download":
      return (
        <Button
          variant={variant} data-testid={`cv-export-${action}`}
          loading={pending?.action === action && pending.id === latestId} loadingLabel={working}
          onClick={() => { if (latestId) onRun(action, latestId); }}
        >
          {text}
        </Button>
      );
    case "openBuilder":
      return <Link href="/cv" className={primary ? "button-primary" : "button-secondary"} data-testid="cv-export-open-builder">{text}</Link>;
  }
}

/**
 * S14: the saved revision of the CV, what blocks its export, one explicit export action, the status of the job
 * (polled, announced), and, once a PDF exists, its real pages and the download. It never reads the S13 draft.
 */
export function CvExportPage(props: CvExportPageProps) {
  const { locale, timeZone, title, cvLocale, savedRevision, model } = props;
  const router = useRouter();
  const reasonId = useId();
  const blockersId = useId();
  const historyId = useId();

  const [rows, setRows] = useState(props.exports);
  const [readiness, setReadiness] = useState(props.readiness);
  const [now, setNow] = useState(() => new Date(props.nowIso));
  const [seen, setSeen] = useState({ exports: props.exports, readiness: props.readiness, nowIso: props.nowIso });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState<{ action: RunAction; id: string | null } | null>(null);
  const [tick, setTick] = useState(0);
  const [focusRequest, setFocusRequest] = useState<{ target: "status" | "notice"; count: number } | null>(null);
  const inFlight = useRef(false);
  const pollIndex = useRef(0);
  const rowsRef = useRef(rows);
  const statusRef = useRef<HTMLDivElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const hidden = useSyncExternalStore(subscribeVisibility, isHidden, neverHidden);

  // A fresh render from the server (after Reload or a finished export) is the truth: take it over.
  if (seen.exports !== props.exports || seen.readiness !== props.readiness || seen.nowIso !== props.nowIso) {
    setSeen({ exports: props.exports, readiness: props.readiness, nowIso: props.nowIso });
    setRows(props.exports);
    setReadiness(props.readiness);
    setNow(new Date(props.nowIso));
    if (notice?.kind === "stale") setNotice(null);
  }

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    if (focusRequest === null) return;
    (focusRequest.target === "status" ? statusRef : noticeRef).current?.focus();
  }, [focusRequest]);

  const latest = rows[0] ?? null;
  const view = latest ? exportStatusView(latest, now) : null;
  const actions = exportActions({ row: latest, savedRevision, readiness, now });
  const blocked = actions.disabledReason !== null;
  const pdfRow = rows.find((row) => row.status === "succeeded" && row.page_count !== null && !isExportExpired(row, now)) ?? null;
  const activeId = rows.find((row) => isActiveExport(row))?.id ?? null;

  /** One status request; the next one is scheduled by the effect below, also after a failed request. */
  const poll = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/cv/exports/${id}`, { cache: "no-store" });
      if (response.status === 401 || response.status === 404) {
        router.refresh();
        return;
      }
      if (!response.ok) return;
      const parsed = parseStatusResponse(await response.json());
      if (parsed === null) return;
      const before = rowsRef.current.find((row) => row.id === id) ?? null;
      setNow(new Date());
      setRows((current) => mergeExportRow(current, parsed.row));
      if (becameTerminal(before, parsed.row)) router.refresh();
    } catch {
      // Keep the last known state; the next poll tries again.
    } finally {
      setTick((value) => value + 1);
    }
  }, [router]);

  useEffect(() => {
    pollIndex.current = 0;
  }, [activeId]);

  useEffect(() => {
    const plan = pollingPlan({ activeId, hidden, pollIndex: pollIndex.current });
    if (plan === null || activeId === null) return;
    const timer = setTimeout(() => {
      pollIndex.current = plan.nextIndex;
      void poll(activeId);
    }, plan.delay);
    return () => clearTimeout(timer);
  }, [activeId, hidden, tick, poll]);

  // Focus moves after the render that shows its target, so the status or the notice exists when it is asked for.
  const focusSoon = (target: RefObject<HTMLElement | null>) => setFocusRequest((current) => ({ target: target === statusRef ? "status" : "notice", count: (current?.count ?? 0) + 1 }));

  const apply = (outcome: ExportOutcome) => {
    switch (outcome.kind) {
      case "started":
        setNotice(outcome.reused ? { kind: "info", messageKey: "cv.exportPage.status.reused" } : null);
        pollIndex.current = 0;
        void poll(outcome.exportId);
        focusSoon(statusRef);
        return;
      case "download":
        startDownload(outcome.url);
        setNotice({ kind: "info", messageKey: "cv.exportPage.notice.downloadStarted" });
        return;
      case "stale":
        setNotice({ kind: "stale" });
        focusSoon(noticeRef);
        return;
      case "inProgress":
        setNotice({ kind: "error", messageKey: "cv.export.error.inProgress" });
        router.refresh();
        focusSoon(noticeRef);
        return;
      case "blocked":
        setReadiness((current) => ({ ...current, ready: false, blockers: outcome.blockers.length > 0 ? outcome.blockers : current.blockers }));
        setNotice({ kind: "error", messageKey: "cv.export.error.blocked" });
        focusSoon(noticeRef);
        return;
      case "gone":
        setNotice({ kind: "error", messageKey: outcome.messageKey });
        router.refresh();
        focusSoon(noticeRef);
        return;
      case "signedOut":
        router.refresh();
        return;
      case "failed":
        setNotice({ kind: "error", messageKey: outcome.messageKey, correlationId: outcome.correlationId });
        focusSoon(noticeRef);
    }
  };

  const run = (action: RunAction, exportId?: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending({ action, id: exportId ?? null });
    setNotice(null);
    startTransition(async () => {
      let outcome: ExportOutcome;
      try {
        const form = new FormData();
        let state: ActionState;
        if (action === "retry") {
          form.set("export_id", exportId ?? "");
          state = await retryCvExportAction(IDLE_ACTION_STATE, form);
        } else if (action === "download") {
          form.set("export_id", exportId ?? "");
          state = await issueCvExportDownloadAction(IDLE_ACTION_STATE, form);
        } else {
          // A new key for every click; it lives until the answer arrives, so a double click never makes two jobs.
          form.set("expected_revision", String(savedRevision));
          form.set("idempotency_key", crypto.randomUUID());
          state = await requestCvExportAction(IDLE_ACTION_STATE, form);
        }
        outcome = classifyExportResult(state);
      } catch {
        outcome = { kind: "failed", messageKey: "error.unavailable", correlationId: crypto.randomUUID() };
      }
      apply(outcome);
      inFlight.current = false;
      setPending(null);
    });
  };

  const label = (action: ExportAction): string => t(locale, `cv.exportPage.action.${action}`);

  const actionProps = {
    locale, blocked, reasonId, pending, latestId: latest?.id ?? null, onRun: run,
  };

  return (
    <div className="cv-export-layout cv-export-page" data-testid="cv-export-page" data-saved-revision={savedRevision}>
      <div className="cv-export-main">
        <section className="cv-panel" aria-labelledby="cv-export-heading">
          <div className="cv-export-saved">
            <div className="cv-export-meta">
              <h2 id="cv-export-heading" className="cv-panel-heading" data-testid="cv-export-revision">
                {t(locale, "cv.exportPage.savedRevision", { revision: savedRevision })}
              </h2>
              <Badge variant="neutral" data-testid="cv-export-language">
                {t(locale, "cv.exportPage.cvLanguage", { language: t(locale, cvLocale === "id" ? "cv.lang.id" : "cv.lang.en") })}
              </Badge>
            </div>
            <Link href="/cv" className="button-secondary" data-testid="cv-export-back">{t(locale, "cv.exportPage.back")}</Link>
          </div>
          <p className="cv-export-title" data-testid="cv-export-title">{title}</p>

          {!readiness.ready ? (
            <section aria-labelledby={blockersId} className="cv-export-blockers-panel" data-testid="cv-export-blockers">
              <h3 id={blockersId} className="text-sm font-semibold">{t(locale, "cv.exportPage.blockers.heading")}</h3>
              <ul className="cv-export-blockers">
                {readiness.blockers.map((blocker, index) => (
                  <li key={`${blocker.code}-${blocker.item_id ?? index}`}>
                    <Link href={blockerLink(blocker)} data-testid="cv-export-blocker" data-code={blocker.code}>
                      {t(locale, blockerMessageKey(blocker.code))}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div
            ref={statusRef} tabIndex={-1} role="status" aria-live="polite" className="cv-export-status"
            data-testid="cv-export-status" data-state={view?.state ?? "none"}
          >
            <p className="text-sm font-semibold">{t(locale, "cv.exportPage.status.heading")}</p>
            {view && latest ? (
              <>
                <p className="cv-export-state">
                  <Badge variant={BADGE[view.state]}>
                    <StateIcon state={view.state} />
                    <span>{t(locale, view.messageKey)}</span>
                  </Badge>
                  <span className="field-help">{t(locale, "cv.exportPage.history.revision", { revision: latest.cv_revision })}</span>
                </p>
                {view.state === "failed" && latest.error_code ? (
                  <p className="text-sm" data-testid="cv-export-failure">{t(locale, failureMessageKey(latest.error_code))}</p>
                ) : null}
                {(view.state === "succeeded" || view.state === "expired") && latest.page_count !== null ? (
                  <p className="field-help">{t(locale, "cv.exportPage.status.pages", { count: latest.page_count })}</p>
                ) : null}
                {view.state === "succeeded" && latest.expires_at ? (
                  <p className="field-help">{t(locale, "cv.exportPage.status.availableUntil", { time: formatExportTime(latest.expires_at, locale, timeZone) })}</p>
                ) : null}
              </>
            ) : (
              <p className="field-help">{t(locale, "cv.exportPage.status.none")}</p>
            )}
          </div>

          <div className="cv-export-actions" data-testid="cv-export-actions">
            {actions.primary ? <ActionButton {...actionProps} action={actions.primary} primary /> : null}
            {actions.secondary.map((action) => <ActionButton key={action} {...actionProps} action={action} primary={false} />)}
          </div>
          {actions.disabledReason ? (
            <p id={reasonId} className="field-help" data-testid="cv-export-disabled-reason">{t(locale, actions.disabledReason)}</p>
          ) : null}

          {notice ? (
            <div ref={noticeRef} tabIndex={-1} className="cv-export-notice" data-testid="cv-export-notice" data-kind={notice.kind}>
              {notice.kind === "info" ? (
                <p className="ui-message" role="status">{t(locale, notice.messageKey)}</p>
              ) : (
                <InlineError correlationId={notice.kind === "error" ? notice.correlationId : undefined}>
                  <p>{notice.kind === "stale" ? t(locale, "cv.exportPage.notice.stale") : t(locale, notice.messageKey)}</p>
                  {notice.kind === "stale" ? (
                    <Button variant="secondary" data-testid="cv-export-reload" onClick={() => router.refresh()}>
                      {t(locale, "cv.exportPage.notice.reload")}
                    </Button>
                  ) : null}
                </InlineError>
              )}
            </div>
          ) : null}
        </section>

        {rows.length > 0 ? (
          <section className="cv-panel" aria-labelledby={historyId} data-testid="cv-export-history">
            <h2 id={historyId} className="cv-panel-heading">{t(locale, "cv.exportPage.history.heading")}</h2>
            <ul className="cv-export-history">
              {rows.map((row) => {
                const rowView = exportStatusView(row, now);
                const rowActions = exportActions({ row, savedRevision, readiness, now });
                const offered = [rowActions.primary, ...rowActions.secondary].filter((action): action is "download" | "retry" => action === "download" || action === "retry");
                const stamp = row.finished_at ?? row.created_at;
                return (
                  <li key={row.id} className="cv-export-row" data-testid="cv-export-row" data-status={rowView.state} data-revision={row.cv_revision}>
                    <div className="cv-export-row-text">
                      <p className="cv-export-row-title">
                        <span>{t(locale, "cv.exportPage.history.revision", { revision: row.cv_revision })}</span>
                        {row.cv_revision !== savedRevision ? <Badge variant="warning">{t(locale, "cv.exportPage.history.earlier")}</Badge> : null}
                        <Badge variant={BADGE[rowView.state]}>{t(locale, rowView.messageKey)}</Badge>
                      </p>
                      <p className="field-help">
                        <time dateTime={stamp} suppressHydrationWarning>{formatExportTime(stamp, locale, timeZone)}</time>
                        {row.page_count !== null ? ` · ${t(locale, "cv.exportPage.status.pages", { count: row.page_count })}` : ""}
                      </p>
                    </div>
                    {offered.length > 0 ? (
                      <div className="cv-export-row-actions">
                        {offered.map((action) => (
                          <Button
                            key={action} variant="secondary" data-testid={`cv-export-row-${action}`}
                            aria-label={`${label(action)}, ${t(locale, "cv.exportPage.history.revision", { revision: row.cv_revision })}`}
                            loading={pending?.action === action && pending.id === row.id}
                            loadingLabel={t(locale, "cv.exportPage.action.working")}
                            onClick={() => run(action, row.id)}
                          >
                            {label(action)}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>

      <div className="cv-preview-column cv-export-preview">
        {pdfRow && pdfRow.page_count !== null ? (
          <CvPdfPages
            key={pdfRow.id} locale={locale} exportId={pdfRow.id} pageCount={pdfRow.page_count}
            revision={pdfRow.cv_revision} savedRevision={savedRevision}
          />
        ) : null}
        <CvPreview model={model} locale={locale} dirty={false} />
      </div>
    </div>
  );
}
