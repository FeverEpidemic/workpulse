import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { EducationRow, ExperienceRow } from "@/domain/database-types";
import { FoundationEditors } from "@/features/profile/foundation-editors";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const OWNER_ID = "b3604674-f6d4-4382-a253-ec8af2560a86";
const EXPERIENCE_ID = "2fd50de3-b317-4515-b76e-8425909c0b15";
const EDUCATION_ID = "120886f3-6f71-4f43-8f1b-045bc20e3fa1";

const experience: ExperienceRow = {
  id: EXPERIENCE_ID,
  user_id: OWNER_ID,
  organization: "Northwind",
  role_title: "Analyst",
  description: null,
  kind: "employment",
  start_date: "2021-03-01",
  start_precision: "month",
  end_date: "2023-06-01",
  end_precision: "month",
  is_current: false,
  created_at: "2026-09-26T00:00:00.000Z",
  updated_at: "2026-09-26T00:00:00.000Z",
  revision: 1,
};

const education: EducationRow = {
  id: EDUCATION_ID,
  user_id: OWNER_ID,
  institution: "Universitas Indonesia",
  qualification: "S.Kom",
  field_of_study: null,
  description: null,
  start_date: "2016-01-01",
  start_precision: "year",
  end_date: "2020-01-01",
  end_precision: "year",
  is_current: false,
  created_at: "2026-09-26T00:00:00.000Z",
  updated_at: "2026-09-26T00:00:00.000Z",
  revision: 1,
};

function render(openRecordId?: string): string {
  return renderToStaticMarkup(
    <FoundationEditors
      ownerId={OWNER_ID}
      experiences={[experience]}
      education={[education]}
      certifications={[]}
      skills={[]}
      releaseCounts={{}}
      releaseCountUnavailable={false}
      locale="en"
      openRecordId={openRecordId}
    />,
  );
}

describe("profile record deep links", () => {
  it("opens only the matching experience or education record", () => {
    const html = render(EXPERIENCE_ID);
    expect(html).toContain(`id="experience-${EXPERIENCE_ID}" open=""`);
    expect(html).toContain(`id="education-${EDUCATION_ID}"`);
    expect(html).not.toMatch(new RegExp(`<details[^>]*id="education-${EDUCATION_ID}"[^>]*open`));
  });

  it("leaves record editors closed for an unrelated target", () => {
    const html = render("d4c19443-e40f-468c-824c-a51e2f7990ba");
    expect(html).not.toMatch(new RegExp(`<details[^>]*id="experience-${EXPERIENCE_ID}"[^>]*open`));
    expect(html).not.toMatch(new RegExp(`<details[^>]*id="education-${EDUCATION_ID}"[^>]*open`));
  });
});
