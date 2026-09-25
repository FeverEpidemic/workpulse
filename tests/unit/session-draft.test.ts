import { describe, expect, it } from "vitest";

import {
  isPersistableDraftField,
  hasSessionDraft,
  readSessionDraftMetadata,
  removeLegacySessionDrafts,
  removeSessionDraftForForm,
  removeSessionDraftsForOwner,
  sessionDraftStorageKey,
  sessionDraftMetadataStorageKey,
  writeSessionDraftMetadata,
  type SessionDraftStorage,
} from "@/components/forms/session-draft";

class MemoryStorage implements SessionDraftStorage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  keys(): string[] {
    return [...this.values.keys()];
  }
}

describe("owner-scoped session drafts", () => {
  it("requires an owner and separates drafts by owner and form", () => {
    expect(sessionDraftStorageKey(null, "profile-settings")).toBeNull();
    expect(sessionDraftStorageKey("  ", "profile-settings")).toBeNull();
    expect(sessionDraftStorageKey("user-a", "")).toBeNull();
    expect(sessionDraftStorageKey("user-a", "profile-settings")).toBe("workpulse:draft:v2:user-a:profile-settings");
    expect(sessionDraftStorageKey("user-a", "profile-settings")).not.toBe(sessionDraftStorageKey("user-b", "profile-settings"));
    expect(sessionDraftStorageKey("user-a", "profile-settings")).not.toBe(sessionDraftStorageKey("user-a", "new"));
  });

  it("removes legacy unscoped drafts without touching versioned drafts", () => {
    const storage = new MemoryStorage();
    storage.setItem("workpulse:draft:profile-settings", "old profile");
    storage.setItem("workpulse:draft:onboarding-profile", "old onboarding");
    storage.setItem("workpulse:draft:v2:user-a:profile-settings", "user a");
    storage.setItem("another:key", "other data");

    removeLegacySessionDrafts(storage);

    expect(storage.keys()).toEqual([
      "workpulse:draft:v2:user-a:profile-settings",
      "another:key",
    ]);
  });

  it("clears only one owner's namespaced drafts", () => {
    const storage = new MemoryStorage();
    storage.setItem("workpulse:draft:v2:user-a:profile-settings", "a profile");
    storage.setItem("workpulse:draft:v2:user-a:experience-new", "a experience");
    storage.setItem("workpulse:draft:v2:user-ab:profile-settings", "ab profile");
    storage.setItem("workpulse:draft:v2:user-b:profile-settings", "b profile");

    removeSessionDraftsForOwner(storage, "user-a");

    expect(storage.keys()).toEqual([
      "workpulse:draft:v2:user-ab:profile-settings",
      "workpulse:draft:v2:user-b:profile-settings",
    ]);
  });

  it("clears only the selected owner's form draft", () => {
    const storage = new MemoryStorage();
    storage.setItem("workpulse:draft:v2:user-a:profile-settings", "profile draft");
    storage.setItem("workpulse:draft:v2:user-a:profile-settings:metadata:v1", "profile metadata");
    storage.setItem("workpulse:draft:v2:user-a:foundation-skill-new", "skill draft");
    storage.setItem("workpulse:draft:v2:user-b:profile-settings", "other user draft");

    removeSessionDraftForForm(storage, "user-a", "profile-settings");

    expect(storage.keys()).toEqual([
      "workpulse:draft:v2:user-a:foundation-skill-new",
      "workpulse:draft:v2:user-b:profile-settings",
    ]);
  });

  it("stores activity base revision metadata separately from form values", () => {
    const storage = new MemoryStorage();
    const metadataKey = sessionDraftMetadataStorageKey("user-a", "activity-edit:one");

    expect(metadataKey).toBe("workpulse:draft:v2:user-a:activity-edit%3Aone:metadata:v1");
    expect(readSessionDraftMetadata(storage, "user-a", "activity-edit:one")).toEqual({ status: "missing" });

    storage.setItem(sessionDraftStorageKey("user-a", "activity-edit:one")!, JSON.stringify({ raw_text: "local" }));
    writeSessionDraftMetadata(storage, "user-a", "activity-edit:one", 4);

    expect(hasSessionDraft(storage, "user-a", "activity-edit:one")).toBe(true);
    expect(readSessionDraftMetadata(storage, "user-a", "activity-edit:one")).toEqual({
      status: "valid",
      metadata: { schemaVersion: 1, baseRevision: 4 },
    });
    expect(JSON.parse(storage.getItem(metadataKey!)!)).toEqual({ schemaVersion: 1, baseRevision: 4 });
  });

  it("treats malformed or legacy metadata as unknown without accepting private values", () => {
    const storage = new MemoryStorage();
    const metadataKey = sessionDraftMetadataStorageKey("user-a", "activity-edit");
    storage.setItem(metadataKey!, JSON.stringify({ schemaVersion: 1, baseRevision: "latest private source" }));

    expect(readSessionDraftMetadata(storage, "user-a", "activity-edit")).toEqual({ status: "invalid" });
  });

  it("persists only named, enabled, editable fields with safe control types", () => {
    expect(isPersistableDraftField("display_name", "text", "input")).toBe(true);
    expect(isPersistableDraftField("locale", "", "select")).toBe(true);
    expect(isPersistableDraftField("summary", "", "textarea")).toBe(true);
    expect(isPersistableDraftField("is_current", "checkbox", "input")).toBe(true);

    for (const name of ["id", "kind", "expected_revision", "user_id", "owner_id", "revision", "created_at"]) {
      expect(isPersistableDraftField(name, "text", "input")).toBe(false);
    }
    for (const type of ["password", "hidden", "file", "submit", "button", "reset", "image"]) {
      expect(isPersistableDraftField("value", type, "input")).toBe(false);
    }
    expect(isPersistableDraftField("value", "text", "input", true)).toBe(false);
    expect(isPersistableDraftField("value", "text", "input", false, true)).toBe(false);
    expect(isPersistableDraftField("", "text", "input")).toBe(false);
    expect(isPersistableDraftField("action", "", "button")).toBe(false);
  });
});
