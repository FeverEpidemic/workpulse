import Link from "next/link";
import { useId, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { CV_PROFILE_OVERRIDE_KEYS } from "@/domain/cv/contracts";
import type { CvPreviewEntry, CvPreviewModel } from "@/domain/cv/preview";
import { t, type Locale, type MessageKey } from "@/i18n/messages";

function Entry({ entry, locale, nested = false }: { entry: CvPreviewEntry; locale: Locale; nested?: boolean }) {
  const lines = [entry.subline, entry.dates].filter(Boolean).join(" · ");
  return (
    <li className={nested ? "cv-preview-child" : "cv-preview-entry"} data-testid="cv-preview-entry">
      <p className="cv-preview-headline">
        {entry.headline}
        {entry.deleted ? <Badge variant="warning" className="ml-2">{t(locale, "cv.badge.sourceDeleted")}</Badge> : null}
      </p>
      {lines ? <p className="cv-preview-subline">{lines}</p> : null}
      {entry.text ? <p className="cv-preview-text">{entry.text}</p> : null}
      {entry.children.length > 0 ? (
        <ul className="cv-preview-children">
          {entry.children.map((child) => <Entry key={child.itemId} entry={child} locale={locale} nested />)}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * The way from S13 to S14. S14 shows the saved revision, so while anything is unsaved the link is a focusable but
 * disabled button whose reason stays visible and is read with it (T22).
 */
export function CvExportLink({ locale, disabled, reasonKey }: { locale: Locale; disabled: boolean; reasonKey: MessageKey | null }) {
  const reasonId = useId();
  if (!disabled) {
    return <Link href="/cv/preview" className="button-secondary" data-testid="cv-preview-export-link">{t(locale, "cv.builder.previewAndExport")}</Link>;
  }
  return (
    <>
      <button type="button" className="button-secondary" aria-disabled="true" aria-describedby={reasonId} data-testid="cv-preview-export-link">
        {t(locale, "cv.builder.previewAndExport")}
      </button>
      <p id={reasonId} className="field-help" data-testid="cv-preview-export-reason">{reasonKey ? t(locale, reasonKey) : null}</p>
    </>
  );
}

/**
 * Screen preview of the saved CV. It renders the model it is given and never reads the editor draft, so it
 * shows exactly what a later export of the same revision contains. Headings and dates follow the CV language.
 * `action` is an optional slot in the header (S13 puts the link to S14 there).
 */
export function CvPreview({ model, locale, dirty, action }: { model: CvPreviewModel; locale: Locale; dirty: boolean; action?: ReactNode }) {
  const contact = CV_PROFILE_OVERRIDE_KEYS
    .filter((key) => key !== "display_name" && key !== "headline")
    .map((key) => model.profile[key])
    .filter((value): value is string => Boolean(value));
  return (
    <aside className="cv-preview" aria-labelledby="cv-preview-heading" lang={model.locale}>
      <div className="cv-preview-meta" lang={locale}>
        <h2 id="cv-preview-heading" className="text-base font-semibold">{t(locale, "cv.preview.heading")}</h2>
        <p className="field-help">{t(locale, "cv.preview.description")}</p>
        {dirty ? <p className="field-help" role="note"><Badge variant="warning">{t(locale, "cv.status.unsaved")}</Badge> {t(locale, "cv.preview.unsavedNotShown")}</p> : null}
        {action ? <div className="cv-preview-actions">{action}</div> : null}
      </div>
      <article className="cv-paper" data-testid="cv-preview-paper">
        <header className="cv-preview-header">
          {model.profile.display_name ? <p className="cv-preview-name">{model.profile.display_name}</p> : null}
          {model.profile.headline ? <p className="cv-preview-headline-line">{model.profile.headline}</p> : null}
          {contact.length > 0 ? <p className="cv-preview-contact">{contact.join(" · ")}</p> : null}
        </header>
        {model.summary ? <p className="cv-preview-summary">{model.summary}</p> : null}
        {model.sections.length === 0 ? <p className="field-help" lang={locale}>{t(locale, "cv.preview.empty")}</p> : null}
        {model.sections.map((section) => (
          <section key={section.key} className="cv-preview-section" aria-labelledby={`cv-preview-${section.key}`}>
            <h3 id={`cv-preview-${section.key}`} className="cv-preview-section-heading">{section.heading}</h3>
            <ul className="cv-preview-list">
              {section.entries.map((entry) => <Entry key={entry.itemId} entry={entry} locale={locale} />)}
            </ul>
          </section>
        ))}
      </article>
    </aside>
  );
}
