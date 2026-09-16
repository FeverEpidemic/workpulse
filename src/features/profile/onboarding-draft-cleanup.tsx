"use client";

import { useEffect } from "react";

import { sessionDraftStorageKey } from "@/components/forms/session-draft";

export function OnboardingDraftCleanup({ ownerId }: { ownerId: string }) {
  const storageKey = sessionDraftStorageKey(ownerId, "onboarding-profile");

  useEffect(() => {
    if (!storageKey) return;
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      // Browser storage is optional; successful onboarding must still continue.
    }
  }, [storageKey]);

  return null;
}
