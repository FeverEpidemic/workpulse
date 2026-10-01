import { describe, expect, it } from "vitest";

import { CV_SECTION_KEYS } from "@/domain/cv/contracts";
import { actionFailure } from "@/server/action-result";
import {
  achievementPlacements, announcedPosition, clientCorrelationId, deriveSaveState, fieldElementId, firstInvalidField, initialPoolOpen, isStaleConflict,
} from "@/features/cv/cv-builder-state";

import { uuid } from "./cv-fixtures";

const base = { saving: false, busy: false, dirty: false, conflict: false, unresolved: [] as string[], problems: {} };

describe("T19 S13 editor state", () => {
  it("reports saved, unsaved, saving and conflict and enables Save only for a valid, resolved, idle change", () => {
    expect(deriveSaveState(base)).toEqual({ status: "saved", canSave: false, showConflict: false });
    expect(deriveSaveState({ ...base, dirty: true })).toEqual({ status: "unsaved", canSave: true, showConflict: false });
    expect(deriveSaveState({ ...base, dirty: true, saving: true })).toMatchObject({ status: "saving", canSave: false });
    expect(deriveSaveState({ ...base, dirty: true, busy: true })).toMatchObject({ status: "unsaved", canSave: false });
    expect(deriveSaveState({ ...base, dirty: true, problems: { title: "required" } })).toMatchObject({ canSave: false });
    expect(deriveSaveState({ ...base, dirty: true, unresolved: ["summary"] })).toEqual({ status: "conflict", canSave: false, showConflict: true });
  });

  it("keeps the conflict panel after a stale save only while there is local text to protect", () => {
    expect(deriveSaveState({ ...base, conflict: true, dirty: true }).showConflict).toBe(true);
    expect(deriveSaveState({ ...base, conflict: true, dirty: false }).showConflict).toBe(false);
  });

  it("recognises only the stale-revision answer as a reloadable conflict", () => {
    expect(isStaleConflict(actionFailure("CONFLICT", "error.conflict"))).toBe(true);
    expect(isStaleConflict(actionFailure("CONFLICT", "cv.error.childItemsExist"))).toBe(false);
    expect(isStaleConflict(actionFailure("VALIDATION", "error.validation"))).toBe(false);
    expect(isStaleConflict({ status: "idle" })).toBe(false);
  });

  it("maps draft fields to their inputs and focuses the first invalid one, opening its wording editor", () => {
    expect(fieldElementId("title")).toBe("cv-title");
    expect(fieldElementId("summary")).toBe("cv-summary");
    expect(fieldElementId("profile.website")).toBe("cv-website");
    expect(fieldElementId(`item.${uuid(3)}`)).toBe(`cv-wording-input-${uuid(3)}`);
    expect(firstInvalidField({})).toBeNull();
    expect(firstInvalidField({ [`item.${uuid(3)}`]: "too_long" })).toEqual({ elementId: `cv-wording-input-${uuid(3)}`, openItemId: uuid(3) });
    expect(firstInvalidField({ "profile.contact_email": "invalid" })).toEqual({ elementId: "cv-contact_email", openItemId: null });
  });

  it("announces the 1-based position after a move", () => {
    expect(announcedPosition(1, "up")).toBe(1);
    expect(announcedPosition(0, "down")).toBe(2);
  });

  it("opens the available list for empty sections and for the suggested record only", () => {
    const open = initialPoolOpen(CV_SECTION_KEYS, (key) => (key === "projects" ? 2 : key === "achievements" ? 1 : 0), (key) => key === "achievements");
    expect(open).toMatchObject({ experience: true, projects: false, achievements: true, education: true });
  });

  it("names the parent of every achievement that renders under a project or an experience", () => {
    const child = (id: string, type = "achievement") => ({ row: { source_snapshot: { source_type: type, source_id: id } } });
    const empty = Object.fromEntries(CV_SECTION_KEYS.map((key) => [key, []])) as unknown as Parameters<typeof achievementPlacements>[0];
    const placements = achievementPlacements({
      ...empty,
      projects: [{ headline: "Skripsi Sistem Antrian", children: [child(uuid(301))] }],
      experience: [{ headline: "Analis", children: [child(uuid(305)), child(uuid(306), "project")] }],
      achievements: [{ headline: "Standalone", children: [child(uuid(302))] }],
    });
    expect(placements).toEqual({ [uuid(301)]: "Skripsi Sistem Antrian", [uuid(305)]: "Analis" });
  });

  it("gives client-side failures a correlation id", () => {
    expect(clientCorrelationId()).toMatch(/^[0-9a-f-]{36}$/);
  });
});
