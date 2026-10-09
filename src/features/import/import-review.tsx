"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/field-control";
import { useUnsavedForm } from "@/components/ui/unsaved-changes";
import type { ImportCommitResult, ImportItemAction, ImportItemError } from "@/domain/import/commit-contracts";
import {
  beginSave,
  changeFormData,
  clearSavedDraft,
  commitToken,
  draftPatch,
  isDirty,
  resetRevisionTracker,
  settleSave,
  startRevisionTracker,
  withReceipt,
  type RevisionTracker,
  type FieldDraft,
  type ItemChange,
  type ItemSaveStatus,
} from "@/domain/import/review-edit";
import {
  ONBOARDING_NAME_MAX,
  ONBOARDING_PLACEHOLDER_NAME,
  ONBOARDING_TIMEZONE_MAX,
  REVIEW_GROUP_ORDER,
  toImportReviewView,
  type ImportReviewSnapshot,
  type OnboardingDraft,
  type ReviewCandidate,
} from "@/domain/import/review-view";
import { IMPORT_ENTITY_TYPES } from "@/domain/import/contracts";
import { abandonedReviewDeadline, formatAbandonedReviewDate } from "@/domain/import/review-retention";
import { t, type Locale, type MessageKey } from "@/i18n/messages";
import { IDLE_ACTION_STATE, type ActionState } from "@/server/action-result";

import { cancelImportAction, commitImportAction, updateImportItemAction, validateImportAction } from "./actions";
import { fieldElementId, ImportReviewCandidate, type CandidateHandlers } from "./import-review-candidate";
import { importFailureKey } from "./import-start";

export type ImportReviewProps = {
  locale: Locale;
  snapshot: ImportReviewSnapshot;
  ownerId: string;
  defaults: { locale: Locale; timezone: string };
  manualHref: string;
};

const typeLabel = (locale: Locale, type: string) => t(locale, `import.count.${type}` as MessageKey);

function candidateTitle(locale: Locale, candidate: ReviewCandidate, payload: Record<string, unknown> | null): string {
  const text = (name: string) => (typeof payload?.[name] === "string" ? (payload[name] as string).trim() : "");
  const joined = (...parts: string[]) => parts.filter(Boolean).join(" · ");
  const name = (() => {
    switch (candidate.type) {
      case "experience": return joined(text("role_title"), text("organization"));
      case "education": return joined(text("qualification"), text("institution"));
      case "certification": return joined(text("name"), text("issuer"));
      case "skill": return text("name");
      case "achievement": return text("title");
      default: return typeLabel(locale, "profile");
    }
  })();
  return name || t(locale, "import.review.candidate", { type: typeLabel(locale, candidate.type), number: candidate.ordinal + 1 });
}

function onboardingKey(ownerId: string, batchId: string) {
  return `workpulse:import-onboarding:${ownerId}:${batchId}`;
}

const ONBOARDING_EVENT = "workpulse:import-onboarding";

function readRaw(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    // Session storage may be unavailable; the form simply starts from its defaults.
    return null;
  }
}

function parseOnboarding(raw: string | null): OnboardingDraft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<OnboardingDraft>;
    if (typeof parsed.display_name === "string" && typeof parsed.locale === "string" && typeof parsed.timezone === "string") {
      return { display_name: parsed.display_name, locale: parsed.locale, timezone: parsed.timezone };
    }
  } catch {
    // A corrupt draft is ignored.
  }
  return null;
}

function subscribeOnboarding(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(ONBOARDING_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(ONBOARDING_EVENT, callback);
  };
}

const subscribeNever = () => () => undefined;

function detectTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    // UTC stays the safe default when the browser reports no IANA zone.
    return null;
  }
}
function initialName(snapshot: ImportReviewSnapshot): string {
  const profile = snapshot.items.find((item) => item.entity_type === "profile");
  const name = profile?.payload?.display_name;
  if (typeof name !== "string") return "";
  const trimmed = name.trim();
  return trimmed.toLowerCase() === ONBOARDING_PLACEHOLDER_NAME ? "" : trimmed.slice(0, ONBOARDING_NAME_MAX);
}

export function ImportReview({ locale, snapshot: initial, ownerId, defaults, manualHref }: ImportReviewProps) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(initial);
  const [drafts, setDrafts] = useState<Record<string, FieldDraft>>({});
  const [statuses, setStatuses] = useState<Record<string, ItemSaveStatus>>({});
  const [invalid, setInvalid] = useState<Record<string, string[]>>({});
  // Candidates whose save hit a conflict and were then reloaded: their kept edits show the server value beside them.
  const [reloadedConflicts, setReloadedConflicts] = useState<string[]>([]);
  const [onboardingEdit, setOnboardingEdit] = useState<OnboardingDraft | null>(null);
  const [committing, setCommitting] = useState(false);
  const [notice, setNotice] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const validationSeq = useRef(0);
  const commitLock = useRef(false);
  // Commit token: the revision this tab last loaded plus its own saves, never a revision taken from a receipt.
  const revisions = useRef<RevisionTracker>(startRevisionTracker(initial.batch.revision));
  const cancelTrigger = useRef<HTMLButtonElement>(null);
  const errorSummary = useRef<HTMLDivElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const batchId = snapshot.batch.id;
  const storageKey = onboardingKey(ownerId, batchId);
  const { markDirty: guardDirty, markClean: guardClean } = useUnsavedForm(`import-review-${batchId}`);

  // Onboarding fields stay local until the commit; a refresh restores them from this tab's session.
  const storedRaw = useSyncExternalStore(subscribeOnboarding, () => readRaw(storageKey), () => null);
  const detectedZone = useSyncExternalStore(subscribeNever, detectTimezone, () => null);
  const onboarding = useMemo<OnboardingDraft>(() => onboardingEdit ?? parseOnboarding(storedRaw) ?? {
    display_name: initialName(snapshot),
    locale: defaults.locale,
    timezone: defaults.timezone === "UTC" && detectedZone ? detectedZone : defaults.timezone || "UTC",
  }, [onboardingEdit, storedRaw, snapshot, defaults.locale, defaults.timezone, detectedZone]);

  const unsavedIds = useMemo(
    () => snapshot.items.filter((item) => isDirty(item.payload, drafts[item.id]) || (invalid[item.id]?.length ?? 0) > 0).map((item) => item.id),
    [snapshot.items, drafts, invalid],
  );
  const savingIds = useMemo(() => Object.entries(statuses).filter(([, value]) => value === "saving").map(([id]) => id), [statuses]);
  const view = useMemo(
    () => toImportReviewView(snapshot, { unsavedItemIds: unsavedIds, savingItemIds: savingIds, onboarding }),
    [snapshot, unsavedIds, savingIds, onboarding],
  );

  // Navigation guard: any candidate with unsaved edits asks before leaving.
  const anyUnsaved = unsavedIds.length > 0;
  useEffect(() => {
    if (anyUnsaved) guardDirty();
    else guardClean();
  }, [anyUnsaved, guardDirty, guardClean]);

  useEffect(() => {
    if (view.state === "committed") resultHeading.current?.focus();
  }, [view.state]);

  const updateOnboarding = (next: OnboardingDraft) => {
    setOnboardingEdit(next);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(next));
      window.dispatchEvent(new Event(ONBOARDING_EVENT));
    } catch {
      // Not persisted; the values still apply to this page view.
    }
  };

  const setStatus = (id: string, status: ItemSaveStatus) => setStatuses((current) => ({ ...current, [id]: status }));

  async function refreshValidation() {
    const seq = validationSeq.current + 1;
    validationSeq.current = seq;
    const form = new FormData();
    form.set("batch_id", batchId);
    const state = await validateImportAction(IDLE_ACTION_STATE, form);
    if (seq !== validationSeq.current) return;
    if (state.status === "success") setSnapshot((current) => ({ ...current, errors: state.data as ImportItemError[] }));
    else if (state.status === "error" && state.error.messageKey === "import.error.notReviewable") await reload();
  }

  async function reload(): Promise<boolean> {
    try {
      const response = await fetch(`/api/imports/${batchId}/review`, { cache: "no-store" });
      if (!response.ok) throw new Error("reload");
      const next = await response.json() as ImportReviewSnapshot;
      if (!Array.isArray(next.items) || !next.batch) throw new Error("reload");
      setSnapshot(next);
      revisions.current = resetRevisionTracker(revisions.current, next.batch.revision);
      setReloadedConflicts((current) => [...new Set([...current, ...Object.entries(statuses).filter(([, value]) => value === "conflict").map(([id]) => id)])]);
      setStatuses({});
      return true;
    } catch {
      setNotice(t(locale, "import.review.reloadFailed"));
      return false;
    }
  }

  async function saveChange(itemId: string, change: ItemChange) {
    const item = snapshot.items.find((row) => row.id === itemId);
    if (!item) return;
    setStatus(itemId, "saving");
    setNotice("");
    const started = beginSave(revisions.current);
    revisions.current = started.tracker;
    const state: ActionState = await updateImportItemAction(IDLE_ACTION_STATE, changeFormData(itemId, item.revision, change));
    const receipt = state.status === "success" ? state.data as { itemRevision: number; batchRevision: number } : null;
    const settled = settleSave(revisions.current, started.generation, receipt?.batchRevision ?? null);
    revisions.current = settled.tracker;
    if (receipt) {
      setSnapshot((current) => withReceipt(current, itemId, change, receipt));
      if (change.patch) setDrafts((current) => ({ ...current, [itemId]: clearSavedDraft(current[itemId], change.patch as Record<string, unknown>) }));
      setStatus(itemId, "saved");
      setReloadedConflicts((current) => current.filter((id) => id !== itemId));
      if (settled.outOfSync) {
        // The batch also changed in another tab: show those choices before this tab may commit.
        setNotice(t(locale, "import.review.changedElsewhere"));
        await reload();
        return;
      }
      await refreshValidation();
      return;
    }
    if (state.status !== "error") return;
    const key = state.error.messageKey;
    if (key === "error.conflict") {
      setStatus(itemId, "conflict");
    } else if (key === "import.error.notReviewable" || key === "import.error.notCommittable") {
      setNotice(t(locale, key));
      await reload();
    } else {
      setStatus(itemId, "failed");
      setNotice(t(locale, key));
    }
  }

  const patchDraft = (itemId: string, patch: FieldDraft) => {
    setDrafts((current) => ({ ...current, [itemId]: { ...current[itemId], ...patch } }));
    if (statuses[itemId] === "saved" || statuses[itemId] === "failed") setStatus(itemId, "idle");
  };

  const handlers: CandidateHandlers = {
    onChange: patchDraft,
    onInvalid: (itemId, field, flag) => setInvalid((current) => {
      const fields = new Set(current[itemId] ?? []);
      if (flag) fields.add(field);
      else fields.delete(field);
      return { ...current, [itemId]: [...fields] };
    }),
    onSave: (itemId) => {
      const item = snapshot.items.find((row) => row.id === itemId);
      if (!item) return;
      const patch = draftPatch(item.payload, drafts[itemId]);
      if (Object.keys(patch).length > 0) void saveChange(itemId, { patch });
    },
    onDiscard: (itemId) => {
      setDrafts((current) => ({ ...current, [itemId]: {} }));
      setInvalid((current) => ({ ...current, [itemId]: [] }));
      setReloadedConflicts((current) => current.filter((id) => id !== itemId));
      setStatus(itemId, "idle");
    },
    onAction: (itemId, action: ImportItemAction) => {
      void saveChange(itemId, { action });
    },
    onMap: (itemId, targetId) => {
      void saveChange(itemId, { action: "map", targetId });
    },
    onConfirm: (itemId, confirm) => {
      void saveChange(itemId, { confirm });
    },
    onProfileField: (itemId, name, selected) => {
      const item = snapshot.items.find((row) => row.id === itemId);
      const current = Array.isArray(item?.payload?.selected_fields) ? (item.payload.selected_fields as unknown[]) : [];
      const next = selected ? [...current.filter((entry) => entry !== name), name] : current.filter((entry) => entry !== name);
      const value = drafts[itemId] && Object.hasOwn(drafts[itemId]!, name) ? drafts[itemId]![name] : null;
      // A field edited in place is saved together with its selection.
      void saveChange(itemId, { patch: { selected_fields: next, ...(value !== null && value !== undefined ? { [name]: value } : {}) } });
    },
    onReload: () => { void reload(); },
  };

  async function commit() {
    if (commitLock.current || !view.canCommit) return;
    commitLock.current = true;
    setCommitting(true);
    setNotice("");
    try {
      const form = new FormData();
      form.set("batch_id", batchId);
      form.set("expected_revision", String(commitToken(revisions.current)));
      if (view.onboarding.required) {
        form.set("onboarding_display_name", onboarding.display_name.trim());
        form.set("onboarding_locale", onboarding.locale);
        form.set("onboarding_timezone", onboarding.timezone.trim());
      }
      const state = await commitImportAction(IDLE_ACTION_STATE, form);
      if (state.status === "success") {
        const { batch_id: _batch, committed_at: _at, ...stored } = state.data as ImportCommitResult;
        void _batch; void _at;
        setSnapshot((current) => ({ ...current, batch: { ...current.batch, status: "committed", commit_result: stored }, items: [], errors: [] }));
        try { sessionStorage.removeItem(storageKey); } catch { /* nothing to clean */ }
        router.refresh();
        return;
      }
      if (state.status !== "error") return;
      const key = state.error.messageKey;
      if (key === "error.conflict") {
        setNotice(t(locale, "import.review.commitStale"));
        await reload();
      } else if (key === "import.error.notCommittable" || key === "import.error.notReviewable") {
        setNotice(t(locale, key));
        await reload();
      } else if (key === "import.error.itemInvalid") {
        const list = (state.error.latestRecord as { itemErrors?: ImportItemError[] } | undefined)?.itemErrors ?? [];
        setNotice(t(locale, list.length > 0 ? "import.review.commitInvalid" : key));
        if (list.length > 0) setSnapshot((current) => ({ ...current, errors: list }));
        else await refreshValidation();
      } else {
        setNotice(t(locale, key));
      }
      requestAnimationFrame(() => errorSummary.current?.focus());
    } finally {
      commitLock.current = false;
      setCommitting(false);
    }
  }

  async function cancelImport() {
    setCancelling(true);
    const form = new FormData();
    form.set("batch_id", batchId);
    const state = await cancelImportAction(IDLE_ACTION_STATE, form);
    if (state.status === "success") {
      guardClean();
      router.push("/onboarding/import");
      return;
    }
    setCancelling(false);
    setCancelOpen(false);
    if (state.status === "error") setNotice(t(locale, state.error.messageKey));
  }

  function focusError(itemId: string, field: string) {
    const target = document.getElementById(fieldElementId(itemId, field)) ?? document.getElementById(itemId);
    const details = target?.closest("details");
    if (details && !details.open) details.open = true;
    target?.focus();
  }

  const manual = (primary: boolean) => (
    <Link className={primary ? "button-primary" : "button-secondary"} href={manualHref}>{t(locale, "import.startManually")}</Link>
  );
  const cancelButton = (
    <button ref={cancelTrigger} type="button" className="ui-button-ghost" onClick={() => setCancelOpen(true)}>{t(locale, "import.cancel")}</button>
  );

  const cancelDialog = (
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
        <Button variant="destructive" loading={cancelling} loadingLabel={t(locale, "common.loading")} onClick={() => void cancelImport()}>
          {t(locale, "import.cancelConfirm")}
        </Button>
      </div>
    </Dialog>
  );

  const header = (
    <header className="space-y-2">
      <h1 className="text-2xl font-semibold tracking-tight">{t(locale, "import.review.title")}</h1>
      <p className="text-sm text-[var(--color-text-secondary)]">{t(locale, "import.review.sourceFile", { name: view.filename })}</p>
    </header>
  );

  if (view.state === "processing") {
    return (
      <div className="import-review space-y-5">
        {header}
        <section className="space-y-3" aria-labelledby="import-review-state">
          <h2 id="import-review-state" className="text-xl font-semibold" aria-live="polite">{t(locale, "import.review.processingTitle")}</h2>
          <p className="text-sm">{t(locale, "import.review.processingBody")}</p>
          <Link className="button-primary" href="/onboarding/import">{t(locale, "import.review.backToStatus")}</Link>
        </section>
      </div>
    );
  }

  if (view.state === "failed" || view.state === "cancelled") {
    return (
      <div className="import-review space-y-5">
        {header}
        <section className="space-y-3" aria-labelledby="import-review-state">
          <h2 id="import-review-state" className="text-xl font-semibold" aria-live="polite">
            {t(locale, view.state === "failed" ? "import.failedTitle" : "import.cancelledTitle")}
          </h2>
          <p className="text-sm">{view.state === "failed" ? t(locale, importFailureKey(view.errorCode)) : t(locale, "import.cancelledBody")}</p>
          <div className="import-actions">
            <Link className="button-primary" href="/onboarding/import">{t(locale, "import.tryAnother")}</Link>
            {manual(false)}
          </div>
        </section>
      </div>
    );
  }

  if (view.state === "committed") {
    const result = view.result;
    const rows = result ? IMPORT_ENTITY_TYPES.filter((type) => Object.values(result.counts[type]).some((count) => count > 0)) : [];
    return (
      <div className="import-review space-y-5">
        {header}
        <section className="space-y-4" aria-labelledby="import-review-state">
          <h2 id="import-review-state" ref={resultHeading} tabIndex={-1} className="import-result-heading text-xl font-semibold" aria-live="polite">
            {t(locale, "import.review.committedTitle")}
          </h2>
          {result ? (
            <ul className="import-result">
              {rows.map((type) => (
                <li key={type}>
                  {t(locale, "import.review.resultRow", { type: typeLabel(locale, type), created: result.counts[type].created, mapped: result.counts[type].mapped, skipped: result.counts[type].skipped })}
                </li>
              ))}
              <li>{t(locale, "import.review.resultConfirmed", { count: result.confirmed_achievements })}</li>
              {result.profile_fields_applied > 0 ? <li>{t(locale, "import.review.resultProfile", { count: result.profile_fields_applied })}</li> : null}
            </ul>
          ) : <p className="text-sm">{t(locale, "import.review.committedBody")}</p>}
          <Link className="button-primary" href="/dashboard">{t(locale, "import.review.openDashboard")}</Link>
        </section>
      </div>
    );
  }

  if (view.state === "review_empty") {
    return (
      <div className="import-review space-y-5">
        {header}
        <section className="space-y-3" aria-labelledby="import-review-state">
          <h2 id="import-review-state" className="text-xl font-semibold" aria-live="polite">{t(locale, "import.review.emptyTitle")}</h2>
          <p className="text-sm">{t(locale, "import.review.emptyBody")}</p>
          <div className="import-actions">{manual(true)}{cancelButton}</div>
        </section>
        {cancelDialog}
      </div>
    );
  }

  const autoCancelDeadline = abandonedReviewDeadline(snapshot.batch.last_activity_at);
  const blockerText = view.commitBlockers.map((blocker) =>
    t(locale, `import.review.blocker.${blocker.kind}` as MessageKey, { count: blocker.count }));
  const totalTypes = REVIEW_GROUP_ORDER.filter((type) => view.summary.byType[type].create + view.summary.byType[type].map + view.summary.byType[type].skip > 0);

  return (
    <div className="import-review space-y-5">
      {header}
      <p className="text-sm">{t(locale, "import.review.intro")}</p>
      {autoCancelDeadline ? (
        <p className="field-help" data-testid="import-auto-cancel-notice">
          {t(locale, "import.review.autoCancelNotice", { date: formatAbandonedReviewDate(autoCancelDeadline, locale) })}
        </p>
      ) : null}

      {notice ? <p role="alert" className="ui-message ui-message--warning">{notice}</p> : null}

      {view.errorSummary.length > 0 ? (
        <div ref={errorSummary} tabIndex={-1} role="alert" className="ui-message ui-message--danger import-error-summary" aria-labelledby="import-error-summary-title">
          <h2 id="import-error-summary-title" className="font-semibold">{t(locale, "import.review.errorSummaryTitle")}</h2>
          <ul>
            {view.errorSummary.map((error) => (
              <li key={`${error.itemId}-${error.field}-${error.code}`}>
                <a href={`#${fieldElementId(error.itemId, error.field)}`} onClick={(event) => { event.preventDefault(); focusError(error.itemId, error.field); }}>
                  {t(locale, "import.review.errorSummaryItem", {
                    group: typeLabel(locale, error.type), number: error.ordinal + 1,
                    field: t(locale, `import.review.field.${error.field}` as MessageKey),
                  })}
                  {" — "}
                  {t(locale, `import.review.error.${error.code}` as MessageKey)}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="import-review-layout">
        <div className="import-review-main space-y-5">
          {view.onboarding.required ? (
            <section className="app-card space-y-3" aria-labelledby="import-onboarding-title">
              <h2 id="import-onboarding-title" className="text-lg font-semibold">{t(locale, "import.review.onboardingTitle")}</h2>
              <p className="text-sm">{t(locale, "import.review.onboardingBody")}</p>
              <div className="import-field">
                <label className="field-label" htmlFor="import-onboarding-name">
                  {t(locale, "onboarding.displayName")}
                  <span className="import-required">{t(locale, "import.review.required")}</span>
                </label>
                <Input
                  id="import-onboarding-name" autoComplete="name" maxLength={ONBOARDING_NAME_MAX + 20} value={onboarding.display_name}
                  aria-invalid={view.onboarding.errors.display_name ? true : undefined}
                  aria-describedby={view.onboarding.errors.display_name ? "import-onboarding-name-error" : undefined}
                  onChange={(event) => updateOnboarding({ ...onboarding, display_name: event.target.value })}
                />
                {view.onboarding.errors.display_name ? (
                  <p id="import-onboarding-name-error" className="field-error">{t(locale, `import.review.onboarding.${view.onboarding.errors.display_name}` as MessageKey)}</p>
                ) : null}
              </div>
              <div className="import-field">
                <label className="field-label" htmlFor="import-onboarding-locale">{t(locale, "onboarding.language")}</label>
                <Select id="import-onboarding-locale" value={onboarding.locale} onChange={(event) => updateOnboarding({ ...onboarding, locale: event.target.value })}>
                  <option value="en">English</option>
                  <option value="id">Bahasa Indonesia</option>
                </Select>
              </div>
              <div className="import-field">
                <label className="field-label" htmlFor="import-onboarding-timezone">{t(locale, "onboarding.timezone")}</label>
                <Input
                  id="import-onboarding-timezone" maxLength={ONBOARDING_TIMEZONE_MAX + 20} value={onboarding.timezone}
                  aria-invalid={view.onboarding.errors.timezone ? true : undefined}
                  aria-describedby={`import-onboarding-timezone-help${view.onboarding.errors.timezone ? " import-onboarding-timezone-error" : ""}`}
                  onChange={(event) => updateOnboarding({ ...onboarding, timezone: event.target.value })}
                />
                <p id="import-onboarding-timezone-help" className="field-help">{t(locale, "onboarding.timezoneHelp")}</p>
                {view.onboarding.errors.timezone ? (
                  <p id="import-onboarding-timezone-error" className="field-error">{t(locale, `import.review.onboarding.${view.onboarding.errors.timezone}` as MessageKey)}</p>
                ) : null}
              </div>
            </section>
          ) : null}

          {view.groups.map((group) => (
            <details key={group.type} className="import-group" open={group.hasErrors || view.summary.total <= 12 || undefined}>
              <summary className="import-group-summary">
                <span>{typeLabel(locale, group.type)}</span>
                <span className="import-group-count">{group.candidates.length}</span>
              </summary>
              <div className="import-group-body">
                {group.candidates.map((candidate) => {
                  const row = snapshot.items.find((item) => item.id === candidate.id)!;
                  return (
                    <ImportReviewCandidate
                      key={candidate.id}
                      locale={locale}
                      candidate={candidate}
                      payload={row.payload}
                      draft={drafts[candidate.id]}
                      status={statuses[candidate.id] ?? "idle"}
                      showServerValues={reloadedConflicts.includes(candidate.id)}
                      invalidFields={invalid[candidate.id] ?? []}
                      handlers={handlers}
                      titleText={candidateTitle(locale, candidate, row.payload)}
                    />
                  );
                })}
              </div>
            </details>
          ))}
        </div>

        <aside className="import-review-aside" aria-labelledby="import-summary-title">
          <div className="app-card space-y-3">
            <h2 id="import-summary-title" className="text-lg font-semibold">{t(locale, "import.review.summaryTitle")}</h2>
            <ul className="import-summary">
              {totalTypes.map((type) => (
                <li key={type}>
                  {t(locale, "import.review.summaryRow", { type: typeLabel(locale, type), ...view.summary.byType[type] })}
                </li>
              ))}
              <li>{t(locale, "import.review.summaryConfirmed", { count: view.summary.confirmedAchievements })}</li>
              <li>{t(locale, "import.review.summaryDrafts", { count: view.summary.draftAchievements })}</li>
            </ul>
            {view.warnings.map((warning) => <p key={warning} className="import-note">{t(locale, `import.review.warning.${warning}` as MessageKey)}</p>)}
            {blockerText.length > 0 ? (
              <ul id="import-commit-reasons" className="import-blockers">
                {blockerText.map((text) => <li key={text}>{text}</li>)}
              </ul>
            ) : null}
            <Button
              disabled={!view.canCommit || committing}
              loading={committing}
              loadingLabel={t(locale, "import.review.committing")}
              aria-describedby={blockerText.length > 0 ? "import-commit-reasons" : undefined}
              onClick={() => void commit()}
            >
              {t(locale, "import.review.commit")}
            </Button>
            <div className="import-actions">{manual(false)}{cancelButton}</div>
          </div>
        </aside>
      </div>
      {cancelDialog}
    </div>
  );

}
