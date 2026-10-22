"use client";

import { useEffect } from "react";

export const JUST_ADDED_KEY = "workpulse-just-added";

export function matchesJustAdded(serialized: string | null, activityId: string, now: number): boolean {
  if (!serialized) return false;
  try {
    const entry: unknown = JSON.parse(serialized);
    if (!entry || typeof entry !== "object" || !("id" in entry) || !("at" in entry)) return false;
    if (typeof entry.id !== "string" || typeof entry.at !== "number" || !Number.isFinite(entry.at)) return false;
    const age = now - entry.at;
    return entry.id === activityId && age >= 0 && age < 10_000;
  } catch { return false; }
}

export function rememberJustAdded(id: string): void {
  try { sessionStorage.setItem(JUST_ADDED_KEY, JSON.stringify({ id, at: Date.now() })); } catch { /* Storage can be disabled; saving still succeeds. */ }
}

export function JustAddedHighlight({ ids }: { ids: readonly string[] }) {
  useEffect(() => {
    try {
      const marker = sessionStorage.getItem(JUST_ADDED_KEY);
      const now = Date.now();
      const id = ids.find((candidate) => matchesJustAdded(marker, candidate, now));
      if (!id) return;
      const row = [...document.querySelectorAll<HTMLElement>("[data-activity-id]")].find((entry) => entry.dataset.activityId === id);
      if (!row) return;
      row.dataset.justAdded = "true";
      sessionStorage.removeItem(JUST_ADDED_KEY);
    } catch { /* Highlight is optional when browser storage is unavailable. */ }
  }, [ids]);
  return null;
}
