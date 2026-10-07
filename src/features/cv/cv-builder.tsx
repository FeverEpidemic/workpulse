"use client";

import { useRouter } from "next/navigation";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { InlineError } from "@/components/ui/inline-error";
import { useUnsavedForm } from "@/components/ui/unsaved-changes";
import {
  CV_SECTION_KEYS, CV_PROFILE_OVERRIDE_KEYS, type CvDocumentRow, type CvFreshnessRow, type CvItemRow, type CvLocale, type CvProfileLive, type CvSectionKey,
} from "@/domain/cv/contracts";
import {
  changedKeys, computeItemMove, computeSectionMove, draftFromSaved, droppedEdits, isDirty, resolveConflict, syncDraft, toSaveInput,
  validateDraft, type DraftSync,
} from "@/domain/cv/draft";
import { availableActions, bulkRefreshResolutions, diffProfileFields, indexFreshness, type ReviewChoice } from "@/domain/cv/freshness";
import { buildCvOutline } from "@/domain/cv/outline";
import { buildCvPreviewEntry, buildCvPreviewModel } from "@/domain/cv/preview";
import { t, type Locale, type MessageKey } from "@/i18n/messages";
import { IDLE_ACTION_STATE, type ActionState } from "@/server/action-result";

import {
  removeCvItemAction, reorderCvSectionAction, resolveCvFreshnessAction, saveCvEditsAction, selectCvSourceAction, updateCvLayoutAction,
} from "./actions";
import {
  achievementPlacements, announcedPosition, BULK_FOCUS_CANDIDATES, choiceKeys, clientCorrelationId, deriveSaveState, firstInvalidField,
  initialPoolOpen, isReviewBlocked, isSourceChangedConflict, isStaleConflict, previewLinkState, reviewFocusCandidates, reviewTargets, singleResolution,
} from "./cv-builder-state";
import { CvConflictPanel, CvProfileEditor, CvRemoveDialog, CvSaveBar, CvSettings, type ConflictField, type ProfileReview } from "./cv-panels";
import { CvReviewSummary } from "./cv-review";
import { CvExportLink, CvPreview } from "./cv-preview";
import { CvSection, type EditorEntry, type SectionHandlers } from "./cv-section";
import type { PoolBySection, PoolOption } from "./cv-view";

export interface CvBuilderProps {
  locale: Locale;
  document: CvDocumentRow;
  items: CvItemRow[];
  pool: PoolBySection;
  /** Freshness of every item and of the profile (T20); computed by the database, never written when a record is edited. */
  freshness?: CvFreshnessRow[];
  /** An unselected confirmed achievement to suggest (Add to CV); never added automatically. */
  highlightId: string | null;
}

type Notice = { messageKey: MessageKey; correlationId: string };
type RemoveTarget = { itemId: string; sectionKey: CvSectionKey; name: string; childNames: string[] };

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const entry of Array.isArray(value) ? value : [value]) data.append(name, entry);
  }
  return data;
}

function toEditorEntries(document: CvDocumentRow, items: CvItemRow[]): Record<CvSectionKey, EditorEntry[]> {
  const outline = buildCvOutline({ sectionOrder: document.section_order, items });
  const make = (item: CvItemRow, deleted: boolean, index: number, total: number): EditorEntry => ({
    ...buildCvPreviewEntry(item, document.locale, deleted), row: item, children: [], first: index === 0, last: index === total - 1,
  });
  const result = {} as Record<CvSectionKey, EditorEntry[]>;
  for (const key of CV_SECTION_KEYS) result[key] = [];
  for (const section of outline.sections) {
    result[section.key] = section.entries.map((entry, index) => ({
      ...make(entry.item, entry.deleted, index, section.entries.length),
      children: entry.children.map((child, childIndex) => make(child, child.source_deleted, childIndex, entry.children.length)),
    }));
  }
  return result;
}

export function CvBuilder({ locale, document: doc, items, pool, highlightId, freshness = [] }: CvBuilderProps) {
  const router = useRouter();
  const savedKey = `${doc.revision}:${items.map((item) => `${item.id}@${item.revision}`).join(",")}`;
  const savedDraft = useMemo(() => draftFromSaved(doc, items), [doc, items]);
  const [sync, setSync] = useState<DraftSync>(() => ({ base: savedDraft, draft: savedDraft, unresolved: [] }));
  const [seenKey, setSeenKey] = useState(savedKey);
  // Wording typed for items that were removed elsewhere cannot be saved; the count is shown, not lost silently.
  const [droppedCount, setDroppedCount] = useState(0);
  // A newly loaded saved CV merges into the draft during render so the typed text is never dropped.
  if (seenKey !== savedKey) {
    setSeenKey(savedKey);
    const dropped = droppedEdits({ base: sync.base, draft: sync.draft, saved: savedDraft }).length;
    if (dropped > 0) setDroppedCount(dropped);
    setSync(syncDraft({ base: sync.base, draft: sync.draft, unresolved: sync.unresolved, saved: savedDraft }));
  }

  const [localRevision, setLocalRevision] = useState(doc.revision);
  const revision = Math.max(doc.revision, localRevision);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [openEditors, setOpenEditors] = useState<ReadonlySet<string>>(new Set());
  // A list opens for an empty section or a suggested record on first load, then only follows the user.
  const [poolOpen, setPoolOpen] = useState<Record<CvSectionKey, boolean>>(() => {
    const initial = toEditorEntries(doc, items);
    return initialPoolOpen(CV_SECTION_KEYS, (key) => initial[key].length, (key) => pool[key].some((option) => option.sourceId === highlightId));
  });
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null);
  // Review panels are closed until the user opens one; "profile" is the key of the profile panel.
  const [openReviews, setOpenReviews] = useState<ReadonlySet<string>>(new Set());
  const [infoNotice, setInfoNotice] = useState("");
  const busyRef = useRef(false);
  const pendingFocus = useRef<(() => void) | null>(null);
  const conflictRef = useRef<HTMLDivElement>(null);
  const { markDirty, markClean } = useUnsavedForm("cv-builder");

  const entries = useMemo(() => toEditorEntries(doc, items), [doc, items]);
  const model = useMemo(() => buildCvPreviewModel({ document: doc, items }), [doc, items]);
  const problems = useMemo(() => validateDraft(sync.draft), [sync.draft]);
  const placements = useMemo(() => achievementPlacements(entries), [entries]);
  const dirty = isDirty(sync.base, sync.draft);
  const dirtyKeys = useMemo(() => changedKeys(sync.base, sync.draft), [sync.base, sync.draft]);
  const freshnessIndex = useMemo(() => indexFreshness(freshness), [freshness]);
  const { status, canSave, showConflict } = deriveSaveState({ saving, busy, dirty, conflict, unresolved: sync.unresolved, problems });
  const previewLink = previewLinkState(status);

  useEffect(() => {
    if (dirty) markDirty();
    else markClean();
  }, [dirty, markDirty, markClean]);

  // Focus follows the item the user just acted on once the reloaded CV is on screen.
  useEffect(() => {
    const focus = pendingFocus.current;
    pendingFocus.current = null;
    focus?.();
  }, [savedKey]);

  useEffect(() => {
    if (showConflict) conflictRef.current?.focus();
  }, [showConflict]);

  // The dashboard links to the list of achievements that are not on the CV yet; open it on arrival.
  useEffect(() => {
    if (window.location.hash !== "#cv-pool-achievements") return;
    const list = window.document.getElementById("cv-pool-achievements");
    // Opening the element fires its toggle event, which keeps the React state in step.
    if (list instanceof HTMLDetailsElement) list.open = true;
    list?.scrollIntoView({ block: "start" });
  }, []);

  const headlineOf = useCallback((itemId: string) => {
    const row = items.find((item) => item.id === itemId);
    return row ? buildCvPreviewEntry(row, doc.locale, row.source_deleted).headline : itemId;
  }, [items, doc.locale]);

  function fail(state: ActionState) {
    if (state.status !== "error") return;
    if (isSourceChangedConflict(state)) {
      // A record changed again while it was being reviewed: reload, keep every other draft, ask again.
      setNotice({ messageKey: "cv.notice.sourceChangedAgain", correlationId: state.error.correlationId });
      setOpenReviews(new Set());
      startTransition(() => router.refresh());
      return;
    }
    if (isStaleConflict(state)) {
      setConflict(true);
      setNotice(null);
      startTransition(() => router.refresh());
      return;
    }
    setNotice({ messageKey: state.error.messageKey, correlationId: state.error.correlationId });
  }

  async function runOperation(
    action: (previous: ActionState, data: FormData) => Promise<ActionState>,
    data: FormData,
    onSuccess: (state: ActionState) => void,
  ): Promise<ActionState | null> {
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    setInfoNotice("");
    try {
      const state = await action(IDLE_ACTION_STATE, data);
      if (state.status === "success") {
        const next = (state.data as { cvRevision?: number } | undefined)?.cvRevision;
        if (typeof next === "number") setLocalRevision(next);
        onSuccess(state);
        startTransition(() => router.refresh());
      } else {
        pendingFocus.current = null;
        fail(state);
      }
      return state;
    } catch {
      pendingFocus.current = null;
      setNotice({ messageKey: "error.unavailable", correlationId: clientCorrelationId() });
      return null;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const onDraftChange = (key: string, value: string) => {
    setConflict(false);
    setDroppedCount(0);
    setSync((current) => ({ ...current, draft: { ...current.draft, [key]: value } }));
  };

  const onAdd = (option: PoolOption) => {
    void runOperation(
      selectCvSourceAction,
      form({ expected_revision: String(revision), source_type: option.sourceType, source_id: option.sourceId }),
      () => setAnnouncement(t(locale, "cv.announce.added", { name: option.label })),
    );
  };

  const focusMove = (itemId: string, direction: "up" | "down") => () => {
    const primary = window.document.getElementById(`cv-move-${itemId}-${direction}`) as HTMLButtonElement | null;
    const other = window.document.getElementById(`cv-move-${itemId}-${direction === "up" ? "down" : "up"}`);
    (primary && !primary.disabled ? primary : other)?.focus();
  };

  const siblingsOf = (itemId: string): EditorEntry[] => {
    for (const list of Object.values(entries)) {
      if (list.some((entry) => entry.itemId === itemId)) return list;
      const parent = list.find((entry) => entry.children.some((child) => child.itemId === itemId));
      if (parent) return parent.children;
    }
    return [];
  };

  const onMoveItem = (itemId: string, direction: "up" | "down") => {
    const move = computeItemMove(items, itemId, direction, doc.section_order);
    if (!move) return;
    const group = siblingsOf(itemId);
    const position = announcedPosition(group.findIndex((entry) => entry.itemId === itemId), direction);
    pendingFocus.current = focusMove(itemId, direction);
    void runOperation(
      reorderCvSectionAction,
      form({ expected_revision: String(revision), section_key: move.sectionKey, item_id: move.itemIds }),
      () => setAnnouncement(t(locale, "cv.announce.moved", { name: headlineOf(itemId), position, total: group.length })),
    );
  };

  const onMoveSection = (key: CvSectionKey, direction: "up" | "down") => {
    const next = computeSectionMove(doc.section_order, key, direction);
    if (!next) return;
    pendingFocus.current = () => {
      const primary = window.document.getElementById(`cv-section-move-${key}-${direction}`) as HTMLButtonElement | null;
      const other = window.document.getElementById(`cv-section-move-${key}-${direction === "up" ? "down" : "up"}`);
      (primary && !primary.disabled ? primary : other)?.focus();
    };
    void runOperation(
      updateCvLayoutAction,
      form({ expected_revision: String(revision), section: next }),
      () => setAnnouncement(t(locale, "cv.announce.sectionMoved", {
        section: t(locale, `cv.section.${key}` as MessageKey), position: next.indexOf(key) + 1, total: next.length,
      })),
    );
  };

  const onLocaleChange = (value: CvLocale) => {
    void runOperation(
      updateCvLayoutAction,
      form({ expected_revision: String(revision), locale: value }),
      () => setAnnouncement(t(locale, "cv.announce.languageChanged")),
    );
  };

  const removeItem = (target: RemoveTarget, removeChildren: boolean) => {
    pendingFocus.current = () => window.document.getElementById(`cv-section-heading-${target.sectionKey}`)?.focus();
    void runOperation(
      removeCvItemAction,
      form({ expected_revision: String(revision), item_id: target.itemId, remove_children: String(removeChildren) }),
      () => {
        setRemoveTarget(null);
        setAnnouncement(t(locale, "cv.announce.removed", { name: target.name }));
      },
    ).then((state) => {
      // A child appeared since the page loaded: ask instead of removing silently.
      if (state?.status === "error" && state.error.messageKey === "cv.error.childItemsExist") {
        const ids = (state.error.latestRecord as { childItemIds?: string[] } | undefined)?.childItemIds ?? [];
        setNotice(null);
        setRemoveTarget({ ...target, childNames: ids.map(headlineOf) });
      }
    });
  };

  const onRemove = (entry: EditorEntry) => {
    const target: RemoveTarget = { itemId: entry.itemId, sectionKey: entry.row.section_key, name: entry.headline, childNames: entry.children.map((child) => child.headline) };
    if (target.childNames.length > 0) {
      setRemoveTarget(target);
      return;
    }
    removeItem(target, false);
  };

  const focusFirst = (ids: readonly string[]) => () => {
    for (const id of ids) {
      const element = window.document.getElementById(id);
      if (element) {
        element.focus();
        return;
      }
    }
  };

  const toggleReview = (key: string) => setOpenReviews((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  const afterResolution = (key: string, announcement: string, state: ActionState) => {
    const added = (state.status === "success" ? (state.data as { addedParentItemIds?: string[] } | undefined)?.addedParentItemIds : undefined) ?? [];
    const parentNote = added.length > 0 ? t(locale, "cv.notice.parentAdded", { count: added.length }) : "";
    setOpenReviews((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
    setAnnouncement(parentNote ? `${announcement} ${parentNote}` : announcement);
    setInfoNotice(parentNote);
  };

  /** One explicit choice for one item or for the profile; the revision sent is the live one the user is looking at. */
  const onChoose = (target: { kind: "item" | "profile"; itemId: string | null }, choice: ReviewChoice) => {
    const entry = target.kind === "profile" ? freshnessIndex.profile : freshnessIndex.items.get(target.itemId ?? "");
    if (!entry) return;
    const resolution = singleResolution(target, entry, choice);
    if (!resolution) return;
    const name = target.kind === "profile" ? t(locale, "cv.review.profileLabel") : headlineOf(target.itemId ?? "");
    const sectionKey = target.itemId ? items.find((item) => item.id === target.itemId)?.section_key ?? null : null;
    pendingFocus.current = focusFirst(reviewFocusCandidates(target, sectionKey));
    void runOperation(
      resolveCvFreshnessAction,
      form({ expected_revision: String(revision), resolutions: JSON.stringify([resolution]) }),
      (state) => afterResolution(target.kind === "profile" ? "profile" : target.itemId ?? "", t(locale, choiceKeys(choice.id).announce, { name }), state),
    );
  };

  // Items whose wording is being edited are left out; a bulk refresh never runs over unsaved text.
  const bulkResolutions = useMemo(
    () => bulkRefreshResolutions(freshness, items).filter((resolution) => resolution.target !== "item" || !dirtyKeys.includes(`item.${resolution.item_id}`)),
    [freshness, items, dirtyKeys],
  );

  const onBulk = () => {
    if (bulkResolutions.length === 0) return;
    pendingFocus.current = focusFirst(BULK_FOCUS_CANDIDATES);
    const resolutions = bulkResolutions;
    const count = resolutions.length;
    void runOperation(
      resolveCvFreshnessAction,
      form({ expected_revision: String(revision), resolutions: JSON.stringify(resolutions) }),
      (state) => {
        afterResolution("", t(locale, "cv.announce.refreshedAll", { count }), state);
        // Only the panels of the refreshed items close; a panel still waiting for a decision stays open.
        const refreshed = new Set(resolutions.flatMap((resolution) => (resolution.target === "item" ? [resolution.item_id] : [])));
        setOpenReviews((current) => new Set([...current].filter((key) => !refreshed.has(key))));
      },
    );
  };

  const profileEntry = freshnessIndex.profile;
  const liveProfile = profileEntry?.liveSnapshot && !("source_type" in profileEntry.liveSnapshot) ? (profileEntry.liveSnapshot as CvProfileLive) : null;
  const profileHasOverride = Object.keys(doc.profile_snapshot.display_overrides ?? {}).length > 0 || doc.summary_override !== null;
  const profileReview: ProfileReview | null = profileEntry && profileEntry.state !== "fresh" ? {
    state: profileEntry.state,
    open: openReviews.has("profile"),
    blocked: isReviewBlocked({ kind: "profile", itemId: null }, dirtyKeys),
    busy,
    hasOverride: profileHasOverride,
    rows: liveProfile
      ? diffProfileFields(doc.profile_snapshot, liveProfile).map((entry) => ({ label: t(locale, `cv.profile.${entry.field}` as MessageKey), saved: entry.saved, live: entry.live }))
      : [],
    choices: availableActions({ state: profileEntry.state, hasOverride: profileHasOverride, target: "profile" }),
    onToggle: () => toggleReview("profile"),
    onChoose: (choice) => onChoose({ kind: "profile", itemId: null }, choice),
  } : null;

  const summaryEntries = reviewTargets(freshness).map((target) => ({
    ...target,
    name: target.kind === "profile" ? t(locale, "cv.review.profileLabel") : headlineOf(target.itemId ?? ""),
  }));

  async function onSave() {
    const invalid = firstInvalidField(problems);
    if (invalid) {
      const { openItemId, elementId } = invalid;
      if (openItemId) setOpenEditors((current) => new Set(current).add(openItemId));
      window.setTimeout(() => window.document.getElementById(elementId)?.focus(), 0);
      return;
    }
    const input = toSaveInput(sync.base, sync.draft, revision);
    if (!input || busyRef.current) return;
    const { expected_revision: expectedRevision, ...edits } = input;
    const sentKeys = changedKeys(sync.base, sync.draft);
    busyRef.current = true;
    setBusy(true);
    setSaving(true);
    setNotice(null);
    try {
      const state = await saveCvEditsAction(IDLE_ACTION_STATE, form({ expected_revision: String(expectedRevision), edits: JSON.stringify(edits) }));
      if (state.status === "success") {
        const next = (state.data as { cvRevision?: number } | undefined)?.cvRevision;
        if (typeof next === "number") setLocalRevision(next);
        setSync((current) => ({ ...current, base: { ...current.base, ...Object.fromEntries(sentKeys.map((key) => [key, current.draft[key] ?? ""])) } }));
        setConflict(false);
        setDroppedCount(0);
        setAnnouncement(t(locale, "cv.announce.saved"));
        startTransition(() => router.refresh());
      } else {
        fail(state);
      }
    } catch {
      setNotice({ messageKey: "error.unavailable", correlationId: clientCorrelationId() });
    } finally {
      busyRef.current = false;
      setBusy(false);
      setSaving(false);
    }
  }

  const conflictFields: ConflictField[] = sync.unresolved.map((key) => ({
    key,
    label: key === "title" ? t(locale, "cv.conflict.field.title")
      : key === "summary" ? t(locale, "cv.conflict.field.summary")
      : key.startsWith("profile.") ? t(locale, `cv.profile.${key.slice(8)}` as MessageKey)
      : headlineOf(key.slice(5)),
    mine: sync.draft[key] ?? "",
    saved: savedDraft[key] ?? "",
  }));

  const handlers = (key: CvSectionKey): SectionHandlers => ({
    locale,
    draft: sync.draft,
    problems,
    openEditors,
    highlightId,
    placements,
    review: {
      entries: freshnessIndex.items, cvLocale: doc.locale, open: openReviews, busy,
      blocked: (itemId) => isReviewBlocked({ kind: "item", itemId }, dirtyKeys),
      onToggle: toggleReview,
      onChoose: (itemId, choice) => onChoose({ kind: "item", itemId }, choice),
    },
    onToggleEditor: (itemId) => setOpenEditors((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    }),
    onDraftChange,
    onAdd,
    onRemove,
    onMoveItem,
    poolOpen: poolOpen[key],
    onTogglePool: (open) => setPoolOpen((current) => ({ ...current, [key]: open })),
  });

  const totalSelected = items.length;
  const sourceValues: Record<string, string | null> = {
    ...Object.fromEntries(CV_PROFILE_OVERRIDE_KEYS.map((key) => [key, doc.profile_snapshot[key] ?? null])),
    summary: doc.profile_snapshot.summary ?? null,
  };

  return (
    <div className="cv-layout" data-testid="cv-builder">
      <div className="cv-editor">
        <CvSaveBar locale={locale} status={status} canSave={canSave} onSave={() => void onSave()} />
        <p className="field-help">{t(locale, "cv.saveHint")}</p>
        <p className="sr-only" role="status" aria-live="polite" data-testid="cv-announcer">{announcement}</p>
        {notice ? (
          <InlineError correlationId={notice.correlationId || undefined}>
            <p>{t(locale, notice.messageKey)}</p>
          </InlineError>
        ) : null}
        {infoNotice ? <p className="ui-message" role="status" data-testid="cv-info-notice">{infoNotice}</p> : null}
        {droppedCount > 0 ? (
          <p className="ui-message space-y-2" role="status" data-testid="cv-dropped-notice">
            {t(locale, "cv.notice.droppedWording", { count: droppedCount })}
          </p>
        ) : null}
        {showConflict ? (
          <CvConflictPanel
            locale={locale} fields={conflictFields} headingRef={conflictRef}
            onResolve={(key, choice) => setSync((current) => resolveConflict(current, key, choice, savedDraft))}
          />
        ) : null}
        {summaryEntries.length > 0 ? (
          <CvReviewSummary locale={locale} entries={summaryEntries} bulkCount={bulkResolutions.length} busy={busy} onBulk={onBulk} />
        ) : null}
        {totalSelected === 0 ? (
          <section className="cv-panel" aria-labelledby="cv-empty-title">
            <h2 id="cv-empty-title" className="cv-panel-heading">{t(locale, "cv.empty.title")}</h2>
            <p className="field-help">{t(locale, "cv.empty.description")}</p>
          </section>
        ) : null}
        <CvSettings
          locale={locale} cvLocale={doc.locale} order={doc.section_order} draft={sync.draft} problems={problems}
          onDraftChange={onDraftChange} onLocaleChange={onLocaleChange} onMoveSection={onMoveSection}
        />
        <CvProfileEditor locale={locale} draft={sync.draft} sourceValues={sourceValues} problems={problems} onDraftChange={onDraftChange} review={profileReview} />
        {doc.section_order.map((key) => (
          <CvSection key={key} sectionKey={key} entries={entries[key]} pool={pool[key]} handlers={handlers(key)} />
        ))}
      </div>
      <div className="cv-preview-column">
        <CvPreview
          model={model} locale={locale} dirty={dirty}
          action={<CvExportLink locale={locale} disabled={previewLink.disabled} reasonKey={previewLink.reasonKey} />}
        />
      </div>
      <CvRemoveDialog
        locale={locale} open={removeTarget !== null} busy={busy}
        name={removeTarget?.name ?? ""} childNames={removeTarget?.childNames ?? []}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => { if (removeTarget) removeItem(removeTarget, true); }}
      />
    </div>
  );
}
