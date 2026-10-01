"use client";

import { useRouter } from "next/navigation";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { InlineError } from "@/components/ui/inline-error";
import { useUnsavedForm } from "@/components/ui/unsaved-changes";
import { CV_SECTION_KEYS, CV_PROFILE_OVERRIDE_KEYS, type CvDocumentRow, type CvItemRow, type CvLocale, type CvSectionKey } from "@/domain/cv/contracts";
import {
  changedKeys, computeItemMove, computeSectionMove, draftFromSaved, droppedEdits, isDirty, resolveConflict, syncDraft, toSaveInput,
  validateDraft, type DraftSync,
} from "@/domain/cv/draft";
import { buildCvOutline } from "@/domain/cv/outline";
import { buildCvPreviewEntry, buildCvPreviewModel } from "@/domain/cv/preview";
import { t, type Locale, type MessageKey } from "@/i18n/messages";
import { IDLE_ACTION_STATE, type ActionState } from "@/server/action-result";

import { removeCvItemAction, reorderCvSectionAction, saveCvEditsAction, selectCvSourceAction, updateCvLayoutAction } from "./actions";
import {
  achievementPlacements, announcedPosition, clientCorrelationId, deriveSaveState, firstInvalidField, initialPoolOpen, isStaleConflict,
} from "./cv-builder-state";
import { CvConflictPanel, CvProfileEditor, CvRemoveDialog, CvSaveBar, CvSettings, type ConflictField } from "./cv-panels";
import { CvPreview } from "./cv-preview";
import { CvSection, type EditorEntry, type SectionHandlers } from "./cv-section";
import type { PoolBySection, PoolOption } from "./cv-view";

export interface CvBuilderProps {
  locale: Locale;
  document: CvDocumentRow;
  items: CvItemRow[];
  pool: PoolBySection;
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

export function CvBuilder({ locale, document: doc, items, pool, highlightId }: CvBuilderProps) {
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
  const busyRef = useRef(false);
  const pendingFocus = useRef<(() => void) | null>(null);
  const conflictRef = useRef<HTMLDivElement>(null);
  const { markDirty, markClean } = useUnsavedForm("cv-builder");

  const entries = useMemo(() => toEditorEntries(doc, items), [doc, items]);
  const model = useMemo(() => buildCvPreviewModel({ document: doc, items }), [doc, items]);
  const problems = useMemo(() => validateDraft(sync.draft), [sync.draft]);
  const placements = useMemo(() => achievementPlacements(entries), [entries]);
  const dirty = isDirty(sync.base, sync.draft);
  const { status, canSave, showConflict } = deriveSaveState({ saving, busy, dirty, conflict, unresolved: sync.unresolved, problems });

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

  const headlineOf = useCallback((itemId: string) => {
    const row = items.find((item) => item.id === itemId);
    return row ? buildCvPreviewEntry(row, doc.locale, row.source_deleted).headline : itemId;
  }, [items, doc.locale]);

  function fail(state: ActionState) {
    if (state.status !== "error") return;
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
    onSuccess: () => void,
  ): Promise<ActionState | null> {
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const state = await action(IDLE_ACTION_STATE, data);
      if (state.status === "success") {
        const next = (state.data as { cvRevision?: number } | undefined)?.cvRevision;
        if (typeof next === "number") setLocalRevision(next);
        onSuccess();
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
        <CvProfileEditor locale={locale} draft={sync.draft} sourceValues={sourceValues} problems={problems} onDraftChange={onDraftChange} />
        {doc.section_order.map((key) => (
          <CvSection key={key} sectionKey={key} entries={entries[key]} pool={pool[key]} handlers={handlers(key)} />
        ))}
      </div>
      <div className="cv-preview-column">
        <CvPreview model={model} locale={locale} dirty={dirty} />
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
