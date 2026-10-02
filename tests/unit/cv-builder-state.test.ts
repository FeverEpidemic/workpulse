import { describe, expect, it } from "vitest";

import { CV_SECTION_KEYS } from "@/domain/cv/contracts";
import type { CvFreshnessRow } from "@/domain/cv/contracts";
import { actionFailure } from "@/server/action-result";
import {
  achievementPlacements, announcedPosition, choiceKeys, clientCorrelationId, deriveSaveState, fieldElementId, firstInvalidField, initialPoolOpen,
  BULK_FOCUS_CANDIDATES, isReviewBlocked, isSourceChangedConflict, isStaleConflict, reviewFocusCandidates, reviewSummaryKey, reviewTargets, singleResolution, stateBadge,
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

describe("T20 S13 review state", () => {
  const snapshot = {
    schema_version: "cv-source.v1" as const, source_type: "skill" as const, source_id: uuid(401), name: "SQL",
  };
  const itemRow = (n: number, state: CvFreshnessRow["state"], live: number | null = 6): CvFreshnessRow => ({
    target: "item", item_id: uuid(n), state, live_revision: live,
    live_snapshot: state === "changed" || state === "kept" ? snapshot : null,
  }) as CvFreshnessRow;
  const profileRow = (state: "fresh" | "changed" | "kept"): CvFreshnessRow => ({
    target: "profile", item_id: null, state, live_revision: 9,
    live_snapshot: state === "fresh" ? null : { display_name: "Ani", headline: null, summary: null, contact_email: null, phone: null, location: null, website: null },
  });

  it("shows a text badge for every state that needs the user's attention and none for fresh", () => {
    expect(stateBadge("changed")).toEqual({ messageKey: "cv.badge.sourceChanged", variant: "warning" });
    expect(stateBadge("kept")).toEqual({ messageKey: "cv.badge.keptWording", variant: "neutral" });
    expect(stateBadge("deleted")).toEqual({ messageKey: "cv.badge.sourceDeleted", variant: "warning" });
    expect(stateBadge("unconfirmed")).toEqual({ messageKey: "cv.badge.sourceUnconfirmed", variant: "warning" });
    expect(stateBadge("fresh")).toBeNull();
  });

  it("lists the review targets with the profile first and the items in database order", () => {
    const rows = [itemRow(1, "changed"), itemRow(2, "fresh"), itemRow(3, "deleted", null), itemRow(4, "kept"), itemRow(5, "unconfirmed"), profileRow("changed")];
    expect(reviewTargets(rows)).toEqual([
      { kind: "profile", itemId: null, state: "changed" },
      { kind: "item", itemId: uuid(1), state: "changed" },
      { kind: "item", itemId: uuid(3), state: "deleted" },
      { kind: "item", itemId: uuid(5), state: "unconfirmed" },
    ]);
    expect(reviewTargets([itemRow(1, "fresh"), profileRow("kept")])).toEqual([]);
    expect(reviewTargets([])).toEqual([]);
  });

  it("picks the singular or plural summary heading", () => {
    expect(reviewSummaryKey(1)).toBe("cv.review.summaryOne");
    expect(reviewSummaryKey(0)).toBe("cv.review.summaryOther");
    expect(reviewSummaryKey(4)).toBe("cv.review.summaryOther");
  });

  it("blocks a review action while wording of that target is unsaved and only then", () => {
    const item = { kind: "item" as const, itemId: uuid(7) };
    expect(isReviewBlocked(item, [])).toBe(false);
    expect(isReviewBlocked(item, [`item.${uuid(8)}`, "title"])).toBe(false);
    expect(isReviewBlocked(item, [`item.${uuid(7)}`])).toBe(true);
    const profile = { kind: "profile" as const, itemId: null };
    expect(isReviewBlocked(profile, [`item.${uuid(7)}`, "title"])).toBe(false);
    expect(isReviewBlocked(profile, ["profile.headline"])).toBe(true);
    expect(isReviewBlocked(profile, ["summary"])).toBe(true);
  });

  it("builds a one-entry resolution from the live revision the user saw", () => {
    const entry = { state: "changed" as const, liveRevision: 6, liveSnapshot: snapshot };
    expect(singleResolution({ kind: "item", itemId: uuid(7) }, entry, { id: "refresh", action: "refresh", primary: true }))
      .toEqual({ target: "item", item_id: uuid(7), source_revision: 6, action: "refresh" });
    expect(singleResolution({ kind: "profile", itemId: null }, { ...entry, liveRevision: 9 }, { id: "keep_saved", action: "keep", primary: false }))
      .toEqual({ target: "profile", source_revision: 9, action: "keep" });
    expect(singleResolution({ kind: "item", itemId: uuid(7) }, { ...entry, liveRevision: null }, { id: "refresh", action: "refresh", primary: true })).toBeNull();
  });

  it("names the label, aria label and announcement of every choice", () => {
    expect(choiceKeys("refresh")).toEqual({ label: "cv.action.refreshFromSource", aria: "cv.aria.refreshFromSource", announce: "cv.announce.refreshed" });
    expect(choiceKeys("keep_saved")).toEqual({ label: "cv.action.keepSaved", aria: "cv.aria.keepSaved", announce: "cv.announce.keptSaved" });
    expect(choiceKeys("keep_mine")).toEqual({ label: "cv.action.keepMine", aria: "cv.aria.keepMine", announce: "cv.announce.keptMine" });
    expect(choiceKeys("replace")).toEqual({ label: "cv.action.replaceFromSource", aria: "cv.aria.replaceFromSource", announce: "cv.announce.replaced" });
  });

  it("returns focus to the review button, then the summary, then the section heading", () => {
    expect(reviewFocusCandidates({ kind: "item", itemId: uuid(7) }, "skills")).toEqual([`cv-review-open-${uuid(7)}`, "cv-review-heading", "cv-section-heading-skills"]);
    expect(reviewFocusCandidates({ kind: "profile", itemId: null }, null)).toEqual(["cv-review-open-profile", "cv-review-heading", "cv-profile-heading"]);
  });

  it("falls back from the summary to the settings panel after a bulk refresh", () => {
    expect([...BULK_FOCUS_CANDIDATES]).toEqual(["cv-review-heading", "cv-settings-heading"]);
  });

  it("reloads on a changed source without treating it as a stale revision", () => {
    expect(isSourceChangedConflict(actionFailure("CONFLICT", "cv.error.sourceChanged"))).toBe(true);
    expect(isSourceChangedConflict(actionFailure("CONFLICT", "error.conflict"))).toBe(false);
    expect(isSourceChangedConflict(actionFailure("VALIDATION", "cv.error.resolutionInvalid"))).toBe(false);
    expect(isSourceChangedConflict({ status: "idle" })).toBe(false);
    expect(isStaleConflict(actionFailure("CONFLICT", "cv.error.sourceChanged"))).toBe(false);
  });
});