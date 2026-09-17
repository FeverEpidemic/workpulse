"use client";

import { startTransition, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field-control";
import { useUnsavedForm } from "@/components/ui/unsaved-changes";
import { sessionDraftStorageKey, useSessionDraft } from "@/components/forms/session-draft";
import { t, type Locale } from "@/i18n/messages";
import { IDLE_ACTION_STATE } from "@/server/action-result";

export function QuickLogCapture({ locale, ownerId }: { locale: Locale; ownerId: string }) {
  const [note, setNote] = useState("");
  const draftStorageKey = sessionDraftStorageKey(ownerId, "quick-log-note");
  const { formRef, onInputCapture, onChangeCapture } = useSessionDraft("quick-log-note", ownerId, IDLE_ACTION_STATE);
  const unsaved = useUnsavedForm("quick-log-note");

  useEffect(() => {
    let restoredNote = "";
    if (draftStorageKey) {
      try {
        const raw = sessionStorage.getItem(draftStorageKey);
        if (raw) {
          const value: unknown = JSON.parse(raw);
          if (value !== null && typeof value === "object" && !Array.isArray(value)) {
            const candidate = (value as Record<string, unknown>)["raw_text"];
            if (typeof candidate === "string") restoredNote = candidate.slice(0, 10000);
          }
        }
      } catch {
        // A malformed or unavailable draft does not block Quick log.
      }
    }
    if (restoredNote) startTransition(() => setNote(restoredNote));
    document.getElementById("quick-log-note")?.focus({ preventScroll: true });
  }, [draftStorageKey]);

  return (
    <form
      id="quick-log-note-form"
      ref={formRef}
      className="workspace-quick-log-form"
      onSubmit={(event) => event.preventDefault()}
      onInputCapture={(event) => {
        onInputCapture(event);
        unsaved.onInputCapture(event);
      }}
      onChangeCapture={(event) => {
        onChangeCapture(event);
        unsaved.onChangeCapture(event);
      }}
    >
      <label className="field-label" htmlFor="quick-log-note">
        {t(locale, "quickLog.noteLabel")}
        <Textarea
          id="quick-log-note"
          name="raw_text"
          className="workspace-quick-log-note mt-1"
          maxLength={10000}
          placeholder={t(locale, "quickLog.notePlaceholder")}
          defaultValue=""
          onInput={(event) => setNote(event.currentTarget.value)}
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
