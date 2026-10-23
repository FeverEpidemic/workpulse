"use client";

import { useEffect, useState, type ReactNode } from "react";
import { LoadingIndicator } from "@/components/ui/loading-indicator";
import { progressIntervalMs, progressStatusView, type ProgressKind, type ProgressStage } from "@/components/ui/progress-status-view";
import { t, type Locale, type MessageKey } from "@/i18n/messages";

type ProgressProps = { locale: Locale; kind: ProgressKind; stage: ProgressStage; label?: string; headingId?: string; renderStatus?: (stage: ReactNode) => ReactNode };

function stageKey(kind: ProgressKind, stage: ProgressStage): MessageKey {
  if (kind === "ai") return stage === "queued" ? "ai.analysis.queued" : "ai.analysis.running";
  if (kind === "export") return stage === "queued" ? "cv.export.status.queued" : "cv.export.status.running";
  return stage === "queued" ? "import.state.waiting" : "import.state.extracting";
}

export function ProgressStatusContent({ locale, kind, stage, label, headingId, renderStatus, view, active = true }: ProgressProps & { view: ReturnType<typeof progressStatusView>; active?: boolean }) {
  const Status = headingId ? "h2" : "p";
  const status = <Status id={headingId} className="ui-progress-stage" role={renderStatus ? undefined : "status"}>
    {label ?? t(locale, stageKey(kind, stage))}
    <LoadingIndicator />
    {view.slow ? <span className="ui-progress-slow">{t(locale, "progress.slow")}</span> : null}
  </Status>;
  return (
    <div className="ui-progress-status" data-kind={kind} data-stage={stage}>
      {renderStatus ? renderStatus(active ? status : null) : active ? status : null}
      {active && view.showElapsed ? <span className="field-help" aria-hidden="true">{t(locale, "progress.elapsed", { seconds: view.elapsedSeconds })}</span> : null}
    </div>
  );
}

export function ProgressStatus({ startedAt, active = true, clockKey = "", ...props }: ProgressProps & { startedAt?: number; active?: boolean; clockKey?: string }) {
  const key = `${props.kind}:${clockKey}:${active}:${startedAt ?? ""}`;
  const [clock, setClock] = useState(() => ({ key, startedAt: startedAt ?? Date.now() }));
  const [now, setNow] = useState(clock.startedAt);
  useEffect(() => {
    const start = startedAt ?? Date.now();
    const initial = setTimeout(() => { setClock({ key, startedAt: start }); setNow(start); }, 0);
    if (!active) return () => clearTimeout(initial);
    let mounted = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    function schedule() {
      clearInterval(timer);
      const interval = progressIntervalMs(!document.hidden, mounted);
      if (interval !== null) timer = setInterval(() => setNow(Date.now()), interval);
    }
    function visibilityChanged() {
      if (!document.hidden) setNow(Date.now());
      schedule();
    }
    schedule();
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      mounted = false;
      clearTimeout(initial);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [active, key, startedAt]);
  const view = clock.key === key ? progressStatusView(now, clock.startedAt, props.kind, props.stage) : progressStatusView(0, 0, props.kind, props.stage);
  return <ProgressStatusContent {...props} active={active} view={view} />;
}
