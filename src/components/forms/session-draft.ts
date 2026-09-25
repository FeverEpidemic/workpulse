"use client";

import { useCallback, useEffect, useRef } from "react";
import type { FormEvent } from "react";

import type { ActionState } from "@/server/action-result";

type DraftValue = string | boolean;
type DraftValues = Record<string, DraftValue>;

export interface SessionDraftStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const legacyDraftPrefix = "workpulse:draft:";
const versionedDraftPrefix = "workpulse:draft:v2:";
const sessionDraftMetadataSuffix = ":metadata:v1";
const sessionDraftMetadataSchemaVersion = 1 as const;

export type SessionDraftMetadata = {
  readonly schemaVersion: typeof sessionDraftMetadataSchemaVersion;
  readonly baseRevision: number;
};

export type SessionDraftMetadataState =
  | { readonly status: "missing" }
  | { readonly status: "valid"; readonly metadata: SessionDraftMetadata }
  | { readonly status: "invalid" };
const protectedFieldNames = new Set([
  "id",
  "kind",
  "user_id",
  "owner_id",
  "expected_revision",
  "revision",
  "created_at",
  "updated_at",
  "deleted_at",
  "deleting_at",
  "onboarding_completed_at",
]);
const persistedInputTypes = new Set([
  "text",
  "search",
  "tel",
  "url",
  "email",
  "number",
  "date",
  "datetime-local",
  "month",
  "time",
  "week",
  "checkbox",
  "radio",
  "range",
  "color",
]);

export function sessionDraftStorageKey(ownerId: string | null | undefined, formKey: string): string | null {
  if (!ownerId?.trim() || !formKey.trim()) return null;
  return `${versionedDraftPrefix}${encodeURIComponent(ownerId)}:${encodeURIComponent(formKey)}`;
}

export function sessionDraftMetadataStorageKey(ownerId: string | null | undefined, formKey: string): string | null {
  const storageKey = sessionDraftStorageKey(ownerId, formKey);
  return storageKey ? `${storageKey}${sessionDraftMetadataSuffix}` : null;
}

export function readSessionDraftMetadata(
  storage: SessionDraftStorage,
  ownerId: string | null | undefined,
  formKey: string,
): SessionDraftMetadataState {
  const metadataKey = sessionDraftMetadataStorageKey(ownerId, formKey);
  if (!metadataKey) return { status: "missing" };

  const raw = storage.getItem(metadataKey);
  if (!raw) return { status: "missing" };

  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { status: "invalid" };
    const value = parsed as Record<string, unknown>;
    const baseRevision = value.baseRevision;
    if (
      value.schemaVersion !== sessionDraftMetadataSchemaVersion ||
      typeof baseRevision !== "number" ||
      !Number.isSafeInteger(baseRevision) ||
      baseRevision < 1
    ) {
      return { status: "invalid" };
    }
    return {
      status: "valid",
      metadata: { schemaVersion: sessionDraftMetadataSchemaVersion, baseRevision },
    };
  } catch {
    return { status: "invalid" };
  }
}

export function writeSessionDraftMetadata(
  storage: SessionDraftStorage,
  ownerId: string | null | undefined,
  formKey: string,
  baseRevision: number,
): void {
  const metadataKey = sessionDraftMetadataStorageKey(ownerId, formKey);
  if (!metadataKey || !Number.isSafeInteger(baseRevision) || baseRevision < 1) return;
  storage.setItem(metadataKey, JSON.stringify({
    schemaVersion: sessionDraftMetadataSchemaVersion,
    baseRevision,
  } satisfies SessionDraftMetadata));
}

export function clearSessionDraftMetadata(
  storage: SessionDraftStorage,
  ownerId: string | null | undefined,
  formKey: string,
): void {
  const metadataKey = sessionDraftMetadataStorageKey(ownerId, formKey);
  if (metadataKey) storage.removeItem(metadataKey);
}

export function hasSessionDraft(
  storage: SessionDraftStorage,
  ownerId: string | null | undefined,
  formKey: string,
): boolean {
  const storageKey = sessionDraftStorageKey(ownerId, formKey);
  if (!storageKey) return false;

  const raw = storage.getItem(storageKey);
  if (!raw) return false;

  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) && Object.keys(parsed).length > 0;
  } catch {
    return false;
  }
}

export function isPersistableDraftField(
  name: string,
  type: string,
  tagName: string,
  disabled = false,
  readOnly = false,
): boolean {
  const fieldName = name.trim().toLowerCase();
  if (!fieldName || protectedFieldNames.has(fieldName) || disabled || readOnly) return false;

  switch (tagName.toLowerCase()) {
    case "input":
      return persistedInputTypes.has(type.toLowerCase());
    case "select":
    case "textarea":
      return true;
    default:
      return false;
  }
}

export function removeLegacySessionDrafts(storage: SessionDraftStorage): void {
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (key?.startsWith(legacyDraftPrefix) && !key.startsWith(versionedDraftPrefix)) {
      storage.removeItem(key);
    }
  }
}

export function removeSessionDraftsForOwner(storage: SessionDraftStorage, ownerId: string): void {
  if (!ownerId.trim()) return;
  const ownerPrefix = `${versionedDraftPrefix}${encodeURIComponent(ownerId)}:`;
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (key?.startsWith(ownerPrefix)) storage.removeItem(key);
  }
}

export function removeSessionDraftForForm(
  storage: SessionDraftStorage,
  ownerId: string | null | undefined,
  formKey: string,
): void {
  const key = sessionDraftStorageKey(ownerId, formKey);
  if (key) storage.removeItem(key);
  clearSessionDraftMetadata(storage, ownerId, formKey);
}

export function clearSessionDraftForForm(ownerId: string | null | undefined, formKey: string): void {
  try {
    removeSessionDraftForForm(sessionStorage, ownerId, formKey);
  } catch {
    // Storage failures must not block conflict recovery.
  }
}

export function clearSessionDraftsForOwner(ownerId: string): void {
  try {
    removeLegacySessionDrafts(sessionStorage);
    removeSessionDraftsForOwner(sessionStorage, ownerId);
  } catch {
    // Storage failures must not prevent sign-out.
  }
}

function isFormControl(element: Element): element is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  return element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement;
}

function persistable(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): boolean {
  return isPersistableDraftField(
    element.name,
    element instanceof HTMLInputElement ? element.type : "",
    element.tagName,
    element.disabled,
    (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && element.readOnly,
  );
}

function formValues(form: HTMLFormElement): DraftValues {
  const values: DraftValues = Object.create(null) as DraftValues;
  for (const element of Array.from(form.elements)) {
    if (!isFormControl(element) || !persistable(element)) continue;
    if (element instanceof HTMLInputElement && element.type === "radio") {
      if (element.checked) values[element.name] = element.value;
    } else if (element instanceof HTMLInputElement && element.type === "checkbox") {
      values[element.name] = element.checked;
    } else {
      values[element.name] = element.value;
    }
  }
  return values;
}

function restoreFormValues(form: HTMLFormElement, candidate: unknown): void {
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) return;
  const values = candidate as Record<string, unknown>;
  for (const element of Array.from(form.elements)) {
    if (!isFormControl(element) || !persistable(element) || !Object.hasOwn(values, element.name)) continue;
    const value = values[element.name];
    if (element instanceof HTMLInputElement && element.type === "checkbox") {
      if (typeof value === "boolean") element.checked = value;
    } else if (element instanceof HTMLInputElement && element.type === "radio") {
      if (typeof value === "string") element.checked = element.value === value;
    } else if (typeof value === "string") {
      element.value = value;
    }
  }
}

export function useSessionDraft(key: string, ownerId: string | null | undefined, state: ActionState) {
  const formRef = useRef<HTMLFormElement>(null);
  const storageKey = sessionDraftStorageKey(ownerId, key);
  const previousStorageKey = useRef(storageKey);

  const persist = useCallback((form: HTMLFormElement) => {
    if (!storageKey) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(formValues(form)));
    } catch {
      // A disabled or full sessionStorage must not prevent saving the form.
    }
  }, [storageKey]);

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;

    if (previousStorageKey.current !== storageKey) {
      form.reset();
      previousStorageKey.current = storageKey;
    }

    try {
      removeLegacySessionDrafts(sessionStorage);
      if (!storageKey) return;
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return;
      restoreFormValues(form, JSON.parse(raw) as unknown);
    } catch {
      // Storage failures are non-fatal; never include field content in logs.
      removeSessionDraftForForm(sessionStorage, ownerId, key);
    }
  }, [key, ownerId, storageKey]);

  useEffect(() => {
    if (state.status !== "success" || !storageKey) return;
    try {
      removeSessionDraftForForm(sessionStorage, ownerId, key);
    } catch {
      // Ignore unavailable browser storage after a successful save.
    }
  }, [key, ownerId, state, storageKey]);

  useEffect(() => {
    const form = formRef.current;
    if (!form || !storageKey || state.status !== "error") return;
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) restoreFormValues(form, JSON.parse(raw) as unknown);
    } catch {
      // Keep the rendered form values if browser storage is unavailable or malformed.
    }
  }, [state, storageKey]);

  const onInputCapture = useCallback((event: FormEvent<HTMLFormElement>) => persist(event.currentTarget), [persist]);
  const onChangeCapture = useCallback((event: FormEvent<HTMLFormElement>) => persist(event.currentTarget), [persist]);

  return { formRef, onInputCapture, onChangeCapture };
}
