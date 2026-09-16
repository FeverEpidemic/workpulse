"use client";

import { useEffect, useRef, useState } from "react";

import type { ActionState } from "@/server/action-result";

const operationKeyPrefix = "workpulse:operation:v1:";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function operationKeyStorageKey(ownerId: string | null | undefined, formKey: string | null | undefined): string | null {
  if (!ownerId?.trim() || !formKey?.trim()) return null;
  return `${operationKeyPrefix}${encodeURIComponent(ownerId)}:${encodeURIComponent(formKey)}`;
}

export function isOperationKey(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function newOperationKey(): string | null {
  try {
    const value = globalThis.crypto?.randomUUID();
    return isOperationKey(value) ? value : null;
  } catch {
    return null;
  }
}

interface OperationKeyState {
  storageKey: string | null;
  value: string | null;
}

export function useCreateOperationKey(
  ownerId: string | null | undefined,
  formKey: string | null | undefined,
  state: ActionState,
): string | null {
  const storageKey = operationKeyStorageKey(ownerId, formKey);
  const [keyState, setKeyState] = useState<OperationKeyState>({ storageKey: null, value: null });
  const handledSuccessId = useRef<string | null>(null);
  const successId = state.status === "success" ? state.correlationId : null;

  useEffect(() => {
    if (!storageKey) return;

    try {
      const storedKey = sessionStorage.getItem(storageKey);
      const key = isOperationKey(storedKey) ? storedKey : newOperationKey();
      if (!key) {
        queueMicrotask(() => setKeyState({ storageKey, value: null }));
        return;
      }
      sessionStorage.setItem(storageKey, key);
      queueMicrotask(() => setKeyState({ storageKey, value: key }));
    } catch {
      // A create stays disabled when its retry key cannot be persisted safely.
      queueMicrotask(() => setKeyState({ storageKey, value: null }));
    }
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || !successId || handledSuccessId.current === successId) return;
    handledSuccessId.current = successId;
    const key = newOperationKey();
    if (!key) {
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        // The form remains disabled until a new durable key can be established.
      }
      queueMicrotask(() => setKeyState({ storageKey, value: null }));
      return;
    }

    try {
      sessionStorage.setItem(storageKey, key);
      queueMicrotask(() => setKeyState({ storageKey, value: key }));
    } catch {
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        // Ignore unavailable browser storage.
      }
      queueMicrotask(() => setKeyState({ storageKey, value: null }));
    }
  }, [storageKey, successId]);

  return keyState.storageKey === storageKey ? keyState.value : null;
}
