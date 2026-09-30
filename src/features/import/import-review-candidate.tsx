"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/field-control";
import { RevisionConflict } from "@/components/ui/revision-conflict";
import { normalizePartialDate, PartialDateValidationError, type DatePrecision } from "@/domain/dates/partial-date";
import type { ImportItemAction } from "@/domain/import/commit-contracts";
import { draftPatch, type FieldDraft, type FieldValue, type ItemSaveStatus } from "@/domain/import/review-edit";
import type { ReviewCandidate, ReviewField, ReviewProfileField } from "@/domain/import/review-view";
import { t, type Locale, type MessageKey } from "@/i18n/messages";

const fieldLabel = (locale: Locale, name: string) => t(locale, `import.review.field.${name}` as MessageKey);
const errorText = (locale: Locale, code: string) => t(locale, `import.review.error.${code}` as MessageKey);

export const fieldElementId = (itemId: string, name: string) => `${itemId}-${name}`;
const errorElementId = (itemId: string, name: string) => `${itemId}-${name}-error`;

export type CandidateHandlers = {
  onChange: (itemId: string, patch: FieldDraft) => void;
  onInvalid: (itemId: string, field: string, invalid: boolean) => void;
  onSave: (itemId: string) => void;
  onDiscard: (itemId: string) => void;
  onAction: (itemId: string, action: ImportItemAction) => void;
  onMap: (itemId: string, targetId: string) => void;
  onConfirm: (itemId: string, confirm: boolean) => void;
  onReload: () => void;
  onProfileField: (itemId: string, name: string, selected: boolean) => void;
};

export type CandidateProps = {
  locale: Locale;
  candidate: ReviewCandidate;
  payload: Record<string, unknown> | null;
  draft: FieldDraft | undefined;
  status: ItemSaveStatus;
  /** After a reload following a conflict, kept edits still show the saved server value. */
  showServerValues?: boolean;
  invalidFields: readonly string[];
  handlers: CandidateHandlers;
  titleText: string;
};

function effective(field: ReviewField, draft: FieldDraft | undefined): FieldValue {
  return draft && Object.hasOwn(draft, field.name) ? draft[field.name]! : field.value;
}

function valueText(locale: Locale, value: unknown): string {
  return typeof value === "string" && value.trim() !== "" ? value : t(locale, "import.review.emptyValue");
}

/** Controlled partial-date editor; canonical date + precision come from the shared partial-date domain rules. */
function PartialDateEditor({ locale, id, field, draft, disabled, describedBy, invalid, onChange, onInvalid }: {
  locale: Locale;
  id: string;
  field: ReviewField;
  draft: FieldDraft | undefined;
  disabled: boolean;
  describedBy: string | undefined;
  invalid: boolean;
  onChange: (patch: FieldDraft) => void;
  onInvalid: (invalid: boolean) => void;
}) {
  const precisionName = field.precisionName!;
  const date = (draft && Object.hasOwn(draft, field.name) ? draft[field.name] : field.value) as string | null;
  const savedPrecision = (draft && Object.hasOwn(draft, precisionName) ? draft[precisionName] : field.precision) as string | null;
  const [parts, setParts] = useState(() => {
    const precision = (savedPrecision ?? "unknown") as DatePrecision;
    const iso = date ?? "";
    return {
      precision,
      year: precision === "unknown" ? "" : iso.slice(0, 4),
      month: precision === "month" || precision === "day" ? String(Number(iso.slice(5, 7))) : "",
      day: precision === "day" ? String(Number(iso.slice(8, 10))) : "",
    };
  });

  const update = (next: typeof parts) => {
    setParts(next);
    try {
      const canonical = normalizePartialDate(next);
      onInvalid(false);
      onChange({ [field.name]: canonical.date, [precisionName]: canonical.precision });
    } catch (error) {
      if (!(error instanceof PartialDateValidationError)) throw error;
      onInvalid(true);
    }
  };
  const text = (name: "year" | "month" | "day") => t(locale, `profile.${name}`);

  return (
    <fieldset className="import-date" aria-describedby={describedBy}>
      <legend className="field-label">{fieldLabel(locale, field.name)}</legend>
      <div className="import-date-grid">
        <label className="text-xs font-medium">
          {t(locale, "profile.precision")}
          <Select
            className="mt-1"
            id={id}
            value={parts.precision}
            disabled={disabled}
            aria-invalid={invalid || field.errors.length > 0 || undefined}
            onChange={(event) => update({ ...parts, precision: event.target.value as DatePrecision })}
          >
            <option value="unknown">{t(locale, "profile.unknownDate")}</option>
            <option value="year">{text("year")}</option>
            <option value="month">{text("month")}</option>
            <option value="day">{text("day")}</option>
          </Select>
        </label>
        {(["year", "month", "day"] as const).map((part) => (
          <label className="text-xs font-medium" key={part}>
            {text(part)}
            <Input
              className="mt-1"
              inputMode="numeric"
              maxLength={part === "year" ? 4 : 2}
              value={parts[part]}
              disabled={disabled || parts.precision === "unknown" || (part === "month" && parts.precision === "year") || (part === "day" && parts.precision !== "day")}
              aria-label={`${fieldLabel(locale, field.name)}: ${text(part)}`}
              onChange={(event) => update({ ...parts, [part]: event.target.value })}
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function FieldRow({ locale, itemId, field, draft, disabled, invalid, conflicted, saved, handlers }: {
  locale: Locale;
  itemId: string;
  field: ReviewField;
  draft: FieldDraft | undefined;
  disabled: boolean;
  invalid: boolean;
  conflicted: boolean;
  saved: Record<string, unknown> | null;
  handlers: CandidateHandlers;
}) {
  const id = fieldElementId(itemId, field.name);
  const errorId = errorElementId(itemId, field.name);
  const helpId = `${id}-help`;
  const value = effective(field, draft);
  const label = fieldLabel(locale, field.name);
  const hasError = field.errors.length > 0 || field.missing || invalid;
  const describedBy = [hasError ? errorId : "", conflicted && draft && Object.hasOwn(draft, field.name) ? helpId : ""].filter(Boolean).join(" ") || undefined;
  const set = (next: FieldValue) => handlers.onChange(itemId, { [field.name]: next });

  const control = (() => {
    switch (field.kind) {
      case "date":
        return (
          <PartialDateEditor
            locale={locale} id={id} field={field} draft={draft} disabled={disabled} describedBy={describedBy} invalid={invalid}
            onChange={(patch) => handlers.onChange(itemId, patch)}
            onInvalid={(flag) => handlers.onInvalid(itemId, field.name, flag)}
          />
        );
      case "exact_date":
        return (
          <Input
            id={id} type="date" disabled={disabled} value={typeof value === "string" ? value : ""}
            aria-invalid={hasError || undefined} aria-describedby={describedBy}
            onChange={(event) => set(event.target.value === "" ? null : event.target.value)}
          />
        );
      case "checkbox":
        return (
          <label className="import-checkbox">
            <input
              id={id} type="checkbox" checked={value === true} disabled={disabled} aria-describedby={describedBy}
              onChange={(event) => {
                // A current role has no end date: clear it together with the flag.
                handlers.onChange(itemId, event.target.checked ? { is_current: true, end_date: null, end_precision: null } : { is_current: false });
              }}
            />
            <span>{label}</span>
          </label>
        );
      case "select":
        return (
          <Select
            id={id} disabled={disabled} value={typeof value === "string" ? value : ""}
            aria-invalid={hasError || undefined} aria-describedby={describedBy} aria-required={field.required || undefined}
            onChange={(event) => set(event.target.value === "" ? null : event.target.value)}
          >
            <option value="">{t(locale, "import.review.kindPlaceholder")}</option>
            {(field.options ?? []).map((option) => (
              <option key={option} value={option}>{t(locale, `import.review.kind.${option}` as MessageKey)}</option>
            ))}
          </Select>
        );
      case "textarea":
        return (
          <Textarea
            id={id} rows={3} disabled={disabled} maxLength={field.maxLength} value={typeof value === "string" ? value : ""}
            aria-invalid={hasError || undefined} aria-describedby={describedBy} aria-required={field.required || undefined}
            onChange={(event) => set(event.target.value)}
          />
        );
      default:
        return (
          <Input
            id={id} type={field.kind === "url" ? "url" : "text"} disabled={disabled} maxLength={field.maxLength}
            value={typeof value === "string" ? value : ""}
            aria-invalid={hasError || undefined} aria-describedby={describedBy} aria-required={field.required || undefined}
            onChange={(event) => set(event.target.value)}
          />
        );
    }
  })();

  const showLabel = field.kind !== "checkbox" && field.kind !== "date";
  const serverValue = conflicted && draft && Object.hasOwn(draft, field.name) && field.kind !== "checkbox"
    ? saved?.[field.name]
    : undefined;
  return (
    <div className="import-field" data-missing={field.missing || undefined}>
      {showLabel ? (
        <label className="field-label" htmlFor={id}>
          {label}
          <span className="import-required">{field.required ? t(locale, "import.review.required") : t(locale, "import.review.optional")}</span>
        </label>
      ) : null}
      {control}
      {field.errors.map((code) => <p key={code} id={code === field.errors[0] ? errorId : undefined} className="field-error">{errorText(locale, code)}</p>)}
      {field.errors.length === 0 && field.missing ? <p id={errorId} className="field-error">{errorText(locale, "REQUIRED")}</p> : null}
      {field.errors.length === 0 && !field.missing && invalid ? <p id={errorId} className="field-error">{t(locale, "import.review.dateInvalid")}</p> : null}
      {conflicted && draft && Object.hasOwn(draft, field.name) ? (
        <p id={helpId} className="field-help">{t(locale, "import.review.serverValue", { value: valueText(locale, serverValue) })}</p>
      ) : null}
    </div>
  );
}

function ProfileFieldRow({ locale, itemId, field, disabled, draft, handlers }: {
  locale: Locale; itemId: string; field: ReviewProfileField; disabled: boolean; draft: FieldDraft | undefined; handlers: CandidateHandlers;
}) {
  const id = fieldElementId(itemId, field.name);
  const errorId = errorElementId(itemId, field.name);
  const value = draft && Object.hasOwn(draft, field.name) ? (draft[field.name] as string | null) : field.value;
  const label = fieldLabel(locale, field.name);
  const hasError = field.errors.length > 0;
  return (
    <div className="import-field">
      <label className="import-checkbox">
        <input
          type="checkbox" checked={field.selected} disabled={disabled}
          aria-describedby={hasError ? errorId : undefined}
          onChange={(event) => handlers.onProfileField(itemId, field.name, event.target.checked)}
        />
        <span>{label}</span>
      </label>
      {field.name === "summary" ? (
        <Textarea id={id} rows={3} disabled={disabled} value={value ?? ""} aria-label={label} aria-invalid={hasError || undefined} aria-describedby={hasError ? errorId : undefined}
          onChange={(event) => handlers.onChange(itemId, { [field.name]: event.target.value })} />
      ) : (
        <Input id={id} disabled={disabled} value={value ?? ""} aria-label={label} aria-invalid={hasError || undefined} aria-describedby={hasError ? errorId : undefined}
          onChange={(event) => handlers.onChange(itemId, { [field.name]: event.target.value })} />
      )}
      {field.current !== null ? <p className="field-help">{t(locale, "import.review.profileCurrent", { value: field.current })}</p> : null}
      {field.errors.map((code) => <p key={code} id={code === field.errors[0] ? errorId : undefined} className="field-error">{errorText(locale, code)}</p>)}
    </div>
  );
}

const STATUS_KEY: Record<Exclude<ItemSaveStatus, "idle">, MessageKey> = {
  saving: "import.review.status.saving",
  saved: "import.review.status.saved",
  failed: "import.review.status.failed",
  conflict: "import.review.status.conflict",
};

export function ImportReviewCandidate({ locale, candidate, payload, draft, status, showServerValues = false, invalidFields, handlers, titleText }: CandidateProps) {
  const [mapMode, setMapMode] = useState(false);
  const saving = status === "saving";
  const conflicted = status === "conflict";
  const dirty = draftPatch(payload, draft);
  const isDirty = Object.keys(dirty).length > 0;
  const mode: ImportItemAction = mapMode ? "map" : candidate.action;
  const titleId = `${candidate.id}-title`;
  const actionName = `${candidate.id}-action`;
  const persistence: MessageKey | null = isDirty && !saving && !conflicted ? "import.review.status.unsaved" : status === "idle" ? null : STATUS_KEY[status];
  const disabled = saving;
  const duplicate = candidate.duplicate;
  const needsFields = candidate.confirm.missing.map((name) => fieldLabel(locale, name)).join(", ");

  return (
    <article className="import-candidate" id={candidate.id} tabIndex={-1} aria-labelledby={titleId} data-action={candidate.action}>
      <header className="import-candidate-header">
        <h4 id={titleId} className="import-candidate-title">{titleText}</h4>
        <span role="status" className="import-persistence" data-status={persistence ? (isDirty ? "unsaved" : status) : undefined}>
          {persistence ? <Badge variant={status === "failed" || conflicted ? "danger" : isDirty ? "warning" : "neutral"}>{t(locale, persistence)}</Badge> : null}
        </span>
      </header>

      {duplicate ? (
        <div className="import-note" role="note">
          <p>
            {duplicate.source === "validation"
              ? duplicate.targetId ? t(locale, "import.review.duplicateSkill") : t(locale, "import.review.duplicateBatch")
              : t(locale, "import.review.duplicatePossible", { label: duplicate.label ?? "" })}
          </p>
          {duplicate.targetId ? (
            <Button variant="secondary" disabled={disabled} onClick={() => handlers.onMap(candidate.id, duplicate.targetId!)}>
              {t(locale, "import.review.mapToExisting", { label: duplicate.label ?? t(locale, "import.review.mapLabel") })}
            </Button>
          ) : null}
        </div>
      ) : null}

      {candidate.excerpt ? (
        <details className="import-excerpt">
          <summary>{t(locale, "import.review.excerpt")}</summary>
          <blockquote>{candidate.excerpt}</blockquote>
        </details>
      ) : null}

      <fieldset className="import-actionset" disabled={disabled}>
        <legend className="field-label">{t(locale, "import.review.actionLegend")}</legend>
        <div className="import-radios">
          {(["create", ...(candidate.canMap ? ["map"] : []), "skip"] as ImportItemAction[]).map((action) => (
            <label key={action} className="import-radio">
              <input
                type="radio" name={actionName} value={action} checked={mode === action}
                aria-describedby={action === "map" && candidate.mapOptions.length === 0 ? `${candidate.id}-map-none` : undefined}
                disabled={action === "map" && candidate.mapOptions.length === 0 && candidate.action !== "map"}
                onChange={() => {
                  if (action === "map") { setMapMode(true); return; }
                  setMapMode(false);
                  if (action !== candidate.action) handlers.onAction(candidate.id, action);
                }}
              />
              <span>{t(locale, `import.review.action.${action}` as MessageKey)}</span>
            </label>
          ))}
        </div>
        {candidate.canMap && candidate.mapOptions.length === 0 ? <p id={`${candidate.id}-map-none`} className="field-help">{t(locale, "import.review.mapNone")}</p> : null}
      </fieldset>

      {mode === "map" ? (
        <div className="import-field">
          <label className="field-label" htmlFor={fieldElementId(candidate.id, "target_id")}>
            {t(locale, "import.review.mapLabel")}
            <span className="import-required">{t(locale, "import.review.required")}</span>
          </label>
          <Select
            id={fieldElementId(candidate.id, "target_id")} disabled={disabled} value={candidate.action === "map" ? (candidate.targetId ?? "") : ""}
            aria-invalid={candidate.errors.some((error) => error.field === "target_id") || undefined}
            aria-describedby={candidate.errors.some((error) => error.field === "target_id") ? errorElementId(candidate.id, "target_id") : undefined}
            onChange={(event) => { if (event.target.value) { setMapMode(false); handlers.onMap(candidate.id, event.target.value); } }}
          >
            <option value="">{t(locale, "import.review.mapPlaceholder")}</option>
            {candidate.mapOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </Select>
          {candidate.errors.filter((error) => error.field === "target_id").map((error) => (
            <p key={error.code} id={errorElementId(candidate.id, "target_id")} className="field-error">{errorText(locale, error.code)}</p>
          ))}
          <p className="field-help">{t(locale, "import.review.mapUnchanged")}</p>
        </div>
      ) : null}

      {mode === "skip" ? <p className="field-help">{t(locale, "import.review.skipped")}</p> : null}

      {mode === "create" ? (
        <div className="import-fields">
          {candidate.profileFields ? (
            <>
              <p className="field-help">{t(locale, "import.review.profileHelp")}</p>
              {candidate.profileFields.map((field) => (
                <ProfileFieldRow key={field.name} locale={locale} itemId={candidate.id} field={field} disabled={disabled} draft={draft} handlers={handlers} />
              ))}
            </>
          ) : candidate.fields.map((field) => (
            <FieldRow
              key={field.name} locale={locale} itemId={candidate.id} field={field} draft={draft} disabled={disabled}
              invalid={invalidFields.includes(field.name)} conflicted={conflicted || showServerValues} saved={payload} handlers={handlers}
            />
          ))}
          {candidate.errors.filter((error) => !candidate.fields.some((field) => field.name === error.field) && !candidate.profileFields?.some((field) => field.name === error.field)).map((error) => (
            <p key={`${error.field}-${error.code}`} className="field-error">{errorText(locale, error.code)}</p>
          ))}
        </div>
      ) : null}

      {candidate.confirm.applicable ? (
        <div className="import-confirm">
          <label className="import-checkbox">
            <input
              type="checkbox" checked={candidate.confirm.requested}
              disabled={disabled || (!candidate.confirm.canConfirm && !candidate.confirm.requested)}
              aria-describedby={`${candidate.id}-confirm-help`}
              onChange={(event) => handlers.onConfirm(candidate.id, event.target.checked)}
            />
            <span>{t(locale, "import.review.confirmLabel")}</span>
          </label>
          <p id={`${candidate.id}-confirm-help`} className="field-help">
            {candidate.confirm.canConfirm || candidate.confirm.requested
              ? t(locale, "import.review.confirmHelp")
              : t(locale, "import.review.confirmNeeds", { fields: needsFields })}
          </p>
        </div>
      ) : null}

      {conflicted ? (
        <RevisionConflict title={t(locale, "import.review.conflictTitle")} labelledBy={`${candidate.id}-conflict`}>
          <p>{t(locale, "import.review.conflictBody")}</p>
          <Button variant="secondary" onClick={handlers.onReload}>{t(locale, "import.review.conflictReload")}</Button>
        </RevisionConflict>
      ) : null}

      {mode === "create" && (isDirty || invalidFields.length > 0) ? (
        <div className="import-candidate-actions">
          <Button variant="secondary" disabled={disabled || invalidFields.length > 0 || !isDirty || conflicted} onClick={() => handlers.onSave(candidate.id)}>
            {t(locale, "import.review.save")}
          </Button>
          <Button variant="ghost" disabled={disabled} onClick={() => handlers.onDiscard(candidate.id)}>{t(locale, "import.review.discard")}</Button>
        </div>
      ) : null}
    </article>
  );
}
