import { describe, expect, it } from "vitest";

import type { CvSectionKey, CvSourceSnapshot } from "@/domain/cv/contracts";
import { buildCvOutline, type OutlineItemInput } from "@/domain/cv/outline";

const ORDER: CvSectionKey[] = ["experience", "projects", "achievements", "education", "skills", "certifications"];
let counter = 0;

function project(sourceId: string, position: number, deleted = false): OutlineItemInput {
  return {
    id: `item-${sourceId}`, section_key: "projects", position, source_deleted: deleted,
    source_snapshot: {
      schema_version: "cv-source.v1", source_type: "project", source_id: sourceId, title: `Project ${sourceId}`, description: null,
      user_role: null, outcome: null, status: "completed", start_date: null, start_precision: null, end_date: null,
      end_precision: null, is_current: false, experience_id: null,
    },
  };
}

function experience(sourceId: string, position: number): OutlineItemInput {
  return {
    id: `item-${sourceId}`, section_key: "experience", position, source_deleted: false,
    source_snapshot: {
      schema_version: "cv-source.v1", source_type: "experience", source_id: sourceId, organization: "Org", role_title: "Role",
      kind: "employment", description: null, start_date: null, start_precision: null, end_date: null, end_precision: null, is_current: false,
    },
  };
}

function achievement(id: string, position: number, context: { experience?: string; project?: string }): OutlineItemInput {
  counter += 1;
  const snapshot: CvSourceSnapshot = {
    schema_version: "cv-source.v1", source_type: "achievement", source_id: `src-${id}-${counter}`, title: id, cv_bullet: `Bullet ${id}`,
    achieved_on: "2024-01-01", experience_id: context.experience ?? null, project_id: context.project ?? null,
  };
  return { id: `item-${id}`, section_key: "achievements", position, source_deleted: false, source_snapshot: snapshot };
}

function skill(name: string, position: number): OutlineItemInput {
  return {
    id: `item-${name}`, section_key: "skills", position, source_deleted: false,
    source_snapshot: { schema_version: "cv-source.v1", source_type: "skill", source_id: `src-${name}`, name },
  };
}

function ids(entries: { item: { id: string }; children: { id: string }[] }[]) {
  return entries.map((entry) => [entry.item.id, ...entry.children.map((child) => child.id)]);
}

describe("T18 buildCvOutline", () => {
  it("places an achievement under its selected project", () => {
    const outline = buildCvOutline({
      sectionOrder: ORDER,
      items: [project("P1", 1), achievement("a1", 1, { project: "P1" })],
    });
    const projects = outline.sections.find((section) => section.key === "projects")!;
    expect(ids(projects.entries)).toEqual([["item-P1", "item-a1"]]);
    expect(outline.sections.find((section) => section.key === "achievements")!.entries).toEqual([]);
  });

  it("uses the experience when the project is not selected or absent", () => {
    const outline = buildCvOutline({
      sectionOrder: ORDER,
      items: [experience("E1", 1), achievement("a1", 1, { project: "P-not-selected", experience: "E1" }), achievement("a2", 2, { experience: "E1" })],
    });
    expect(ids(outline.sections.find((section) => section.key === "experience")!.entries)).toEqual([["item-E1", "item-a1", "item-a2"]]);
  });

  it("prefers the project when both parents are selected", () => {
    const outline = buildCvOutline({
      sectionOrder: ORDER,
      items: [experience("E1", 1), project("P1", 1), achievement("a1", 1, { project: "P1", experience: "E1" })],
    });
    expect(ids(outline.sections.find((section) => section.key === "projects")!.entries)).toEqual([["item-P1", "item-a1"]]);
    expect(ids(outline.sections.find((section) => section.key === "experience")!.entries)).toEqual([["item-E1"]]);
  });

  it("keeps a standalone achievement in the achievements section", () => {
    const outline = buildCvOutline({ sectionOrder: ORDER, items: [achievement("solo", 1, {})] });
    expect(ids(outline.sections.find((section) => section.key === "achievements")!.entries)).toEqual([["item-solo"]]);
  });

  it("renders every achievement exactly once", () => {
    const items = [
      experience("E1", 1), project("P1", 1),
      achievement("a1", 1, { project: "P1", experience: "E1" }), achievement("a2", 2, { experience: "E1" }),
      achievement("a3", 3, {}), achievement("a4", 4, { project: "P-missing" }),
    ];
    const outline = buildCvOutline({ sectionOrder: ORDER, items });
    const rendered = outline.sections.flatMap((section) => section.entries.flatMap((entry) => [entry.item.id, ...entry.children.map((c) => c.id)]));
    const achievementIds = rendered.filter((id) => id.startsWith("item-a"));
    expect(achievementIds.sort()).toEqual(["item-a1", "item-a2", "item-a3", "item-a4"]);
    expect(new Set(rendered).size).toBe(rendered.length);
  });

  it("follows section_order for sections and position for items", () => {
    const outline = buildCvOutline({
      sectionOrder: ["skills", "education", "experience", "projects", "achievements", "certifications"],
      items: [skill("B", 2), skill("A", 1), skill("C", 3)],
    });
    expect(outline.sections.map((section) => section.key)).toEqual(["skills", "education", "experience", "projects", "achievements", "certifications"]);
    expect(ids(outline.sections[0]!.entries)).toEqual([["item-A"], ["item-B"], ["item-C"]]);
  });

  it("orders children by position within their parent", () => {
    const outline = buildCvOutline({
      sectionOrder: ORDER,
      items: [project("P1", 1), achievement("late", 5, { project: "P1" }), achievement("early", 2, { project: "P1" })],
    });
    expect(ids(outline.sections.find((section) => section.key === "projects")!.entries)).toEqual([["item-P1", "item-early", "item-late"]]);
  });

  it("flags deleted items and still nests children under a deleted parent", () => {
    const outline = buildCvOutline({
      sectionOrder: ORDER,
      items: [project("P1", 1, true), achievement("a1", 1, { project: "P1" })],
    });
    const entry = outline.sections.find((section) => section.key === "projects")!.entries[0]!;
    expect(entry.deleted).toBe(true);
    expect(entry.children.map((child) => child.id)).toEqual(["item-a1"]);
  });

  it("is deterministic for equal positions", () => {
    const first = buildCvOutline({ sectionOrder: ORDER, items: [skill("B", 1), skill("A", 1)] });
    const second = buildCvOutline({ sectionOrder: ORDER, items: [skill("A", 1), skill("B", 1)] });
    expect(ids(first.sections.find((section) => section.key === "skills")!.entries)).toEqual(
      ids(second.sections.find((section) => section.key === "skills")!.entries),
    );
  });
});
