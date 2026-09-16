"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

import type { ActionState } from "@/server/action-result";
import { Button } from "@/components/ui/button";
import { RevisionConflict } from "@/components/ui/revision-conflict";
import { clearUnsavedForm } from "@/components/ui/unsaved-changes";
import { clearSessionDraftForForm } from "@/components/forms/session-draft";
import { t, type Locale } from "@/i18n/messages";

export type ConflictFormKind = "profile" | "onboarding" | "experience" | "education" | "certification" | "skill" | "delete";

type ConflictFieldMapping = readonly { formField: string; recordField: string }[];

const fieldMappings: Record<ConflictFormKind, ConflictFieldMapping> = {
  profile: [
    { formField: "display_name", recordField: "display_name" },
    { formField: "headline", recordField: "headline" },
    { formField: "summary", recordField: "summary" },
    { formField: "contact_email", recordField: "contact_email" },
    { formField: "phone", recordField: "phone" },
    { formField: "location", recordField: "location" },
    { formField: "website", recordField: "website" },
    { formField: "locale", recordField: "locale" },
    { formField: "timezone", recordField: "timezone" },
  ],
  onboarding: [
    { formField: "display_name", recordField: "display_name" },
    { formField: "locale", recordField: "locale" },
    { formField: "timezone", recordField: "timezone" },
  ],
  experience: [
    { formField: "organization", recordField: "organization" },
    { formField: "role_title", recordField: "role_title" },
    { formField: "experience_kind", recordField: "kind" },
    { formField: "is_current", recordField: "is_current" },
    { formField: "description", recordField: "description" },
  ],
  education: [
    { formField: "institution", recordField: "institution" },
    { formField: "qualification", recordField: "qualification" },
    { formField: "field_of_study", recordField: "field_of_study" },
    { formField: "is_current", recordField: "is_current" },
    { formField: "description", recordField: "description" },
  ],
  certification: [
    { formField: "name", recordField: "name" },
    { formField: "issuer", recordField: "issuer" },
    { formField: "credential_url", recordField: "credential_url" },
  ],
  skill: [{ formField: "name", recordField: "name" }],
  delete: [],
};

const datePrefixes: Record<ConflictFormKind, readonly string[]> = {
  profile: [],
  onboarding: [],
  experience: ["start", "end"],
  education: ["start", "end"],
  certification: ["issued"],
  skill: [],
  delete: [],
};

export function conflictFieldUpdates(kind: ConflictFormKind, record: Record<string, unknown>): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  for (const mapping of fieldMappings[kind]) {
    if (Object.hasOwn(record, mapping.recordField)) updates[mapping.formField] = record[mapping.recordField];
  }
  return updates;
}

export function conflictDatePrefixes(kind: ConflictFormKind): readonly string[] {
  return datePrefixes[kind];
}

function assignExpectedRevision(form: HTMLFormElement, revision: unknown): boolean {
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 1) return false;
  const element = form.elements.namedItem("expected_revision");
  if (!(element instanceof HTMLInputElement) || element.type !== "hidden") return false;
  element.value = String(revision);
  return true;
}

function latestSummary(record: Record<string, unknown>): string {
  const names = ["display_name", "headline", "organization", "role_title", "institution", "qualification", "name", "issuer", "locale", "timezone"];
  return names
    .filter((key) => typeof record[key] === "string" && record[key])
    .map((key) => `${key.replaceAll("_", " ")}: ${String(record[key])}`)
    .join(" · ");
}

export function ConflictControls({ state, formId, locale, formKind, ownerId, draftKey }: {
  state: ActionState;
  formId: string;
  locale: Locale;
  formKind: ConflictFormKind;
  ownerId?: string;
  draftKey?: string;
}) {
  const [resolvedConflictId, setResolvedConflictId] = useState("");
  const { pending } = useFormStatus();
  const conflictId = state.status === "error" && state.error.code === "CONFLICT" ? state.error.correlationId : "";

  if (pending || state.status !== "error" || state.error.code !== "CONFLICT" || !state.error.latestRecord || resolvedConflictId === conflictId) return null;
  const latest = state.error.latestRecord;

  function reloadServer(): void {
    if (ownerId && draftKey) clearSessionDraftForForm(ownerId, draftKey);
    clearUnsavedForm(formId);
    // Reload from the server so the profile row and its revision come from the
    // same fresh response. A short task lets the unsaved guard clear first.
    window.setTimeout(() => window.location.reload(), 0);
  }

  function retryChanges(): void {
    const form = document.getElementById(formId);
    if (!(form instanceof HTMLFormElement)) return;
    if (!assignExpectedRevision(form, latest.revision)) return;
    setResolvedConflictId(conflictId);
    form.requestSubmit();
  }

  return (
    <RevisionConflict title={t(locale, "profile.conflictTitle")} labelledBy={formId + "-conflict"}>
      <details className="mt-2">
        <summary className="cursor-pointer">{t(locale, "profile.serverVersion")}</summary>
        <p className="mt-2 text-[var(--color-text-secondary)]">{latestSummary(latest) || "Revision " + String(latest.revision ?? "")}</p>
      </details>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" type="button" onClick={reloadServer}>{t(locale, "profile.reloadServer")}</Button>
        <Button variant="primary" type="button" onClick={retryChanges}>{t(locale, "profile.retryChanges")}</Button>
      </div>
    </RevisionConflict>
  );
}
