"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field-control";
import { useUnsavedForm } from "@/components/ui/unsaved-changes";
import { t, type Locale } from "@/i18n/messages";

export function QuickLogCapture({ locale }: { locale: Locale }) {
  const [note, setNote] = useState("");
  const unsaved = useUnsavedForm("quick-log-note");

  useEffect(() => {
    const field = document.getElementById("quick-log-note");
    if (field instanceof HTMLTextAreaElement) field.focus({ preventScroll: true });
  }, []);

  return (
    <form
      id="quick-log-note-form"
      className="workspace-quick-log-form"
      onSubmit={(event) => event.preventDefault()}
      onInputCapture={unsaved.onInputCapture}
      onChangeCapture={unsaved.onChangeCapture}
    >
      <label className="field-label" htmlFor="quick-log-note">
        {t(locale, "quickLog.noteLabel")}
        <Textarea
          id="quick-log-note"
          className="workspace-quick-log-note mt-1"
          maxLength={10000}
          placeholder={t(locale, "quickLog.notePlaceholder")}
          value={note}
          onChange={(event) => setNote(event.currentTarget.value)}
          aria-describedby="quick-log-length-help"
        />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p id="quick-log-length-help" className="field-help">
          {t(locale, "quickLog.lengthHelp")} <span aria-hidden="true">·</span> {note.length}/10,000
        </p>
        <Button type="button" disabled aria-describedby="quick-log-save-unavailable">
          {t(locale, "quickLog.saveUnavailable")}
        </Button>
      </div>
      <p id="quick-log-save-unavailable" className="ui-message ui-message--info" role="status">
        {t(locale, "activity.unavailableDescription")}
      </p>
    </form>
  );
}
