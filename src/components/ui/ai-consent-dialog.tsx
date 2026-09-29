"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { t, type Locale } from "@/i18n/messages";

/**
 * Shared AI processing consent dialog (Wireframe §1): explains what is sent to the
 * external processor and offers Allow AI or Continue manually. The caller supplies the
 * allow control so it can submit its own form; Continue manually only closes.
 * Focus starts on Continue manually so consent is never given by a stray Enter.
 */
export function AiConsentDialog({
  open,
  onOpenChange,
  locale,
  allowControl,
  purpose = "analysis",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: Locale;
  allowControl: ReactNode;
  /** Same consent version; the copy names what this request sends (activity note or CV text). */
  purpose?: "analysis" | "import";
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t(locale, "ai.consent.dialogTitle")}
      description={t(locale, purpose === "import" ? "ai.consent.dialogIntroImport" : "ai.consent.dialogIntro")}
      className="ai-consent-dialog"
    >
      <div className="ai-consent-dialog-body">
        <section aria-labelledby="ai-consent-sent-title">
          <h3 id="ai-consent-sent-title" className="ai-consent-dialog-heading">{t(locale, "ai.consent.sentTitle")}</h3>
          <p>{t(locale, purpose === "import" ? "ai.consent.sentImport" : "ai.consent.sent")}</p>
        </section>
        <section aria-labelledby="ai-consent-not-sent-title">
          <h3 id="ai-consent-not-sent-title" className="ai-consent-dialog-heading">{t(locale, "ai.consent.notSentTitle")}</h3>
          <p>{t(locale, "ai.consent.notSent")}</p>
        </section>
        <p className="field-help">{t(locale, "ai.consent.control")}</p>
      </div>
      <div className="ui-dialog-actions">
        <Button variant="secondary" autoFocus onClick={() => onOpenChange(false)}>
          {t(locale, "ai.consent.dialogManual")}
        </Button>
        {allowControl}
      </div>
    </Dialog>
  );
}
