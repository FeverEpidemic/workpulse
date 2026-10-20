"use client";

import { useId } from "react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { ImportExtractionMode } from "@/domain/import/contracts";
import { t, type Locale } from "@/i18n/messages";

/**
 * T26 (decision 0033): a user without AI consent picks how the CV is read. Two equal cards in a fixed order, the same
 * button variant, no recommendation, and focus on the title so a stray Enter chooses nothing. Escape, the backdrop
 * and Cancel only call onCancel; only the two choice buttons call onChoose.
 */
export function ImportModeDialog({
  open,
  locale,
  pending,
  error,
  onCancel,
  onChoose,
  aiNotice,
}: {
  open: boolean;
  locale: Locale;
  /** The choice being saved or uploaded; both buttons are disabled meanwhile. */
  pending: ImportExtractionMode | null;
  error: string;
  onCancel: () => void;
  onChoose: (mode: ImportExtractionMode) => void;
  /** Shown in the AI card when AI cannot be used right now (the AI import limit); disables Use AI. */
  aiNotice?: ReactNode;
}) {
  const aiTitleId = useId();
  const rulesTitleId = useId();
  const busy = pending !== null;
  const loadingLabel = t(locale, "common.loading");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => { if (!next) onCancel(); }}
      title={t(locale, "import.mode.title")}
      description={t(locale, "import.mode.description")}
      className="import-mode-dialog"
      focusTitle
    >
      <div className="import-mode-options">
        <section className="import-mode-option" aria-labelledby={aiTitleId}>
          <h3 id={aiTitleId} className="import-mode-option-title">{t(locale, "import.mode.aiTitle")}</h3>
          <p>{t(locale, "import.mode.aiBody")}</p>
          <p className="field-help">{t(locale, "import.mode.aiConsent")}</p>
          {aiNotice}
          <Button
            variant="secondary"
            disabled={busy || Boolean(aiNotice)}
            loading={pending === "ai"}
            loadingLabel={loadingLabel}
            onClick={() => onChoose("ai")}
          >
            {t(locale, "import.mode.aiAction")}
          </Button>
        </section>
        <section className="import-mode-option" aria-labelledby={rulesTitleId}>
          <h3 id={rulesTitleId} className="import-mode-option-title">{t(locale, "import.mode.rulesTitle")}</h3>
          <p>{t(locale, "import.mode.rulesBody")}</p>
          <Button
            variant="secondary"
            disabled={busy}
            loading={pending === "rules"}
            loadingLabel={loadingLabel}
            onClick={() => onChoose("rules")}
          >
            {t(locale, "import.mode.rulesAction")}
          </Button>
        </section>
      </div>
      <p className="field-help import-mode-shared">{t(locale, "import.mode.shared")}</p>
      {error ? <p role="alert" className="field-error">{error}</p> : null}
      <div className="ui-dialog-actions">
        <Button variant="ghost" onClick={onCancel}>{t(locale, "common.cancel")}</Button>
      </div>
    </Dialog>
  );
}
