"use client";

import { useEffect, useState } from "react";
import { LoadingIndicator } from "@/components/ui/loading-indicator";
import { progressIntervalMs, progressStatusView, type ProgressKind, type ProgressStage } from "@/components/ui/progress-status-view";
import { t, type Locale, type MessageKey } from "@/i18n/messages";

type ProgressProps = { locale: Locale; kind: ProgressKind; stage: ProgressStage; label?: string; headingId?: string };

function stageKey(kind: ProgressKind, stage: ProgressStage): MessageKey {
  if (kind === "ai") return stage === "queued" ? "ai.analysis.queued" : "ai.analysis.running";
  if (kind === "export") return stage === "queued" ? "cv.export.status.queued" : "cv.export.status.running";
  return stage === "queued" ? "import.state.waiting" : "import.state.extracting";
}

export function ProgressStatusContent({ locale, kind, stage, label, headingId, view }: ProgressProps & { view: ReturnType<typeof progressStatusView> }) {
  const Status = headingId ? "h2" : "p";
  return (
    <div className="ui-progress-status" data-kind={kind} data-stage={stage}>
      <Status id={headingId} className="ui-progress-stage" role="status">
        {label ?? t(locale, stageKey(kind, stage))}
        <LoadingIndicator />
        {view.slow ? <span className="ui-progress-slow">{t(locale, "progress.slow")}</span> : null}
      </Status>
      {view.showElapsed ? <span className="field-help" aria-hidden="true">{t(locale, "progress.elapsed", { seconds: view.elapsedSeconds })}</span> : null}
    </div>
  );
}

export function ProgressStatus({ startedAt, ...props }: ProgressProps & { startedAt?: number }) {
  const [mountTime] = useState(() => startedAt ?? Date.now());
  const [now, setNow] = useState(mountTime);
  useEffect(() => {
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
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, []);
  return <ProgressStatusContent {...props} view={progressStatusView(now, startedAt ?? mountTime, props.kind, props.stage)} />;
}
