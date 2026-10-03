import { describe, expect, it } from "vitest";

import {
  availableActions,
  bulkRefreshResolutions,
  diffDisplayFields,
  diffProfileFields,
  indexFreshness,
  needsReview,
  primaryAction,
  reviewCount,
} from "@/domain/cv/freshness";
import type { CvFreshnessRow } from "@/domain/cv/contracts";

import {
  achievementSnapshot,
  certificationSnapshot,
  educationSnapshot,
  experienceSnapshot,
  projectSnapshot,
  skillSnapshot,
  uuid,
} from "./cv-fixtures";

function itemRow(n: number, state: CvFreshnessRow["state"], liveRevision: number | null = 5): CvFreshnessRow {
  return {
    target: "item", item_id: uuid(n), state, live_revision: liveRevision,
    live_snapshot: state === "changed" || state === "kept" ? achievementSnapshot(uuid(900 + n)) : null,
  } as CvFreshnessRow;
}

const profileRow = (state: "fresh" | "changed" | "kept"): CvFreshnessRow => ({
  target: "profile", item_id: null, state, live_revision: 7,
  live_snapshot: state === "fresh" ? null : { display_name: "Ani", headline: null, summary: null, contact_email: null, phone: null, location: null, website: null },
});

describe("T20 CV freshness rules", () => {
  it("flags changed, deleted and unconfirmed for review, nothing else", () => {
    expect(needsReview("changed")).toBe(true);
    expect(needsReview("deleted")).toBe(true);
    expect(needsReview("unconfirmed")).toBe(true);
    expect(needsReview("fresh")).toBe(false);
    expect(needsReview("kept")).toBe(false);
  });

  describe("actions per state (decision 0026, point 3)", () => {
    for (const target of ["item", "profile"] as const) {
      it(`${target}: changed without wording refreshes first and may keep the saved wording`, () => {
        const actions = availableActions({ state: "changed", hasOverride: false, target });
        expect(actions).toEqual([
          { id: "refresh", action: "refresh", primary: true },
          { id: "keep_saved", action: "keep", primary: false },
        ]);
        expect(primaryAction({ state: "changed", hasOverride: false, target })?.id).toBe("refresh");
      });

      it(`${target}: changed with manual wording keeps the wording by refreshing details, or replaces explicitly`, () => {
        const actions = availableActions({ state: "changed", hasOverride: true, target });
        expect(actions).toEqual([
          { id: "keep_mine", action: "refresh", primary: true },
          { id: "replace", action: "replace", primary: false },
        ]);
        // The override-preserving choice is the default; Replace is never the primary action.
        expect(primaryAction({ state: "changed", hasOverride: true, target })?.action).toBe("refresh");
      });

      it(`${target}: kept only offers an optional refresh, with or without wording`, () => {
        expect(availableActions({ state: "kept", hasOverride: false, target })).toEqual([{ id: "refresh", action: "refresh", primary: false }]);
        expect(availableActions({ state: "kept", hasOverride: true, target })).toEqual([{ id: "refresh", action: "refresh", primary: false }]);
        expect(primaryAction({ state: "kept", hasOverride: false, target })).toBeNull();
      });

      it(`${target}: fresh, deleted and unconfirmed offer no resolution`, () => {
        for (const state of ["fresh", "deleted", "unconfirmed"] as const) {
          for (const hasOverride of [false, true]) {
            expect(availableActions({ state, hasOverride, target })).toEqual([]);
            expect(primaryAction({ state, hasOverride, target })).toBeNull();
          }
        }
      });
    }
  });

  describe("index and counts", () => {
    const rows = [itemRow(1, "changed"), itemRow(2, "fresh", 3), itemRow(3, "deleted", null), itemRow(4, "unconfirmed"), itemRow(5, "kept"), profileRow("changed")];

    it("indexes item rows by id and keeps the profile row apart", () => {
      const index = indexFreshness(rows);
      expect(index.items.get(uuid(1))).toMatchObject({ state: "changed", liveRevision: 5 });
      expect(index.items.get(uuid(3))).toMatchObject({ state: "deleted", liveRevision: null, liveSnapshot: null });
      expect(index.items.size).toBe(5);
      expect(index.profile).toMatchObject({ state: "changed", liveRevision: 7 });
      expect(indexFreshness([itemRow(1, "fresh")]).profile).toBeNull();
    });

    it("counts changed, deleted and unconfirmed items plus a changed profile", () => {
      expect(reviewCount(rows)).toBe(4);
      expect(reviewCount([...rows.slice(0, 5), profileRow("kept")])).toBe(3);
      expect(reviewCount([...rows.slice(0, 5), profileRow("fresh")])).toBe(3);
      expect(reviewCount([])).toBe(0);
    });
  });

  describe("bulk refresh", () => {
    it("selects only changed items without manual wording and carries the live revision", () => {
      const rows = [itemRow(1, "changed", 9), itemRow(2, "changed", 4), itemRow(3, "kept"), itemRow(4, "fresh"), itemRow(5, "deleted", null), itemRow(6, "unconfirmed"), profileRow("changed")];
      const items = [
        { id: uuid(1), override_text: null },
        { id: uuid(2), override_text: "Wording saya" },
        { id: uuid(3), override_text: null },
        { id: uuid(4), override_text: null },
        { id: uuid(5), override_text: null },
        { id: uuid(6), override_text: null },
      ];
      expect(bulkRefreshResolutions(rows, items)).toEqual([{ target: "item", item_id: uuid(1), source_revision: 9, action: "refresh" }]);
    });

    it("never includes the profile, an unknown item or a changed item without a live revision", () => {
      const rows = [itemRow(1, "changed", null), itemRow(2, "changed"), profileRow("changed")];
      expect(bulkRefreshResolutions(rows, [{ id: uuid(1), override_text: null }])).toEqual([]);
      expect(bulkRefreshResolutions([], [])).toEqual([]);
    });

    it("stops at the 200-resolution limit of the RPC", () => {
      const rows = Array.from({ length: 205 }, (_, n) => itemRow(n + 1, "changed"));
      const items = rows.map((row) => ({ id: row.item_id as string, override_text: null }));
      expect(bulkRefreshResolutions(rows, items)).toHaveLength(200);
    });
  });

  describe("display differences", () => {
    const id = uuid(500);

    it("lists only the displayed fields that differ, per source type", () => {
      expect(diffDisplayFields(experienceSnapshot(id), experienceSnapshot(id, { role_title: "Lead" }), "en"))
        .toEqual({ fields: [{ field: "headline", saved: "Analis", live: "Lead" }], contextChanged: false });
      expect(diffDisplayFields(projectSnapshot(id), projectSnapshot(id, { title: "Baru", description: "Deskripsi baru" }), "en").fields.map((entry) => entry.field))
        .toEqual(["headline", "text"]);
      expect(diffDisplayFields(achievementSnapshot(id), achievementSnapshot(id, { cv_bullet: "Kalimat baru" }), "en").fields)
        .toEqual([{ field: "text", saved: "Bullet " + id.slice(-3), live: "Kalimat baru" }]);
      expect(diffDisplayFields(educationSnapshot(id), educationSnapshot(id, { institution: "Kampus Baru" }), "en").fields)
        .toEqual([{ field: "subline", saved: "Universitas Contoh", live: "Kampus Baru" }]);
      expect(diffDisplayFields(skillSnapshot(id, "SQL"), skillSnapshot(id, "PostgreSQL"), "en").fields)
        .toEqual([{ field: "headline", saved: "SQL", live: "PostgreSQL" }]);
      expect(diffDisplayFields(certificationSnapshot(id), { ...certificationSnapshot(id), issuer: "Badan X" } as ReturnType<typeof certificationSnapshot>, "en").fields)
        .toEqual([{ field: "subline", saved: null, live: "Badan X" }]);
    });

    it("formats partial dates by the CV locale and never invents a date for unknown values", () => {
      const saved = educationSnapshot(id);
      const live = educationSnapshot(id, { end_date: "2024-01-01", end_precision: "year" });
      expect(diffDisplayFields(saved, live, "en").fields).toEqual([{ field: "dates", saved: "2019 – 2023", live: "2019 – 2024" }]);
      const unknown = educationSnapshot(id, { start_date: null, start_precision: null, end_date: null, end_precision: null });
      expect(diffDisplayFields(saved, unknown, "id").fields).toEqual([{ field: "dates", saved: "2019 – 2023", live: null }]);
      const month = experienceSnapshot(id, { start_date: "2023-03-01", start_precision: "month" });
      const nextMonth = experienceSnapshot(id, { start_date: "2023-04-01", start_precision: "month" });
      expect(diffDisplayFields(month, nextMonth, "id").fields[0]).toMatchObject({ field: "dates", saved: "Mar 2023 – Sekarang", live: "Apr 2023 – Sekarang" });
      expect(diffDisplayFields(month, nextMonth, "en").fields[0]).toMatchObject({ saved: "Mar 2023 – Present" });
    });

    it("does not translate source content", () => {
      const result = diffDisplayFields(achievementSnapshot(id, { cv_bullet: "Merancang sistem" }), achievementSnapshot(id, { cv_bullet: "Designed a system" }), "id");
      expect(result.fields).toEqual([{ field: "text", saved: "Merancang sistem", live: "Designed a system" }]);
    });

    it("reports a context change when only a parent link moved", () => {
      const result = diffDisplayFields(achievementSnapshot(id), achievementSnapshot(id, { project_id: uuid(600) }), "en");
      expect(result).toEqual({ fields: [], contextChanged: true });
      expect(diffDisplayFields(projectSnapshot(id), projectSnapshot(id, { experience_id: uuid(601) }), "en").contextChanged).toBe(true);
      expect(diffDisplayFields(achievementSnapshot(id), achievementSnapshot(id), "en")).toEqual({ fields: [], contextChanged: false });
    });

    it("compares the seven profile fields and ignores overrides and the schema marker", () => {
      const saved = {
        schema_version: "cv-profile.v1" as const, display_name: "Ani", headline: "Graduate", summary: "Ringkasan", contact_email: "ani@example.com",
        phone: null, location: null, website: null, display_overrides: { headline: "Headline saya" },
      };
      const live = { display_name: "Ani Baru", headline: "Graduate", summary: "Ringkasan", contact_email: "ani@example.com", phone: "+62 812", location: null, website: null };
      expect(diffProfileFields(saved, live)).toEqual([
        { field: "display_name", saved: "Ani", live: "Ani Baru" },
        { field: "phone", saved: null, live: "+62 812" },
      ]);
      expect(diffProfileFields({ ...saved, display_overrides: undefined }, { ...live, display_name: "Ani", phone: null })).toEqual([]);
      // A missing key in an old snapshot reads as unset.
      expect(diffProfileFields({ display_name: "Ani" }, { ...live, display_name: "Ani", headline: null, summary: null, contact_email: null, phone: null })).toEqual([]);
    });
  });
});
