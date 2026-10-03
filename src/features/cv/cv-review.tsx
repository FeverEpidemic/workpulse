"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CvFreshnessState } from "@/domain/cv/contracts";
import type { ReviewChoice } from "@/domain/cv/freshness";
import { t, type Locale, type MessageKey } from "@/i18n/messages";

import { choiceKeys, reviewSummaryKey, stateBadge, type ReviewTarget } from "./cv-builder-state";

export interface ReviewRow {
  /** Already localized field name. */
  label: string;
  saved: string | null;
  live: string | null;
}

export interface CvReviewPanelProps {
  locale: Locale;
  /** DOM id of the panel; the review button points at it with aria-controls. */
  id: string;
  name: string;
  kind: "item" | "profile";
  state: CvFreshnessState;
  hasOverride: boolean;
  /** The user's own wording of an item, shown beside the two source versions. */
  overrideText: string | null;
  rows: ReviewRow[];
  contextChanged: boolean;
  choices: ReviewChoice[];
  /** Unsaved wording of this target: the actions stay off and say why. */
  blocked: boolean;
  busy: boolean;
  /** Achievement to open when its source is no longer confirmed. */
  achievementId: string | null;
  onChoose: (choice: ReviewChoice) => void;
}

/** Compares the version saved on the CV with the current source and offers only the choices that keep wording safe. */
export function CvReviewPanel(props: CvReviewPanelProps) {
  const { locale, id, name, kind, state, hasOverride, overrideText, rows, contextChanged, choices, blocked, busy, achievementId, onChoose } = props;
  const comparable = state === "changed" || state === "kept";
  const help: MessageKey | null =
    state === "deleted" ? "cv.review.deletedHelp"
    : state === "unconfirmed" ? "cv.review.unconfirmedHelp"
    : state === "kept" ? "cv.review.keptHelp"
    : kind === "profile" ? "cv.review.profileChangedHelp"
    : hasOverride ? "cv.review.changedWordingHelp"
    : "cv.review.changedHelp";
  const reasonId = `${id}-reason`;
  return (
    <div id={id} className="cv-review-panel" role="group" aria-label={t(locale, "cv.review.panelLabel", { name })} data-testid="cv-review-panel" data-state={state}>
      {help ? <p className="field-help">{t(locale, help)}</p> : null}
      {kind === "profile" && state === "changed" && hasOverride ? <p className="field-help">{t(locale, "cv.review.changedWordingHelp")}</p> : null}
      {comparable && rows.length > 0 ? (
        <table className="cv-review-table">
          <caption className="sr-only">{t(locale, "cv.review.panelLabel", { name })}</caption>
          <thead>
            <tr>
              <td />
              <th scope="col">{t(locale, "cv.review.savedOnCv")}</th>
              <th scope="col">{t(locale, "cv.review.currentSource")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                <td>{row.saved ?? t(locale, "cv.conflict.empty")}</td>
                <td>{row.live ?? t(locale, "cv.conflict.empty")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {comparable && contextChanged ? <p className="field-help">{t(locale, "cv.review.contextChanged")}</p> : null}
      {comparable && overrideText ? (
        <p className="cv-review-wording">
          <strong>{t(locale, "cv.review.yourWording")}:</strong> {overrideText}
        </p>
      ) : null}
      {state === "unconfirmed" && achievementId ? (
        <Link className="button-secondary" href={`/achievements/${achievementId}`} aria-label={t(locale, "cv.aria.openAchievement", { name })}>
          {t(locale, "cv.review.openAchievement")}
        </Link>
      ) : null}
      {choices.length > 0 ? (
        <>
          {blocked ? <p id={reasonId} className="field-help" data-testid="cv-review-blocked">{t(locale, "cv.review.disabledDraft")}</p> : null}
          <div className="cv-row-actions">
            {choices.map((choice) => {
              const keys = choiceKeys(choice.id);
              return (
                <Button
                  key={choice.id} variant={choice.primary ? "primary" : "secondary"} disabled={blocked || busy}
                  aria-label={t(locale, keys.aria, { name })} aria-describedby={blocked ? reasonId : undefined}
                  onClick={() => onChoose(choice)}
                >
                  {t(locale, keys.label)}
                </Button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Opens or closes a review panel; the label toggles and the accessible name always contains the visible text. */
export function CvReviewToggle({
  locale, id, panelId, name, open, onToggle,
}: {
  locale: Locale;
  id: string;
  panelId: string;
  name: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      id={id} variant="secondary" aria-expanded={open} aria-controls={panelId}
      aria-label={t(locale, open ? "cv.aria.reviewHide" : "cv.aria.reviewChange", { name })} onClick={onToggle}
    >
      {t(locale, open ? "cv.review.close" : "cv.review.open")}
    </Button>
  );
}

export function CvStateBadge({ locale, state }: { locale: Locale; state: CvFreshnessState }) {
  const badge = stateBadge(state);
  return badge ? <Badge variant={badge.variant}>{t(locale, badge.messageKey)}</Badge> : null;
}

export interface SummaryEntry extends ReviewTarget {
  name: string;
}

/** Lists what needs a decision, links to each entry, and offers the one safe bulk action. */
export function CvReviewSummary({
  locale, entries, bulkCount, busy, onBulk,
}: {
  locale: Locale;
  entries: SummaryEntry[];
  /** Changed items without manual wording that one batch can refresh; the action is hidden at zero. */
  bulkCount: number;
  busy: boolean;
  onBulk: () => void;
}) {
  return (
    <section id="cv-review" className="cv-panel" aria-labelledby="cv-review-heading" data-testid="cv-review-summary">
      <h2 id="cv-review-heading" tabIndex={-1} className="cv-panel-heading">{t(locale, reviewSummaryKey(entries.length), { count: entries.length })}</h2>
      <p className="field-help">{t(locale, "cv.review.summaryHelp")}</p>
      <ul className="cv-review-list" aria-label={t(locale, "cv.review.itemsLabel")}>
        {entries.map((entry) => (
          <li key={entry.itemId ?? "profile"}>
            <a href={entry.kind === "profile" ? "#cv-profile-heading" : `#cv-item-${entry.itemId}`}>{entry.name}</a>
            <CvStateBadge locale={locale} state={entry.state} />
          </li>
        ))}
      </ul>
      {bulkCount > 0 ? (
        <div>
          <Button variant="secondary" disabled={busy} onClick={onBulk}>{t(locale, "cv.action.refreshAll")}</Button>
        </div>
      ) : null}
    </section>
  );
}
