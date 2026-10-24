"use client";

import Link from "next/link";
import { FileUp } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import type { DragEvent, KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ProgressStatus } from "@/components/ui/progress-status";
import type { AiUsageWindow } from "@/domain/ai/usage";
import { IMPORT_ENTITY_TYPES, IMPORT_MAX_BYTES, type ImportExtractionMode } from "@/domain/import/contracts";
import { withConsentWithdrawn, type ImportView } from "@/domain/import/import-view";
import { setAiConsentAction } from "@/features/ai/actions";
import { AiLimitNotice, isAiLimited } from "@/features/ai/ai-limit-notice";
import { EVIDENCE_POLL_DELAYS } from "@/features/evidence/evidence-attachments";
import { t, type Locale, type MessageKey } from "@/i18n/messages";
import { IDLE_ACTION_STATE, type ActionState } from "@/server/action-result";

import { cancelImportAction, retryImportAction } from "./actions";
import { ImportModeDialog } from "./import-mode-dialog";

const MANUAL_HREF = "/settings/profile?mode=onboarding";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const ACCEPT = ".pdf,.docx,application/pdf," + DOCX_MIME;

const FAILURE_KEYS = new Set([
  "FILE_EMPTY", "FILE_TOO_LARGE", "FILE_TYPE_MISMATCH", "UNSUPPORTED_FORMAT", "ENCRYPTED_FILE", "SCANNED_PDF",
  "CORRUPT_FILE", "EMPTY_DOCUMENT", "TOO_MANY_PAGES", "IMPORT_TEXT_TOO_LONG", "PARSER_TIMEOUT", "MALWARE_DETECTED",
  "UPLOAD_INCOMPLETE", "SCANNER_UNAVAILABLE", "STORAGE_UNAVAILABLE", "PAGE_COUNT_UNAVAILABLE", "IMPORT_WORKER_TIMEOUT",
  // CONSENT_REQUIRED: refused before the text was sent. CONSENT_WITHDRAWN: the provider already
  // received the text and the result was discarded, so its copy must not claim otherwise.
  "CONSENT_REQUIRED", "CONSENT_WITHDRAWN",
  // T26: the rule extractor failed; permanent, so no retry.
  "IMPORT_RULES_FAILED",
]);

/** Localized reason for a batch failure code; AI outages share one message. */
export function importFailureKey(code: string | null): MessageKey {
  if (code && FAILURE_KEYS.has(code)) return `import.failed.${code}` as MessageKey;
  if (code?.startsWith("AI_")) return "import.failed.AI";
  return "import.failed.GENERIC";
}

const PROGRESS_KEYS: Partial<Record<ImportView["state"], MessageKey>> = {
  uploading: "import.uploading",
  waiting: "import.state.waiting",
  screening: "import.state.screening",
  parsing: "import.state.parsing",
  extracting: "import.state.extracting",
};

/** Headers of the S02 upload request; the server treats a missing mode as ai. */
export function importUploadHeaders(mime: string, key: string, name: string, mode: ImportExtractionMode): Record<string, string> {
  return { "content-type": mime, "x-idempotency-key": key, "x-file-name": encodeURIComponent(name), "x-extraction-mode": mode };
}

/**
 * T26/T28: what a choice in the mode dialog does. Use AI saves consent first when there is none; Read without AI
 * withdraws consent first when there is one (only after the user confirmed that). The upload runs only if the consent
 * step worked. Returns the consent error to show in the dialog, or null.
 */
export async function chooseImportMode(
  mode: ImportExtractionMode,
  granted: boolean,
  steps: {
    saveConsent: () => Promise<string | null>;
    withdrawConsent: () => Promise<string | null>;
    upload: (mode: ImportExtractionMode) => Promise<void>;
  },
): Promise<string | null> {
  const consentStep = mode === "ai" && !granted ? steps.saveConsent : mode === "rules" && granted ? steps.withdrawConsent : null;
  if (consentStep) {
    const consentError = await consentStep();
    if (consentError !== null) return consentError;
  }
  await steps.upload(mode);
  return null;
}

function mimeFor(file: File): string {
  if (file.type === "application/pdf" || file.type === DOCX_MIME) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".docx")) return DOCX_MIME;
  return file.type || "application/octet-stream";
}

export type ImportStartProps = {
  locale: Locale;
  initialView: ImportView;
  consent: { granted: boolean; profileRevision: number };
  /** A returning user (onboarding finished) starts manually in the profile editor, not in onboarding mode. */
  onboarded?: boolean;
  /** Import AI units at page load; the upload and retry RPCs enforce the limit regardless. */
  usage?: AiUsageWindow | null;
  /** Profile IANA timezone for the AI limit reset time. */
  timeZone?: string;
};

export function ImportStart({ locale, initialView, consent, onboarded = false, usage = null, timeZone }: ImportStartProps) {
  const [view, setView] = useState<ImportView>(initialView);
  const [choosing, setChoosing] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploadKey, setUploadKey] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const [modeStep, setModeStep] = useState<"choose" | "confirm">("choose");
  const [modePending, setModePending] = useState<ImportExtractionMode | null>(null);
  const [modeError, setModeError] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [granted, setGranted] = useState(consent.granted);
  /** The latest profile revision: a consent change bumps it, so the next change in this page must send the new one. */
  const [profileRevision, setProfileRevision] = useState(consent.profileRevision);
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const dropzone = useRef<HTMLDivElement>(null);
  const cancelTrigger = useRef<HTMLButtonElement>(null);
  const statusSection = useRef<HTMLElement>(null);
  const pollIndex = useRef(0);
  /** The choice in flight; cleared when the dialog is cancelled so a late consent save never uploads. */
  const modeChoice = useRef<ImportExtractionMode | null>(null);
  const constraintsId = useId();
  const statusId = useId();

  const applyActionView = useCallback((state: ActionState) => {
    if (state.status === "success" && state.data) {
      setView(state.data as ImportView);
      pollIndex.current = 0;
      setError("");
    } else if (state.status === "error") {
      setError(t(locale, state.error.messageKey));
    }
  }, [locale]);

  /** Cancel and retry are explicit server actions; the returned view replaces the local one. */
  const runBatchAction = (action: typeof cancelImportAction) => {
    const batchId = view.batchId;
    if (!batchId) return;
    startTransition(async () => {
      const form = new FormData();
      form.set("batch_id", batchId);
      applyActionView(await action(IDLE_ACTION_STATE, form));
      requestAnimationFrame(() => statusSection.current?.focus());
    });
  };

  const refresh = useCallback(async () => {
    if (!view.batchId) return;
    try {
      const response = await fetch(`/api/imports/${view.batchId}`, { cache: "no-store" });
      if (!response.ok) return;
      setView(await response.json() as ImportView);
    } catch {
      // Keep the last saved state on a transient network failure; the next poll retries.
    }
  }, [view.batchId]);

  useEffect(() => {
    if (!view.polling || !view.batchId) return;
    const delay = EVIDENCE_POLL_DELAYS[Math.min(pollIndex.current, EVIDENCE_POLL_DELAYS.length - 1)];
    const timer = setTimeout(() => {
      pollIndex.current += 1;
      void refresh();
    }, delay);
    return () => clearTimeout(timer);
  }, [view, refresh]);

  const choose = (next: File | null) => {
    setError("");
    setFile(next);
    setUploadKey(next ? crypto.randomUUID() : null);
  };

  /** Without a chosen mode the neutral choice opens instead of uploading, with or without consent (T26, T28). */
  const upload = useCallback(async (mode?: ImportExtractionMode) => {
    if (!file || !uploadKey) return;
    if (file.size === 0) return setError(t(locale, "import.failed.FILE_EMPTY"));
    if (file.size > IMPORT_MAX_BYTES) return setError(t(locale, "import.failed.FILE_TOO_LARGE"));
    const mime = mimeFor(file);
    if (mime !== "application/pdf" && mime !== DOCX_MIME) return setError(t(locale, "import.failed.UNSUPPORTED_FORMAT"));
    if (!mode) {
      setModeError("");
      setModeStep("choose");
      setModeOpen(true);
      return;
    }
    setUploading(true);
    setError("");
    try {
      const response = await fetch("/api/imports", {
        method: "POST",
        headers: importUploadHeaders(mime, uploadKey, file.name, mode),
        body: file,
      });
      const body = await response.json().catch(() => ({})) as ImportView & { message?: string };
      if (!response.ok) {
        setError(typeof body.message === "string" ? body.message : t(locale, "import.failed.GENERIC"));
        return;
      }
      pollIndex.current = 0;
      setView(body);
      setChoosing(false);
      choose(null);
    } catch {
      setError(t(locale, "import.failed.UPLOAD_INCOMPLETE"));
    } finally {
      setUploading(false);
    }
  }, [file, uploadKey, locale]);

  const closeModeDialog = () => {
    modeChoice.current = null;
    setModeOpen(false);
    setModeStep("choose");
    setModePending(null);
    requestAnimationFrame(() => dropzone.current?.focus());
  };

  /** Saves or withdraws AI consent; returns the message to show, or null once the new state is applied. */
  const setConsent = async (choice: "allow" | "withdraw"): Promise<string | null> => {
    const form = new FormData();
    form.set("consent", choice);
    form.set("expected_revision", String(profileRevision));
    const state = await setAiConsentAction(IDLE_ACTION_STATE, form);
    if (state.status !== "success") return state.status === "error" ? t(locale, state.error.messageKey) : t(locale, "common.error");
    const revision = (state.data as { revision?: unknown } | undefined)?.revision;
    if (typeof revision === "number") setProfileRevision(revision);
    setGranted(choice === "allow");
    if (choice === "withdraw") setView(withConsentWithdrawn);
    return null;
  };

  /** With consent on, Read without AI asks first: it turns AI off for the whole account (T28). */
  const chooseMode = (mode: ImportExtractionMode) => {
    setModeError("");
    if (mode === "rules" && granted) setModeStep("confirm");
    else runChoice(mode);
  };

  const backToChoice = () => {
    setModeError("");
    setModeStep("choose");
  };

  /** Runs a choice; the consent step depends on whether consent is on (chooseImportMode). */
  const runChoice = (mode: ImportExtractionMode) => {
    modeChoice.current = mode;
    setModePending(mode);
    setModeError("");
    startTransition(async () => {
      const failure = await chooseImportMode(mode, granted, {
        saveConsent: () => setConsent("allow"),
        withdrawConsent: () => setConsent("withdraw"),
        upload: async (chosen) => {
          if (modeChoice.current !== chosen) return;
          setModeOpen(false);
          await upload(chosen);
        },
      });
      setModePending(null);
      modeChoice.current = null;
      if (failure !== null) setModeError(failure);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      input.current?.click();
    }
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files;
    choose(dropped.length === 1 ? dropped[0]! : null);
    if (dropped.length > 1) setError(t(locale, "import.failed.UNSUPPORTED_FORMAT"));
  };

  const showChooser = view.state === "choose" || choosing;
  const limited = isAiLimited(usage) ? usage : null;
  // The AI import limit blocks AI only: the user can still read the CV with rules (T26, T28 also with consent), and a
  // rules batch retries without an AI unit.
  const aiBlocksRetry = limited !== null && view.extractionMode !== "rules";
  const progress = PROGRESS_KEYS[view.state];
  const manual = (primary = false) => (
    <Link className={primary ? "button-primary" : "button-secondary"} href={onboarded ? "/settings/profile" : MANUAL_HREF}>{t(locale, "import.startManually")}</Link>
  );
  const tryAnother = () => {
    setChoosing(true);
    setError("");
    requestAnimationFrame(() => dropzone.current?.focus());
  };

  return (
    <div className="import-start space-y-5">
      {showChooser ? (
        <section className="space-y-4" aria-labelledby="import-choose-title">
          <h2 id="import-choose-title" className="text-xl font-semibold">{t(locale, "import.title")}</h2>
          <p className="text-sm text-[var(--color-text-secondary)]">{t(locale, "import.intro")}</p>
          <div className="import-disclosure">
            <h3 className="text-sm font-semibold">{t(locale, "import.disclosureTitle")}</h3>
            <p className="text-sm">{t(locale, "import.disclosureChoice")}</p>
          </div>
          <div
            ref={dropzone}
            role="button"
            tabIndex={0}
            className="import-dropzone"
            data-dragging={dragging || undefined}
            aria-label={t(locale, "import.dropLabel")}
            aria-describedby={constraintsId}
            onClick={() => input.current?.click()}
            onKeyDown={onKeyDown}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <FileUp aria-hidden="true" className="import-dropzone-icon" />
            <span className="button-secondary" aria-hidden="true">{t(locale, "import.chooseFile")}</span>
            <span className="text-sm text-[var(--color-text-secondary)]">{t(locale, "import.dropHint")}</span>
          </div>
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => choose(event.target.files?.[0] ?? null)}
          />
          <p id={constraintsId} className="field-help">{t(locale, "import.constraints")}</p>
          {file ? <p className="text-sm font-medium" aria-live="polite">{t(locale, "import.selected", { name: file.name })}</p> : null}
          {error ? <p role="alert" className="field-error">{error}</p> : null}
          <div className="import-actions">
            <Button onClick={() => void upload()} disabled={!file} loading={uploading} loadingLabel={t(locale, "import.uploading")}>
              {t(locale, "import.upload")}
            </Button>
            {manual()}
          </div>
        </section>
      ) : (
        <section ref={statusSection} tabIndex={-1} className="space-y-4 import-status" aria-labelledby={statusId}>
          {view.filename ? <p className="text-sm text-[var(--color-text-secondary)]">{t(locale, "import.savedBatch", { name: view.filename })}</p> : null}
          {view.duplicate ? (
            <p className="import-note">
              {t(locale, "import.duplicate", { date: new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", { dateStyle: "medium" }).format(new Date(view.duplicate.createdAt)) })}
            </p>
          ) : null}

          {progress ? (
            <>
              <ProgressStatus key={view.batchId} locale={locale} kind="import" stage={view.state === "waiting" ? "queued" : "running"} label={t(locale, progress)} headingId={statusId} />
              <p className="field-help">{t(locale, "import.progressHelp")}</p>
            </>
          ) : null}

          {view.state === "review_ready" ? (
            <>
              <h2 id={statusId} className="text-xl font-semibold" role="status">{t(locale, "import.readyTitle")}</h2>
              <p className="text-sm">{t(locale, "import.readyBody", { total: view.total })}</p>
              {view.extractionMode === "rules" ? <p className="import-note">{t(locale, "import.rulesNote")}</p> : null}
              <dl className="import-counts">
                {IMPORT_ENTITY_TYPES.filter((type) => view.counts[type] > 0).map((type) => (
                  <div key={type}><dt>{t(locale, `import.count.${type}` as MessageKey)}</dt><dd>{view.counts[type]}</dd></div>
                ))}
              </dl>
            </>
          ) : null}

          {view.state === "review_empty" ? (
            <>
              <h2 id={statusId} className="text-xl font-semibold" role="status">{t(locale, "import.emptyTitle")}</h2>
              <p className="text-sm">{t(locale, view.extractionMode === "rules" ? "import.emptyBodyRules" : "import.emptyBody")}</p>
            </>
          ) : null}

          {view.state === "failed_permanent" || view.state === "failed_retriable" ? (
            <>
              <h2 id={statusId} className="text-xl font-semibold" role="status">
                {t(locale, view.state === "failed_permanent" ? "import.failedTitle" : "import.failedRetriableTitle")}
              </h2>
              <p className="text-sm">{t(locale, importFailureKey(view.errorCode))}</p>
              {view.state === "failed_retriable" && view.retryBlockReason ? (
                <p className="field-help">{t(locale, `import.retry.${view.retryBlockReason}` as MessageKey)}</p>
              ) : null}
              {view.state === "failed_retriable" && view.canRetry && limited && aiBlocksRetry ? (
                <AiLimitNotice locale={locale} bucket="import" usage={limited} timeZone={timeZone} />
              ) : null}
            </>
          ) : null}

          {view.state === "cancelled" ? (
            <>
              <h2 id={statusId} className="text-xl font-semibold" role="status">{t(locale, "import.cancelledTitle")}</h2>
              <p className="text-sm">{t(locale, "import.cancelledBody")}</p>
            </>
          ) : null}

          {view.state === "committed" ? (
            <>
              <h2 id={statusId} className="text-xl font-semibold" role="status">{t(locale, "import.committedTitle")}</h2>
              <p className="text-sm">{t(locale, "import.committedBody")}</p>
            </>
          ) : null}

          {error ? <p role="alert" className="field-error">{error}</p> : null}

          <div className="import-actions">
            {view.state === "review_ready" && view.batchId ? (
              <Link className="button-primary" href={`/imports/${view.batchId}/review`}>{t(locale, "import.reviewCandidates")}</Link>
            ) : null}
            {view.state === "committed" ? (
              <Link className="button-primary" href="/dashboard">{t(locale, "import.openDashboard")}</Link>
            ) : null}
            {view.state === "failed_retriable" && !(view.canRetry && aiBlocksRetry) ? (
              <Button disabled={!view.canRetry} loading={pending} loadingLabel={t(locale, "common.loading")} onClick={() => runBatchAction(retryImportAction)}>
                {t(locale, "import.retry")}
              </Button>
            ) : null}
            {["failed_permanent", "failed_retriable", "cancelled", "review_empty", "committed"].includes(view.state) ? (
              <Button variant={view.state === "failed_retriable" || view.state === "committed" ? "secondary" : "primary"} onClick={tryAnother}>{t(locale, "import.tryAnother")}</Button>
            ) : null}
            {view.state === "committed" ? null : manual(view.state === "review_empty")}
            {view.canCancel ? (
              <button ref={cancelTrigger} type="button" className="ui-button-ghost" onClick={() => setCancelOpen(true)}>{t(locale, "import.cancel")}</button>
            ) : null}
          </div>
        </section>
      )}

      {/* Only the chooser has an Upload button, so the choice lives with it (T28: for every user). */}
      {showChooser ? (
        <ImportModeDialog
          open={modeOpen}
          locale={locale}
          step={modeStep}
          granted={granted}
          pending={modePending}
          error={modeError}
          onCancel={closeModeDialog}
          onChoose={chooseMode}
          onBack={backToChoice}
          onConfirmRules={() => runChoice("rules")}
          aiNotice={limited ? <AiLimitNotice locale={locale} bucket="import" usage={limited} timeZone={timeZone} /> : undefined}
        />
      ) : null}

      <Dialog
        open={cancelOpen}
        onOpenChange={(open) => {
          setCancelOpen(open);
          if (!open) requestAnimationFrame(() => cancelTrigger.current?.focus());
        }}
        title={t(locale, "import.cancelTitle")}
        description={t(locale, "import.cancelBody")}
      >
        <div className="ui-dialog-actions">
          <Button variant="secondary" autoFocus onClick={() => setCancelOpen(false)}>{t(locale, "import.cancelKeep")}</Button>
          <Button
            variant="destructive"
            onClick={() => {
              setCancelOpen(false);
              runBatchAction(cancelImportAction);
            }}
          >
            {t(locale, "import.cancelConfirm")}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
