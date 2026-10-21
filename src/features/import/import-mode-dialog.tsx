"use client";

import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { ImportExtractionMode } from "@/domain/import/contracts";
import { t, type Locale } from "@/i18n/messages";

/**
 * T26/T28 (decisions 0033, 0036): every upload picks how the CV is read. Two equal cards in a fixed order, the same
 * button variant, no recommendation, and focus on the title so a stray Enter chooses nothing. With AI consent on,
 * Read without AI first shows a confirmation (step "confirm", controlled by the parent) because it turns AI off for
 * the whole account; its heading takes focus for the same reason. Escape, the backdrop and Cancel only call onCancel, and
 * do nothing while a choice is being saved or uploaded: closing then would leave consent changed and no upload.
 */
export function ImportModeDialog({
  open,
  locale,
  step,
  granted,
  pending,
  error,
  onCancel,
  onChoose,
  onBack,
  onConfirmRules,
  aiNotice,
}: {
  open: boolean;
  locale: Locale;
  step: "choose" | "confirm";
  /** AI consent is on: the Without AI card says choosing it turns AI off. */
  granted: boolean;
  /** The choice being saved or uploaded; every button is disabled meanwhile. */
  pending: ImportExtractionMode | null;
  error: string;
  onCancel: () => void;
  onChoose: (mode: ImportExtractionMode) => void;
  onBack: () => void;
  onConfirmRules: () => void;
  /** Shown in the AI card when AI cannot be used right now (the AI import limit); disables Use AI. */
  aiNotice?: ReactNode;
}) {
  const aiTitleId = useId();
  const rulesTitleId = useId();
  const confirmTitleId = useId();
  const confirmTitle = useRef<HTMLHeadingElement>(null);
  const rulesCard = useRef<HTMLElement>(null);
  const shownStep = useRef(step);
  const busy = pending !== null;
  const loadingLabel = t(locale, "common.loading");

  // The confirmation heading takes focus when it appears; Back returns focus to Read without AI.
  useEffect(() => {
    const previous = shownStep.current;
    shownStep.current = step;
    if (!open || previous === step) return;
    if (step === "confirm") confirmTitle.current?.focus();
    else rulesCard.current?.querySelector("button")?.focus();
  }, [open, step]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => { if (!next) onCancel(); }}
      title={t(locale, "import.mode.title")}
      description={t(locale, "import.mode.description")}
      className="import-mode-dialog"
      focusTitle
      dismissible={!busy}
    >
      {step === "confirm" ? (
        <section className="import-mode-confirm" aria-labelledby={confirmTitleId}>
          <h3 id={confirmTitleId} ref={confirmTitle} tabIndex={-1} className="import-mode-option-title">{t(locale, "import.mode.confirmTitle")}</h3>
          <p>{t(locale, "import.mode.confirmBody")}</p>
          {error ? <p role="alert" className="field-error">{error}</p> : null}
          <div className="import-mode-confirm-actions">
            <Button variant="secondary" disabled={busy} loading={pending === "rules"} loadingLabel={loadingLabel} onClick={onConfirmRules}>
              {t(locale, "import.mode.confirmAction")}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={onBack}>{t(locale, "import.mode.confirmBack")}</Button>
          </div>
        </section>
      ) : (
        <>
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
            <section ref={rulesCard} className="import-mode-option" aria-labelledby={rulesTitleId}>
              <h3 id={rulesTitleId} className="import-mode-option-title">{t(locale, "import.mode.rulesTitle")}</h3>
              <p>{t(locale, "import.mode.rulesBody")}</p>
              {granted ? <p className="field-help">{t(locale, "import.mode.rulesAiOff")}</p> : null}
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
        </>
      )}
      <div className="ui-dialog-actions">
        <Button variant="ghost" disabled={busy} onClick={onCancel}>{t(locale, "common.cancel")}</Button>
      </div>
    </Dialog>
  );
}
