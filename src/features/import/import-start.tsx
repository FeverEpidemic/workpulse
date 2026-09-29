"use client";

import Link from "next/link";
import { FileUp } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import type { DragEvent, KeyboardEvent } from "react";

import { AiConsentDialog } from "@/components/ui/ai-consent-dialog";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { IMPORT_ENTITY_TYPES, IMPORT_MAX_BYTES } from "@/domain/import/contracts";
import type { ImportView } from "@/domain/import/import-view";
import { setAiConsentAction } from "@/features/ai/actions";
import { EVIDENCE_POLL_DELAYS } from "@/features/evidence/evidence-attachments";
import { t, type Locale, type MessageKey } from "@/i18n/messages";
import { IDLE_ACTION_STATE, type ActionState } from "@/server/action-result";

import { cancelImportAction, retryImportAction } from "./actions";

const MANUAL_HREF = "/settings/profile?mode=onboarding";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const ACCEPT = ".pdf,.docx,application/pdf," + DOCX_MIME;

const FAILURE_KEYS = new Set([
  "FILE_EMPTY", "FILE_TOO_LARGE", "FILE_TYPE_MISMATCH", "UNSUPPORTED_FORMAT", "ENCRYPTED_FILE", "SCANNED_PDF",
  "CORRUPT_FILE", "EMPTY_DOCUMENT", "TOO_MANY_PAGES", "IMPORT_TEXT_TOO_LONG", "PARSER_TIMEOUT", "MALWARE_DETECTED",
  "UPLOAD_INCOMPLETE", "SCANNER_UNAVAILABLE", "STORAGE_UNAVAILABLE", "PAGE_COUNT_UNAVAILABLE", "IMPORT_WORKER_TIMEOUT",
  "CONSENT_REQUIRED",
]);

/** Localized reason for a batch failure code; AI outages share one message. */
export function importFailureKey(code: string | null): MessageKey {
  if (code && FAILURE_KEYS.has(code)) return `import.failed.${code}` as MessageKey;
  if (code?.startsWith("AI_") || code === "CONSENT_WITHDRAWN") return code === "CONSENT_WITHDRAWN" ? "import.failed.CONSENT_REQUIRED" : "import.failed.AI";
  return "import.failed.GENERIC";
}

const PROGRESS_KEYS: Partial<Record<ImportView["state"], MessageKey>> = {
  uploading: "import.uploading",
  waiting: "import.state.waiting",
  screening: "import.state.screening",
  parsing: "import.state.parsing",
  extracting: "import.state.extracting",
};

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
};

export function ImportStart({ locale, initialView, consent }: ImportStartProps) {
  const [view, setView] = useState<ImportView>(initialView);
  const [choosing, setChoosing] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploadKey, setUploadKey] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [granted, setGranted] = useState(consent.granted);
  const [consentError, setConsentError] = useState("");
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const dropzone = useRef<HTMLDivElement>(null);
  const cancelTrigger = useRef<HTMLButtonElement>(null);
  const statusSection = useRef<HTMLElement>(null);
  const pollIndex = useRef(0);
  const pendingUpload = useRef(false);
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

  const upload = useCallback(async (consentGranted = granted) => {
    if (!file || !uploadKey) return;
    if (file.size === 0) return setError(t(locale, "import.failed.FILE_EMPTY"));
    if (file.size > IMPORT_MAX_BYTES) return setError(t(locale, "import.failed.FILE_TOO_LARGE"));
    const mime = mimeFor(file);
    if (mime !== "application/pdf" && mime !== DOCX_MIME) return setError(t(locale, "import.failed.UNSUPPORTED_FORMAT"));
    if (!consentGranted) {
      pendingUpload.current = true;
      setConsentOpen(true);
      return;
    }
    setUploading(true);
    setError("");
    try {
      const response = await fetch("/api/imports", {
        method: "POST",
        headers: { "content-type": mime, "x-idempotency-key": uploadKey, "x-file-name": encodeURIComponent(file.name) },
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
  }, [file, uploadKey, granted, locale]);

  /** Allow AI in the dialog, then continue with the upload the user already asked for. */
  const allowAndUpload = () => {
    startTransition(async () => {
      const form = new FormData();
      form.set("consent", "allow");
      form.set("expected_revision", String(consent.profileRevision));
      const state = await setAiConsentAction(IDLE_ACTION_STATE, form);
      if (state.status !== "success") {
        setConsentError(state.status === "error" ? t(locale, state.error.messageKey) : "");
        return;
      }
      setGranted(true);
      setConsentError("");
      setConsentOpen(false);
      if (pendingUpload.current) {
        pendingUpload.current = false;
        await upload(true);
      }
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
  const progress = PROGRESS_KEYS[view.state];
  const manual = (primary = false) => (
    <Link className={primary ? "button-primary" : "button-secondary"} href={MANUAL_HREF}>{t(locale, "import.startManually")}</Link>
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
            <p className="text-sm">{t(locale, "import.disclosure")}</p>
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
              <h2 id={statusId} className="text-xl font-semibold" role="status">{t(locale, progress)}</h2>
              <p className="field-help">{t(locale, "import.progressHelp")}</p>
            </>
          ) : null}

          {view.state === "review_ready" ? (
            <>
              <h2 id={statusId} className="text-xl font-semibold" role="status">{t(locale, "import.readyTitle")}</h2>
              <p className="text-sm">{t(locale, "import.readyBody", { total: view.total })}</p>
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
              <p className="text-sm">{t(locale, "import.emptyBody")}</p>
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
            </>
          ) : null}

          {view.state === "cancelled" || view.state === "committed" ? (
            <>
              <h2 id={statusId} className="text-xl font-semibold" role="status">{t(locale, "import.cancelledTitle")}</h2>
              <p className="text-sm">{t(locale, "import.cancelledBody")}</p>
            </>
          ) : null}

          {error ? <p role="alert" className="field-error">{error}</p> : null}

          <div className="import-actions">
            {view.state === "failed_retriable" ? (
              <Button disabled={!view.canRetry} loading={pending} loadingLabel={t(locale, "common.loading")} onClick={() => runBatchAction(retryImportAction)}>
                {t(locale, "import.retry")}
              </Button>
            ) : null}
            {["failed_permanent", "failed_retriable", "cancelled", "review_empty", "committed"].includes(view.state) ? (
              <Button variant={view.state === "failed_retriable" ? "secondary" : "primary"} onClick={tryAnother}>{t(locale, "import.tryAnother")}</Button>
            ) : null}
            {manual(view.state === "review_empty")}
            {view.canCancel ? (
              <button ref={cancelTrigger} type="button" className="ui-button-ghost" onClick={() => setCancelOpen(true)}>{t(locale, "import.cancel")}</button>
            ) : null}
          </div>
        </section>
      )}

      <div>
        <AiConsentDialog
          open={consentOpen}
          onOpenChange={(open) => {
            setConsentOpen(open);
            if (!open) {
              pendingUpload.current = false;
              requestAnimationFrame(() => dropzone.current?.focus());
            }
          }}
          locale={locale}
          purpose="import"
          allowControl={(
            <Button loading={pending} loadingLabel={t(locale, "common.loading")} onClick={allowAndUpload}>
              {t(locale, "ai.consent.dialogAllow")}
            </Button>
          )}
        />
        {consentError ? <p role="alert" className="field-error">{consentError}</p> : null}
      </div>

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
