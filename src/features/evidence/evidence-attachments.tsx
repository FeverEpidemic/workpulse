"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type { EvidenceParentKind, EvidencePublicRecord, EvidenceStatus } from "@/features/evidence/contracts";
import type { Locale, MessageKey } from "@/i18n/messages";
import { t } from "@/i18n/messages";

const MAX_BYTES = 10 * 1024 * 1024;
const MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
export const EVIDENCE_POLL_DELAYS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;

export type EvidenceMoveTarget = { id: string; revision: number; label: string };

export type EvidenceAttachmentsProps = {
  locale: Locale;
  parentKind: EvidenceParentKind;
  parentId: string;
  expectedParentRevision: number;
  moveTarget?: EvidenceMoveTarget | null;
  onItemCountChange?: (count: number | null) => void;
};

type ApiError = { code?: string; message?: string };
type RequestFailure = Error & { code?: string; serverMessage?: string };

// Server codes whose localized message tells the user something actionable that the
// generic UI fallback copy would hide (for example a full record or account quota).
const SERVER_MESSAGE_CODES = new Set([
  "AUTH_REQUIRED",
  "EVIDENCE_NOT_FOUND",
  "EVIDENCE_QUOTA_EXCEEDED",
  "EVIDENCE_SLOT_LIMIT",
  "FILE_SIZE_MISMATCH",
  "FILE_TOO_LARGE",
  "FILE_TYPE_INVALID",
  "PROVIDER_UNAVAILABLE",
  "RESERVATION_EXPIRED",
]);

function isPending(item: EvidencePublicRecord): boolean {
  return item.status === "uploading" || item.status === "scanning";
}

export function evidenceItemActions(status: EvidenceStatus, parentKind: EvidenceParentKind, hasMoveTarget: boolean) {
  return {
    download: status === "ready",
    retry: status === "failed",
    remove: status !== "deleting",
    move: status === "ready" && parentKind === "activity" && hasMoveTarget,
  } as const;
}

function statusClass(status: EvidenceStatus): string {
  switch (status) {
    case "ready": return "evidence-status evidence-status--ready";
    case "failed": return "evidence-status evidence-status--failed";
    case "deleting": return "evidence-status evidence-status--deleting";
    case "uploading":
    case "scanning": return "evidence-status evidence-status--pending";
  }
}

function statusLabel(locale: Locale, status: EvidenceStatus): string {
  const keys: Record<EvidenceStatus, "evidence.uploading" | "evidence.scanning" | "evidence.ready" | "evidence.failed" | "evidence.deleting"> = {
    uploading: "evidence.uploading", scanning: "evidence.scanning", ready: "evidence.ready", failed: "evidence.failed", deleting: "evidence.deleting",
  };
  return t(locale, keys[status]);
}

async function responseBody<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & ApiError;
  if (!response.ok) {
    throw Object.assign(new Error("Evidence request failed"), {
      code: body.code || (response.status === 409 ? "CONFLICT" : undefined),
      serverMessage: typeof body.message === "string" ? body.message : undefined,
    }) satisfies RequestFailure;
  }
  return body;
}

export function describeEvidenceFailure(locale: Locale, error: unknown, fallback: MessageKey): { message: string; stale: boolean } {
  const { code, serverMessage } = (error ?? {}) as RequestFailure;
  if (code === "CONFLICT") return { message: t(locale, "evidence.conflict"), stale: true };
  if (code && serverMessage && SERVER_MESSAGE_CODES.has(code)) return { message: serverMessage, stale: false };
  return { message: t(locale, fallback), stale: false };
}

function listUrl(parentKind: EvidenceParentKind, parentId: string): string {
  return `/api/evidence?${new URLSearchParams({ parentKind, parentId }).toString()}`;
}

export function EvidenceAttachments({ locale, parentKind, parentId, expectedParentRevision, moveTarget = null, onItemCountChange }: EvidenceAttachmentsProps) {
  const [items, setItems] = useState<EvidencePublicRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [retryFileIds, setRetryFileIds] = useState<Set<string>>(() => new Set());
  const [retryId, setRetryId] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [visible, setVisible] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const removeTrigger = useRef<HTMLButtonElement | null>(null);
  const removeConfirmation = useRef<HTMLButtonElement | null>(null);
  const refreshButton = useRef<HTMLButtonElement | null>(null);
  const removeWasOpen = useRef(false);
  const mounted = useRef(false);
  const pollIndex = useRef(0);
  const loadingRef = useRef(false);
  const fileByEvidenceId = useRef(new Map<string, File>());
  const router = useRouter();

  const refresh = useCallback(async (quiet = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (!quiet) setLoading(true);
    try {
      const response = await fetch(listUrl(parentKind, parentId), { cache: "no-store" });
      const result = await responseBody<{ items: EvidencePublicRecord[] }>(response);
      if (!mounted.current) return;
      setItems(result.items);
      setLoaded(true);
      setMessage("");
    } catch {
      if (mounted.current) {
        setLoaded(false);
        setMessage(t(locale, "evidence.loadFailed"));
      }
    } finally {
      loadingRef.current = false;
      if (mounted.current && !quiet) setLoading(false);
    }
  }, [locale, parentId, parentKind]);

  useEffect(() => {
    mounted.current = true;
    const initialLoad = window.setTimeout(() => void refresh(), 0);
    const onVisibility = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      mounted.current = false;
      window.clearTimeout(initialLoad);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  useEffect(() => {
    onItemCountChange?.(loaded ? items.length : null);
  }, [items.length, loaded, onItemCountChange]);

  useEffect(() => {
    if (removeId) {
      removeWasOpen.current = true;
      removeConfirmation.current?.focus();
    } else if (removeWasOpen.current) {
      const target = removeTrigger.current;
      (target?.isConnected ? target : refreshButton.current)?.focus();
      removeTrigger.current = null;
      removeWasOpen.current = false;
    }
  }, [removeId]);

  const hasPending = items.some(isPending);
  useEffect(() => {
    if (!visible || !hasPending) {
      if (!hasPending) pollIndex.current = 0;
      return;
    }
    const delay = EVIDENCE_POLL_DELAYS[Math.min(pollIndex.current, EVIDENCE_POLL_DELAYS.length - 1)]!;
    const timer = window.setTimeout(() => {
      pollIndex.current = Math.min(pollIndex.current + 1, EVIDENCE_POLL_DELAYS.length - 1);
      void refresh(true);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [hasPending, refresh, visible, items]);

  const setBusy = (id: string, busy: boolean) => setBusyIds((current) => {
    const next = new Set(current);
    if (busy) next.add(id); else next.delete(id);
    return next;
  });

  const failureMessage = (error: unknown, fallback: MessageKey): string => {
    const failure = describeEvidenceFailure(locale, error, fallback);
    // Parent or move-target revisions come from the host page; reload them so the
    // next attempt does not repeat the same stale revision.
    if (failure.stale) router.refresh();
    return failure.message;
  };

  const validateFile = (file: File): string | null => {
    if (!MIME_TYPES.has(file.type)) return t(locale, "evidence.unsupportedType");
    if (file.size <= 0 || file.size > MAX_BYTES) return t(locale, "evidence.invalidSize");
    return null;
  };

  const beginUpload = async (file: File, failedId?: string) => {
    const invalid = validateFile(file);
    if (invalid) { setMessage(invalid); return; }
    const localId = failedId ?? `new-${crypto.randomUUID()}`;
    setBusy(localId, true);
    setMessage("");
    let reserved = false;
    try {
      const reservation = await responseBody<EvidencePublicRecord>(await fetch("/api/evidence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          parentKind, parentId, filename: file.name, contentType: file.type, expectedBytes: file.size,
          idempotencyKey: crypto.randomUUID(), expectedRevision: expectedParentRevision,
        }),
      }));
      reserved = true;
      fileByEvidenceId.current.set(reservation.id, file);
      setRetryFileIds((current) => new Set(current).add(reservation.id));
      setItems((current) => [reservation, ...current]);
      if (mounted.current) await refresh(true);
      const upload = await fetch(`/api/evidence/${encodeURIComponent(reservation.id)}/upload`, {
        method: "PUT",
        headers: { "content-type": file.type, "x-expected-revision": String(reservation.revision) },
        body: file,
      });
      const uploaded = await responseBody<EvidencePublicRecord>(upload);
      setItems((current) => current.map((item) => item.id === uploaded.id ? uploaded : item));
      // Upload acceptance only enters quarantine. The server's scanner decides readiness.
      setMessage(t(locale, "evidence.uploadQueued"));
    } catch (error) {
      setMessage(failureMessage(error, reserved ? "evidence.uploadFailed" : "evidence.reserveFailed"));
      await refresh(true);
    } finally {
      setBusy(localId, false);
    }
  };

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    if (retryId) {
      const current = items.find((item) => item.id === retryId);
      setRetryId(null);
      if (current) void beginUpload(file, current.id);
    } else void beginUpload(file);
  };

  const retry = (item: EvidencePublicRecord) => {
    const availableFile = fileByEvidenceId.current.get(item.id);
    if (availableFile) void beginUpload(availableFile, item.id);
    else {
      setRetryId(item.id);
      fileInput.current?.click();
    }
  };

  const download = async (item: EvidencePublicRecord) => {
    if (item.status !== "ready") return;
    setBusy(item.id, true);
    setMessage("");
    try {
      const result = await responseBody<{ url: string }>(await fetch(`/api/evidence/${encodeURIComponent(item.id)}/download`, { method: "POST" }));
      window.location.assign(result.url);
    } catch (error) {
      setMessage(failureMessage(error, "evidence.downloadFailed"));
      await refresh(true);
    } finally { setBusy(item.id, false); }
  };

  const remove = async (item: EvidencePublicRecord) => {
    setBusy(item.id, true);
    setMessage("");
    try {
      await responseBody<EvidencePublicRecord>(await fetch(`/api/evidence/${encodeURIComponent(item.id)}`, {
        method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: item.revision }),
      }));
      setRemoveId(null);
      await refresh(true);
    } catch (error) {
      setMessage(failureMessage(error, "evidence.removeFailed"));
      await refresh(true);
    } finally { setBusy(item.id, false); }
  };

  const move = async (item: EvidencePublicRecord) => {
    if (!moveTarget || item.status !== "ready" || parentKind !== "activity") return;
    setBusy(item.id, true);
    setMessage("");
    try {
      await responseBody<EvidencePublicRecord>(await fetch(`/api/evidence/${encodeURIComponent(item.id)}/move`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetAchievementId: moveTarget.id, expectedRevision: item.revision, expectedTargetRevision: moveTarget.revision }),
      }));
      await refresh(true);
      setMessage(t(locale, "evidence.moved", { target: moveTarget.label }));
    } catch (error) {
      setMessage((error as RequestFailure).code === "EVIDENCE_SLOT_LIMIT"
        ? t(locale, "evidence.moveTargetFull", { target: moveTarget.label })
        : failureMessage(error, "evidence.moveFailed"));
      await refresh(true);
    } finally { setBusy(item.id, false); }
  };

  return <section className="evidence-attachments" aria-labelledby="evidence-heading">
    <div className="evidence-heading-row">
      <div><h2 id="evidence-heading">{t(locale, "evidence.heading")}</h2><p>{t(locale, "evidence.help")}</p></div>
      <button type="button" className="button-secondary" onClick={() => fileInput.current?.click()}>{t(locale, "evidence.add")}</button>
    </div>
    <input ref={fileInput} className="evidence-file-input" type="file" accept="application/pdf,image/png,image/jpeg,application/vnd.openxmlformats-officedocument.wordprocessingml.document" aria-label={t(locale, "evidence.chooseFile")} onChange={(event) => { handleFile(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} />
    <p className="evidence-help">{t(locale, "evidence.fileLimits")}</p>
    {message ? <p className="evidence-message" role="status" aria-live="polite">{message}</p> : null}
    {loading ? <p role="status">{t(locale, "evidence.loading")}</p> : items.length === 0 ? <p className="evidence-empty">{t(locale, "evidence.empty")}</p> : <ul className="evidence-list">
      {items.map((item) => {
        const busy = busyIds.has(item.id);
        const actions = evidenceItemActions(item.status, parentKind, Boolean(moveTarget));
        return <li className="evidence-item" key={item.id}>
          <div className="evidence-item-main">
            <span className={statusClass(item.status)} role="status" aria-live="polite">{statusLabel(locale, item.status)}</span>
            <span className="evidence-filename" title={item.filename}>{item.filename}</span>
            <span className="evidence-item-size">{t(locale, "evidence.fileBytes", { bytes: item.bytes })}</span>
            {item.failureCode ? <span className="evidence-item-error">{t(locale, "evidence.processingFailed")}</span> : null}
          </div>
          <div className="evidence-item-actions">
            {actions.download ? <button type="button" className="button-secondary" disabled={busy} onClick={() => void download(item)}>{t(locale, "evidence.downloadNamed", { name: item.filename })}</button> : null}
            {actions.retry ? <button type="button" className="button-secondary" disabled={busy} onClick={() => retry(item)}>{t(locale, retryFileIds.has(item.id) ? "evidence.retryNamed" : "evidence.chooseRetryNamed", { name: item.filename })}</button> : null}
            {actions.move && moveTarget ? <button type="button" className="button-secondary" disabled={busy} onClick={() => void move(item)}>{t(locale, "evidence.moveNamed", { name: item.filename, target: moveTarget.label })}</button> : null}
            {actions.remove ? <button type="button" className="button-secondary" disabled={busy} aria-label={t(locale, "evidence.removeNamed", { name: item.filename })} onClick={(event) => {
              removeTrigger.current = event.currentTarget;
              setRemoveId(removeId === item.id ? null : item.id);
            }}>{t(locale, "evidence.remove")}</button> : null}
            {removeId === item.id ? <span className="evidence-remove-confirm" role="group" aria-label={t(locale, "evidence.confirmRemoveNamed", { name: item.filename })}>
              <span>{t(locale, "evidence.confirmRemove", { name: item.filename })}</span>
              <button ref={removeConfirmation} type="button" className="button-danger" disabled={busy} onClick={() => void remove(item)}>{t(locale, "evidence.confirmRemoveAction")}</button>
              <button type="button" className="button-secondary" disabled={busy} onClick={() => setRemoveId(null)}>{t(locale, "evidence.cancel")}</button>
            </span> : null}
          </div>
        </li>;
      })}
    </ul>}
    <button ref={refreshButton} type="button" className="button-secondary evidence-refresh" disabled={loading} onClick={() => void refresh()}>{t(locale, "evidence.refresh")}</button>
  </section>;
}
