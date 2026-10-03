"use client";

import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useEffect } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field-control";
import type { CvLocale, CvSectionKey } from "@/domain/cv/contracts";
import { itemKey, type CvDraft, type DraftProblem } from "@/domain/cv/draft";
import { availableActions, diffDisplayFields, type FreshnessEntry, type ReviewChoice } from "@/domain/cv/freshness";
import type { CvPreviewEntry } from "@/domain/cv/preview";
import { supportsOverride, sourceItemText } from "@/domain/cv/resolve";
import type { CvItemRow } from "@/domain/cv/contracts";
import { t, type Locale, type MessageKey } from "@/i18n/messages";

import { FieldProblem } from "./cv-panels";
import { CvReviewPanel, CvReviewToggle, CvStateBadge } from "./cv-review";
import type { PoolOption } from "./cv-view";

export interface EditorEntry extends CvPreviewEntry {
  row: CvItemRow;
  children: EditorEntry[];
  /** Position among siblings that move together, for the edge state of the move buttons. */
  first: boolean;
  last: boolean;
}

/** Freshness review of an item: what the database says, which panels are open, and what choosing does. */
export interface ReviewHandlers {
  entries: ReadonlyMap<string, FreshnessEntry>;
  /** Dates in the comparison follow the CV locale, not the interface locale. */
  cvLocale: CvLocale;
  open: ReadonlySet<string>;
  busy: boolean;
  blocked: (itemId: string) => boolean;
  onToggle: (itemId: string) => void;
  onChoose: (itemId: string, choice: ReviewChoice) => void;
}

export interface SectionHandlers {
  locale: Locale;
  draft: CvDraft;
  problems: Record<string, DraftProblem>;
  openEditors: ReadonlySet<string>;
  highlightId: string | null;
  /** Selected achievements rendered under a parent entry, with that parent's headline. */
  placements: Readonly<Record<string, string>>;
  review: ReviewHandlers;
  onToggleEditor: (itemId: string) => void;
  onDraftChange: (key: string, value: string) => void;
  onAdd: (option: PoolOption) => void;
  onRemove: (entry: EditorEntry) => void;
  onMoveItem: (itemId: string, direction: "up" | "down") => void;
  poolOpen: boolean;
  onTogglePool: (open: boolean) => void;
}

function ItemRow({ entry, handlers, nested }: { entry: EditorEntry; handlers: SectionHandlers; nested: boolean }) {
  const { locale, draft, problems, openEditors } = handlers;
  const name = entry.headline;
  const editable = supportsOverride(entry.row.source_snapshot);
  const editing = editable && openEditors.has(entry.itemId);
  const key = itemKey(entry.itemId);
  const value = draft[key] ?? "";
  const source = sourceItemText(entry.row.source_snapshot);
  const manual = value.trim() !== "" || entry.hasOverride;
  const meta = [entry.subline, entry.dates].filter(Boolean).join(" · ");
  const { review } = handlers;
  const live = review.entries.get(entry.itemId);
  const state = live?.state ?? "fresh";
  const reviewable = state !== "fresh";
  const reviewOpen = reviewable && review.open.has(entry.itemId);
  const liveSnapshot = live?.liveSnapshot && "source_type" in live.liveSnapshot ? live.liveSnapshot : null;
  const diff = liveSnapshot ? diffDisplayFields(entry.row.source_snapshot, liveSnapshot, review.cvLocale) : { fields: [], contextChanged: false };
  const sourceSnapshot = entry.row.source_snapshot;
  return (
    <li id={`cv-item-${entry.itemId}`} className={nested ? "cv-item cv-item-child" : "cv-item"} data-testid="cv-item" data-item-id={entry.itemId} data-freshness={state}>
      <div className="cv-item-main">
        <div className="cv-item-text">
          <p className="cv-item-title">
            <span id={`cv-item-name-${entry.itemId}`}>{name}</span>
            {manual ? <Badge variant="neutral">{t(locale, "cv.badge.manual")}</Badge> : null}
            {entry.deleted ? <Badge variant="warning">{t(locale, "cv.badge.sourceDeleted")}</Badge> : null}
            {state !== "deleted" ? <CvStateBadge locale={locale} state={state} /> : null}
          </p>
          {meta ? <p className="field-help">{meta}</p> : null}
          {entry.deleted ? <p className="field-help">{t(locale, "cv.item.deletedHelp")}</p> : null}
        </div>
        <div className="cv-row-actions">
          {reviewable ? (
            <CvReviewToggle
              locale={locale} id={`cv-review-open-${entry.itemId}`} panelId={`cv-review-${entry.itemId}`} name={name}
              open={reviewOpen} onToggle={() => review.onToggle(entry.itemId)}
            />
          ) : null}
          {editable ? (
            <Button
              variant="secondary" aria-expanded={editing} aria-controls={`cv-wording-${entry.itemId}`}
              aria-label={t(locale, "cv.aria.editWording", { name })} onClick={() => handlers.onToggleEditor(entry.itemId)}
            >
              {editing ? t(locale, "cv.action.doneEditing") : t(locale, "cv.action.editWording")}
            </Button>
          ) : null}
          <IconButton
            id={`cv-move-${entry.itemId}-up`} aria-label={t(locale, "cv.aria.moveItemUp", { name })}
            disabled={entry.first} onClick={() => handlers.onMoveItem(entry.itemId, "up")}
          ><ArrowUp aria-hidden="true" size={16} /></IconButton>
          <IconButton
            id={`cv-move-${entry.itemId}-down`} aria-label={t(locale, "cv.aria.moveItemDown", { name })}
            disabled={entry.last} onClick={() => handlers.onMoveItem(entry.itemId, "down")}
          ><ArrowDown aria-hidden="true" size={16} /></IconButton>
          <IconButton
            id={`cv-remove-${entry.itemId}`} aria-label={t(locale, "cv.aria.remove", { name })}
            onClick={() => handlers.onRemove(entry)}
          ><Trash2 aria-hidden="true" size={16} /></IconButton>
        </div>
      </div>
      {reviewOpen ? (
        <CvReviewPanel
          locale={locale} id={`cv-review-${entry.itemId}`} name={name} kind="item" state={state}
          hasOverride={entry.row.override_text !== null} overrideText={entry.row.override_text}
          rows={diff.fields.map((field) => ({ label: t(locale, `cv.review.field.${field.field}` as MessageKey), saved: field.saved, live: field.live }))}
          contextChanged={diff.contextChanged}
          choices={availableActions({ state, hasOverride: entry.row.override_text !== null, target: "item" })}
          blocked={review.blocked(entry.itemId)} busy={review.busy}
          achievementId={sourceSnapshot.source_type === "achievement" ? sourceSnapshot.source_id : null}
          onChoose={(choice) => review.onChoose(entry.itemId, choice)}
        />
      ) : null}
      {editing ? (
        <div id={`cv-wording-${entry.itemId}`} className="cv-wording">
          <label className="field-label" htmlFor={`cv-wording-input-${entry.itemId}`}>{t(locale, "cv.item.wordingLabel", { name })}
            <Textarea
              id={`cv-wording-input-${entry.itemId}`} rows={4} value={value} placeholder={source ?? ""}
              aria-invalid={problems[key] ? true : undefined}
              aria-describedby={`cv-wording-help-${entry.itemId} cv-wording-problem-${entry.itemId}`}
              onChange={(event) => handlers.onDraftChange(key, event.currentTarget.value)}
            />
          </label>
          <FieldProblem id={`cv-wording-problem-${entry.itemId}`} locale={locale} problem={problems[key]} />
          <p id={`cv-wording-help-${entry.itemId}`} className="field-help">{t(locale, "cv.item.wordingHelp")}</p>
          <p className="field-help"><strong>{t(locale, "cv.item.sourceWording")}:</strong> {source ?? t(locale, "cv.item.noSourceText")}</p>
          {value !== "" ? (
            <Button variant="ghost" aria-label={t(locale, "cv.aria.useSource", { name })} onClick={() => handlers.onDraftChange(key, "")}>
              {t(locale, "cv.action.useSource")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {entry.children.length > 0 ? (
        <ul className="cv-item-children">
          {entry.children.map((child) => <ItemRow key={child.itemId} entry={child} handlers={handlers} nested />)}
        </ul>
      ) : null}
    </li>
  );
}

function PoolRow({ option, handlers }: { option: PoolOption; handlers: SectionHandlers }) {
  const { locale } = handlers;
  const suggested = handlers.highlightId === option.sourceId;
  const placedUnder = option.selected && option.sourceType === "achievement" ? handlers.placements[option.sourceId] : undefined;
  useEffect(() => {
    if (!suggested) return;
    const target = document.getElementById(`cv-add-${option.sourceId}`);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
    target?.focus();
  }, [suggested, option.sourceId]);
  return (
    <li className="cv-pool-row" data-testid="cv-pool-row" aria-current={suggested ? "true" : undefined}>
      <div className="cv-item-text">
        <p className="cv-item-title">
          <span>{option.label}</span>
          {suggested ? <Badge variant="success">{t(locale, "cv.badge.suggested")}</Badge> : null}
        </p>
        {option.detail ? <p className="field-help">{option.detail}</p> : null}
        {placedUnder ? <p className="field-help" data-testid="cv-pool-placement">{t(locale, "cv.pool.shownUnder", { name: placedUnder })}</p> : null}
      </div>
      <Button
        id={`cv-add-${option.sourceId}`} variant="secondary" aria-disabled={option.selected || undefined}
        aria-label={t(locale, option.selected ? "cv.aria.added" : "cv.aria.add", { name: option.label })}
        onClick={() => { if (!option.selected) handlers.onAdd(option); }}
      >
        {t(locale, option.selected ? "cv.action.added" : "cv.action.add")}
      </Button>
    </li>
  );
}

export function CvSection({
  sectionKey, entries, pool, handlers,
}: {
  sectionKey: CvSectionKey;
  entries: EditorEntry[];
  pool: PoolOption[];
  handlers: SectionHandlers;
}) {
  const { locale } = handlers;
  const heading = t(locale, `cv.section.${sectionKey}` as MessageKey);
  const available = pool.filter((option) => !option.selected).length;
  return (
    <section className="cv-panel cv-section" aria-labelledby={`cv-section-heading-${sectionKey}`} data-section={sectionKey}>
      <header className="cv-section-header">
        <h2 id={`cv-section-heading-${sectionKey}`} tabIndex={-1} className="cv-panel-heading">{heading}</h2>
        <span className="field-help">{t(locale, "cv.section.count", { count: entries.length + entries.reduce((sum, entry) => sum + entry.children.length, 0) })}</span>
      </header>
      {entries.length === 0 ? <p className="field-help">{t(locale, "cv.section.empty")}</p> : (
        <ul className="cv-item-list">
          {entries.map((entry) => <ItemRow key={entry.itemId} entry={entry} handlers={handlers} nested={false} />)}
        </ul>
      )}
      <details id={`cv-pool-${sectionKey}`} className="cv-pool" open={handlers.poolOpen} onToggle={(event) => handlers.onTogglePool(event.currentTarget.open)}>
        <summary>{t(locale, "cv.section.available", { count: available })}</summary>
        {pool.length === 0 ? <p className="field-help">{t(locale, "cv.section.poolEmpty")}</p> : (
          <ul className="cv-pool-list">
            {pool.map((option) => <PoolRow key={option.sourceId} option={option} handlers={handlers} />)}
          </ul>
        )}
      </details>
    </section>
  );
}
