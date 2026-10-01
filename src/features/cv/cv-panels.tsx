"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import type { RefObject } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/field-control";
import { RevisionConflict } from "@/components/ui/revision-conflict";
import { CV_LOCALES, CV_PROFILE_OVERRIDE_KEYS, type CvLocale, type CvSectionKey } from "@/domain/cv/contracts";
import { profileKey, SUMMARY_KEY, TITLE_KEY, type CvDraft, type DraftProblem } from "@/domain/cv/draft";
import { t, type Locale, type MessageKey } from "@/i18n/messages";

import type { SaveStatus } from "./cv-builder-state";

const problemKey = (problem: DraftProblem): MessageKey =>
  problem === "required" ? "cv.validation.required" : problem === "too_long" ? "cv.validation.tooLong" : "cv.validation.invalid";

export function FieldProblem({ id, locale, problem }: { id: string; locale: Locale; problem: DraftProblem | undefined }) {
  return problem ? <p id={id} className="field-error" role="status">{t(locale, problemKey(problem))}</p> : <span id={id} className="sr-only" />;
}

export type { SaveStatus };

export function CvSaveBar({ locale, status, canSave, onSave }: { locale: Locale; status: SaveStatus; canSave: boolean; onSave: () => void }) {
  const label: Record<SaveStatus, MessageKey> = {
    saved: "cv.status.saved", unsaved: "cv.status.unsaved", saving: "cv.status.saving", conflict: "cv.status.conflict",
  };
  return (
    <div className="cv-save-bar">
      <p className="cv-save-status" role="status" aria-live="polite" data-status={status}>
        <Badge variant={status === "saved" ? "success" : "warning"}>{t(locale, label[status])}</Badge>
      </p>
      <Button variant="primary" disabled={!canSave} loading={status === "saving"} loadingLabel={t(locale, "cv.saving")} onClick={onSave}>
        {t(locale, "cv.save")}
      </Button>
    </div>
  );
}

export function CvSettings({
  locale, cvLocale, order, draft, problems, onDraftChange, onLocaleChange, onMoveSection,
}: {
  locale: Locale;
  cvLocale: CvLocale;
  order: readonly CvSectionKey[];
  draft: CvDraft;
  problems: Record<string, DraftProblem>;
  onDraftChange: (key: string, value: string) => void;
  onLocaleChange: (value: CvLocale) => void;
  onMoveSection: (key: CvSectionKey, direction: "up" | "down") => void;
}) {
  return (
    <section className="cv-panel" aria-labelledby="cv-settings-heading">
      <h2 id="cv-settings-heading" className="cv-panel-heading">{t(locale, "cv.settings.heading")}</h2>
      <div className="cv-fields">
        <label className="field-label" htmlFor="cv-title">{t(locale, "cv.settings.title")}
          <Input
            id="cv-title" name="title" value={draft[TITLE_KEY] ?? ""} maxLength={200} required
            aria-invalid={problems[TITLE_KEY] ? true : undefined} aria-describedby="cv-title-problem"
            onChange={(event) => onDraftChange(TITLE_KEY, event.currentTarget.value)}
          />
        </label>
        <FieldProblem id="cv-title-problem" locale={locale} problem={problems[TITLE_KEY]} />
        <label className="field-label" htmlFor="cv-locale">{t(locale, "cv.settings.language")}
          <Select id="cv-locale" name="locale" value={cvLocale} aria-describedby="cv-locale-help" onChange={(event) => onLocaleChange(event.currentTarget.value as CvLocale)}>
            {CV_LOCALES.map((value) => <option key={value} value={value}>{t(locale, value === "en" ? "cv.lang.en" : "cv.lang.id")}</option>)}
          </Select>
        </label>
        <p id="cv-locale-help" className="field-help">{t(locale, "cv.settings.languageHelp")}</p>
      </div>
      <div>
        <h3 className="field-label">{t(locale, "cv.settings.sectionOrder")}</h3>
        <ol className="cv-order-list">
          {order.map((key, index) => {
            const name = t(locale, `cv.section.${key}` as MessageKey);
            return (
              <li key={key} className="cv-order-row">
                <span>{name}</span>
                <span className="cv-row-actions">
                  <IconButton
                    id={`cv-section-move-${key}-up`} aria-label={t(locale, "cv.aria.moveSectionUp", { section: name })}
                    disabled={index === 0} onClick={() => onMoveSection(key, "up")}
                  ><ArrowUp aria-hidden="true" size={16} /></IconButton>
                  <IconButton
                    id={`cv-section-move-${key}-down`} aria-label={t(locale, "cv.aria.moveSectionDown", { section: name })}
                    disabled={index === order.length - 1} onClick={() => onMoveSection(key, "down")}
                  ><ArrowDown aria-hidden="true" size={16} /></IconButton>
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

export function CvProfileEditor({
  locale, draft, sourceValues, problems, onDraftChange,
}: {
  locale: Locale;
  draft: CvDraft;
  /** Profile values copied into the CV; shown as placeholders and restored by "Use profile value". */
  sourceValues: Record<string, string | null>;
  problems: Record<string, DraftProblem>;
  onDraftChange: (key: string, value: string) => void;
}) {
  return (
    <section className="cv-panel" aria-labelledby="cv-profile-heading">
      <h2 id="cv-profile-heading" className="cv-panel-heading">{t(locale, "cv.profile.heading")}</h2>
      <p className="field-help">{t(locale, "cv.profile.help")}</p>
      <div className="cv-fields">
        {CV_PROFILE_OVERRIDE_KEYS.map((key) => {
          const field = profileKey(key);
          const label = t(locale, `cv.profile.${key}` as MessageKey);
          return (
            <div key={key} className="cv-field">
              <label className="field-label" htmlFor={`cv-${key}`}>{label}
                <Input
                  id={`cv-${key}`} name={key} value={draft[field] ?? ""} placeholder={sourceValues[key] ?? ""}
                  type={key === "contact_email" ? "email" : key === "website" ? "url" : "text"}
                  aria-invalid={problems[field] ? true : undefined} aria-describedby={`cv-${key}-problem`}
                  onChange={(event) => onDraftChange(field, event.currentTarget.value)}
                />
              </label>
              <FieldProblem id={`cv-${key}-problem`} locale={locale} problem={problems[field]} />
              {(draft[field] ?? "") !== "" ? (
                <Button variant="ghost" aria-label={t(locale, "cv.profile.useProfileFor", { field: label })} onClick={() => onDraftChange(field, "")}>
                  {t(locale, "cv.profile.useProfile")}
                </Button>
              ) : null}
            </div>
          );
        })}
        <div className="cv-field cv-field-wide">
          <label className="field-label" htmlFor="cv-summary">{t(locale, "cv.profile.summary")}
            <Textarea
              id="cv-summary" name="summary" rows={4} value={draft[SUMMARY_KEY] ?? ""} placeholder={sourceValues.summary ?? ""}
              aria-invalid={problems[SUMMARY_KEY] ? true : undefined} aria-describedby="cv-summary-problem"
              onChange={(event) => onDraftChange(SUMMARY_KEY, event.currentTarget.value)}
            />
          </label>
          <FieldProblem id="cv-summary-problem" locale={locale} problem={problems[SUMMARY_KEY]} />
          {(draft[SUMMARY_KEY] ?? "") !== "" ? (
            <Button variant="ghost" aria-label={t(locale, "cv.profile.useProfileFor", { field: t(locale, "cv.profile.summary") })} onClick={() => onDraftChange(SUMMARY_KEY, "")}>
              {t(locale, "cv.profile.useProfile")}
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export interface ConflictField {
  key: string;
  label: string;
  mine: string;
  saved: string;
}

export function CvConflictPanel({
  locale, fields, onResolve, headingRef,
}: {
  locale: Locale;
  fields: ConflictField[];
  onResolve: (key: string, choice: "mine" | "saved") => void;
  headingRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div ref={headingRef} tabIndex={-1} className="cv-conflict">
      <RevisionConflict title={t(locale, "cv.conflict.title")} labelledBy="cv-conflict-title">
        <p>{fields.length > 0 ? t(locale, "cv.conflict.description") : t(locale, "cv.conflict.reloaded")}</p>
        {fields.map((field) => (
          <fieldset key={field.key} className="cv-conflict-field">
            <legend className="font-semibold">{field.label}</legend>
            <dl className="cv-conflict-values">
              <div><dt>{t(locale, "cv.conflict.mine")}</dt><dd>{field.mine || t(locale, "cv.conflict.empty")}</dd></div>
              <div><dt>{t(locale, "cv.conflict.saved")}</dt><dd>{field.saved || t(locale, "cv.conflict.empty")}</dd></div>
            </dl>
            <div className="cv-row-actions">
              <Button variant="secondary" onClick={() => onResolve(field.key, "mine")}>{t(locale, "cv.conflict.keepMine")}</Button>
              <Button variant="secondary" onClick={() => onResolve(field.key, "saved")}>{t(locale, "cv.conflict.useSaved")}</Button>
            </div>
          </fieldset>
        ))}
      </RevisionConflict>
    </div>
  );
}

export function CvRemoveDialog({
  locale, name, childNames, open, busy, onCancel, onConfirm,
}: {
  locale: Locale;
  name: string;
  childNames: string[];
  open: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open} onOpenChange={(next) => { if (!next) onCancel(); }}
      title={t(locale, "cv.remove.title", { name })} description={t(locale, "cv.remove.description")}
    >
      <ul className="cv-remove-children">
        {childNames.map((child, index) => <li key={`${index}-${child}`}>{child}</li>)}
      </ul>
      <div className="ui-dialog-actions">
        <Button variant="secondary" onClick={onCancel}>{t(locale, "common.cancel")}</Button>
        <Button variant="destructive" loading={busy} onClick={onConfirm}>{t(locale, "cv.remove.confirm")}</Button>
      </div>
    </Dialog>
  );
}
