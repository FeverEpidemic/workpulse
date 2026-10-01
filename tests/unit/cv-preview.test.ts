import { describe, expect, it } from "vitest";

import { buildCvPreviewModel } from "@/domain/cv/preview";

import { documentRow, graduateItems, uuid } from "./cv-fixtures";

describe("T19 CV preview model", () => {
  it("orders sections, nests the child achievement once and omits empty sections", () => {
    const model = buildCvPreviewModel({ document: documentRow(), items: graduateItems() });
    expect(model.sections.map((section) => section.key)).toEqual(["projects", "achievements", "education", "skills"]);
    const project = model.sections[0]!.entries[0]!;
    expect(project.children.map((child) => child.itemId)).toEqual([uuid(3)]);
    expect(model.sections[1]!.entries.map((entry) => entry.itemId)).toEqual([uuid(4)]);
    const all = model.sections.flatMap((section) => section.entries.flatMap((entry) => [entry.itemId, ...entry.children.map((c) => c.itemId)]));
    expect(all.filter((id) => id === uuid(3))).toHaveLength(1);
  });

  it("follows the section order", () => {
    const model = buildCvPreviewModel({
      document: documentRow({ section_order: ["education", "skills", "projects", "achievements", "experience", "certifications"] }),
      items: graduateItems(),
    });
    expect(model.sections.map((section) => section.key)).toEqual(["education", "skills", "projects", "achievements"]);
  });

  it("uses override wording, marks overrides and deleted sources", () => {
    const items = graduateItems();
    items[2] = { ...items[2]!, override_text: "Custom bullet" };
    items[3] = { ...items[3]!, source_deleted: true, achievement_id: null };
    const model = buildCvPreviewModel({ document: documentRow(), items });
    const child = model.sections[0]!.entries[0]!.children[0];
    expect(child).toMatchObject({ text: "Custom bullet", hasOverride: true, deleted: false });
    expect(model.sections[1]!.entries[0]).toMatchObject({ deleted: true, hasOverride: false, text: "Bullet 302" });
  });

  it("switches labels and date format by CV locale without translating source content", () => {
    const en = buildCvPreviewModel({ document: documentRow({ locale: "en" }), items: graduateItems() });
    const id = buildCvPreviewModel({ document: documentRow({ locale: "id" }), items: graduateItems() });
    expect(en.sections[2]!.heading).toBe("Education");
    expect(id.sections[2]!.heading).toBe("Pendidikan");
    expect(en.sections[2]!.entries[0]).toMatchObject({ headline: "S1, Informatika", subline: "Universitas Contoh", dates: "2019 – 2023" });
    expect(id.sections[0]!.entries[0]!.headline).toBe(en.sections[0]!.entries[0]!.headline);
    expect(id.sections[0]!.entries[0]!.text).toBe("Deskripsi skripsi");
  });

  it("resolves the profile and summary from the saved document", () => {
    const document = documentRow({ summary_override: "Mine", title: "CV Ani" });
    const model = buildCvPreviewModel({ document, items: [] });
    expect(model).toMatchObject({ title: "CV Ani", summary: "Mine", sections: [] });
    expect(model.profile.display_name).toBe("Ani Contoh");
  });
});
