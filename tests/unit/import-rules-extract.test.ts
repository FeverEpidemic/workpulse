import { performance } from "node:perf_hooks";

import { describe, expect, it } from "vitest";

import { validateImportResult } from "@/domain/import/extract-result";
import { extractImportByRules, RULES_HEADINGS } from "@/domain/import/rules-extract";

import {
  RULES_CV_DATE_VARIANTS, RULES_CV_EN, RULES_CV_ID, RULES_CV_NO_HEADINGS, RULES_CV_TWO_COLUMN,
  RULES_CV_UNDATED_EXPERIENCE, RULES_HOSTILE_LINES,
} from "../import-fixtures";

const FIXTURES = {
  en: RULES_CV_EN,
  id: RULES_CV_ID,
  dates: RULES_CV_DATE_VARIANTS,
  noHeadings: RULES_CV_NO_HEADINGS,
  undated: RULES_CV_UNDATED_EXPERIENCE,
  twoColumn: RULES_CV_TWO_COLUMN,
};

function validated(text: string) {
  const result = validateImportResult(extractImportByRules(text), text);
  if (!result.ok) throw new Error("rules output failed validation");
  return result;
}

const date = (year: number, month: number | null = null) => ({ year, month, day: null });

describe("T26 rules extraction: output contract", () => {
  it.each(Object.entries(FIXTURES))("%s: passes validateImportResult with nothing dropped", (_name, text) => {
    const result = validateImportResult(extractImportByRules(text), text);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.summary.dropped_ungrounded).toBe(0);
  });

  it("every excerpt is a verbatim slice of the text", () => {
    for (const text of Object.values(FIXTURES)) {
      const raw = extractImportByRules(text);
      const excerpts = [
        ...(raw.profile ? [raw.profile.excerpt] : []),
        ...raw.experiences.map((item) => item.excerpt),
        ...raw.education.map((item) => item.excerpt),
        ...raw.skills.map((item) => item.excerpt),
      ];
      for (const excerpt of excerpts) {
        expect(text.includes(excerpt)).toBe(true);
        expect(excerpt.length).toBeLessThanOrEqual(1000);
      }
    }
  });

  it("never proposes certifications or achievements", () => {
    for (const text of Object.values(FIXTURES)) {
      const raw = extractImportByRules(text);
      expect(raw.certifications).toEqual([]);
      expect(raw.achievements).toEqual([]);
      expect(raw.schema_version).toBe("import.v1");
    }
  });

  it("returns an empty result for empty text", () => {
    expect(extractImportByRules("")).toEqual({
      schema_version: "import.v1", profile: null, experiences: [], education: [], certifications: [], skills: [], achievements: [],
    });
  });
});

describe("T26 rules extraction: English single-column CV", () => {
  const raw = extractImportByRules(RULES_CV_EN);

  it("reads the profile from the header block and the summary section", () => {
    expect(raw.profile).toMatchObject({
      display_name: "Rina Fiktif",
      headline: "Data Analyst",
      contact_email: "rina.fiktif@contoh.test",
      phone: "+62 812 3456 7890",
      website: "https://linkedin.com/in/rina-fiktif",
      summary: "Data analyst with 6 years of experience in reporting for retail teams.",
      location: null,
    });
    const profile = validated(RULES_CV_EN).items.find((item) => item.entity_type === "profile");
    expect(profile?.validation_errors).toEqual([]);
  });

  it("splits role and organization on at, a pipe and two lines without a separator", () => {
    expect(raw.experiences.map((item) => [item.ref, item.role_title, item.organization])).toEqual([
      ["exp-1", "Senior Data Analyst", "PT Contoh Rekaan"],
      ["exp-2", "Data Analyst", "CV Maju Fiktif"],
      ["exp-3", "Data Intern", "Toko Rekaan Jaya"],
    ]);
  });

  it("reads month names, MM/YYYY and present", () => {
    expect(raw.experiences[0]).toMatchObject({ start: date(2021, 1), end: null, is_current: true });
    expect(raw.experiences[1]).toMatchObject({ start: date(2018, 3), end: date(2020, 12), is_current: false });
    expect(raw.experiences[2]).toMatchObject({ start: date(2017), end: date(2017), is_current: false });
  });

  it("keeps bullets as the description and marks only internships", () => {
    expect(raw.experiences[0]!.description).toBe(
      "Built a weekly sales dashboard used by 40 store managers\nCut report preparation from 5 hours to 2 hours",
    );
    expect(raw.experiences[1]!.description).toBe("Maintained the inventory data mart");
    expect(raw.experiences[2]!.description).toBeNull();
    expect(raw.experiences.map((item) => item.kind)).toEqual([null, null, "internship"]);
  });

  it("keeps dates grounded in the validator", () => {
    const experiences = validated(RULES_CV_EN).items.filter((item) => item.entity_type === "experience");
    expect(experiences[0]!.payload).toMatchObject({ start_date: "2021-01-01", start_precision: "month", is_current: true, end_date: null });
    expect(experiences[1]!.payload).toMatchObject({ end_date: "2020-12-01", end_precision: "month" });
    expect(experiences[0]!.validation_errors).toEqual([{ field: "kind", code: "REQUIRED" }]);
  });

  it("reads qualification, field of study and institution", () => {
    expect(raw.education).toEqual([expect.objectContaining({
      qualification: "Bachelor of Science", field_of_study: "Statistics", institution: "Universitas Rekaan",
      start: date(2013), end: date(2017), is_current: false, description: null,
    })]);
  });

  it("splits labelled skills on commas, semicolons and pipes but not slashes", () => {
    expect(raw.skills.map((item) => item.name)).toEqual(["SQL", "Python", "R", "Power BI", "Excel", "CI/CD"]);
    expect(raw.skills[0]!.excerpt).toBe("Languages: SQL, Python, R");
  });

  it("ignores the content under a closing heading", () => {
    expect(JSON.stringify(raw)).not.toContain("Google Data Analytics");
  });
});

describe("T26 rules extraction: Indonesian single-column CV", () => {
  const raw = extractImportByRules(RULES_CV_ID);

  it("reads an Indonesian header", () => {
    expect(raw.profile).toMatchObject({
      display_name: "Budi Rekaan", headline: "Pengembang Perangkat Lunak", contact_email: "budi.rekaan@contoh.test",
      phone: "0812-3456-7890", website: null, summary: "Pengembang dengan pengalaman 5 tahun membangun aplikasi web.",
    });
  });

  it("reads s/d sekarang, sampai, a comma pair and a dash pair", () => {
    expect(raw.experiences.map((item) => ({
      role: item.role_title, organization: item.organization, kind: item.kind, start: item.start, end: item.end, current: item.is_current,
    }))).toEqual([
      { role: "Software Engineer", organization: "PT Fiktif Sejahtera", kind: null, start: date(2020, 2), end: null, current: true },
      { role: "Relawan Pengajar", organization: "Yayasan Rekaan Cerdas", kind: "volunteer", start: date(2018), end: date(2019), current: false },
      { role: "Magang Backend", organization: "PT Contoh Digital", kind: "internship", start: date(2017, 7), end: date(2017, 8), current: false },
    ]);
  });

  it("reads a degree with a comma field and a single graduation year", () => {
    expect(raw.education.map((item) => [item.qualification, item.field_of_study, item.institution, item.start, item.end])).toEqual([
      ["S1", "Teknik Informatika", "Institut Teknologi Rekaan", date(2013), date(2017)],
      [null, null, "SMA Negeri 99 Rekaan", null, date(2013)],
    ]);
  });

  it("splits bullets, drops a case-insensitive duplicate and ignores the languages section", () => {
    expect(raw.skills.map((item) => item.name)).toEqual(["Go", "PostgreSQL", "Docker", "Kubernetes"]);
  });
});

describe("T26 rules extraction: date and separator variants", () => {
  it("reads to, now, current, saat ini and s/d", () => {
    const raw = extractImportByRules(RULES_CV_DATE_VARIANTS);
    expect(raw.experiences.map((item) => [item.role_title, item.organization, item.start, item.end, item.is_current])).toEqual([
      ["Analyst A", "Org A", date(2015, 3), date(2016, 6), false],
      ["Analyst B", "Org B", date(2016), null, true],
      ["Analyst C", "Org C", date(2010, 9), null, true],
      ["Analis D", "Org D", date(2012, 5), null, true],
      ["Analis E", "Org E", date(2011, 8), date(2011, 12), false],
    ]);
  });

  it("does not split a role on a hyphen without spaces", () => {
    const raw = extractImportByRules("Experience\nFront-end Developer\nRekaan-Tech\n2019 - 2020");
    expect(raw.experiences[0]).toMatchObject({ role_title: "Front-end Developer", organization: "Rekaan-Tech" });
  });

  it("leaves role and organization empty when one line has no separator", () => {
    const raw = extractImportByRules("Experience\nFreelance work 2019 - 2020");
    expect(raw.experiences[0]).toMatchObject({ role_title: null, organization: null, start: date(2019), end: date(2020) });
  });

  it("reads a bare date line followed by role and organization", () => {
    const raw = extractImportByRules("Experience\n2019 - 2020\nAnalyst\nOrg Rekaan\n2021 - Present\nLead\nOrg Fiktif");
    expect(raw.experiences.map((item) => [item.role_title, item.organization])).toEqual([["Analyst", "Org Rekaan"], ["Lead", "Org Fiktif"]]);
  });
});

describe("T26 rules extraction: headings", () => {
  it("matches the frozen dictionary case-insensitively with a trailing colon", () => {
    expect(RULES_HEADINGS.experience).toContain("riwayat pekerjaan");
    expect(RULES_HEADINGS.closing).toContain("referensi");
    const raw = extractImportByRules("RIWAYAT PEKERJAAN:\nAnalyst | Org Rekaan\n2019 - 2020\nKETERAMPILAN\nSQL");
    expect(raw.experiences).toHaveLength(1);
    expect(raw.skills.map((item) => item.name)).toEqual(["SQL"]);
  });

  it("does not treat long or numbered lines as headings", () => {
    const raw = extractImportByRules(`Skills 2024\nSQL\n${"Skills ".repeat(10)}\nPython`);
    expect(raw.skills).toEqual([]);
  });

  it("finds nothing in a CV without headings and guesses nothing", () => {
    const raw = extractImportByRules(RULES_CV_NO_HEADINGS);
    expect(raw.experiences).toEqual([]);
    expect(raw.education).toEqual([]);
    expect(raw.skills).toEqual([]);
    expect(raw.profile).toBeNull();
  });

  it("skips an experience section without date anchors", () => {
    const raw = extractImportByRules(RULES_CV_UNDATED_EXPERIENCE);
    expect(raw.experiences).toEqual([]);
    expect(raw.skills.map((item) => item.name)).toEqual(["SQL"]);
  });

  it("reads nothing structured from two columns merged into one text", () => {
    const raw = extractImportByRules(RULES_CV_TWO_COLUMN);
    expect(raw.experiences).toEqual([]);
    expect(raw.education).toEqual([]);
    expect(raw.skills).toEqual([]);
  });
});

describe("T26 rules extraction: limits and hostile input", () => {
  it("caps skills at the per-type limit and drops tokens over 50 characters or 5 words", () => {
    const many = Array.from({ length: 80 }, (_, index) => `Skill${index}`).join(", ");
    const raw = extractImportByRules(`Skills\n${many}\n${"x".repeat(51)}, one two three four five six, Ok`);
    expect(raw.skills).toHaveLength(60);
    const short = extractImportByRules(`Skills\n${"x".repeat(51)}, one two three four five six, Ok`);
    expect(short.skills.map((item) => item.name)).toEqual(["Ok"]);
  });

  it("never treats a line over 500 characters as an anchor", () => {
    const raw = extractImportByRules(`Experience\nAnalyst at Org Rekaan 2019 - 2020 ${"x".repeat(500)}`);
    expect(raw.experiences).toEqual([]);
  });

  it("keeps an excerpt within 1000 characters by cutting bullets", () => {
    const bullets = Array.from({ length: 30 }, (_, index) => `• Delivered report number ${index} for the regional team`).join("\n");
    const text = `Experience\nAnalyst at Org Rekaan\n2019 - 2020\n${bullets}`;
    const raw = extractImportByRules(text);
    expect(raw.experiences[0]!.excerpt.length).toBeLessThanOrEqual(1000);
    expect(validated(text).summary.dropped_ungrounded).toBe(0);
    const description = validated(text).items[0]!.payload.description as string;
    expect(description.split("\n").length).toBeLessThan(30);
  });

  it("handles each hostile line in under 50 ms", () => {
    const timings: number[] = [];
    for (const line of RULES_HOSTILE_LINES) {
      for (const section of ["", "Experience\n", "Education\n", "Skills\n", "Summary\n"]) {
        const text = `Rina Fiktif\n${section}${line}\n${line}`;
        const started = performance.now();
        const raw = extractImportByRules(text);
        timings.push(performance.now() - started);
        expect(validateImportResult(raw, text).ok).toBe(true);
      }
    }
    console.info(`rules extraction hostile lines: max ${Math.max(...timings).toFixed(2)} ms over ${timings.length} runs`);
    expect(Math.max(...timings)).toBeLessThan(50);
  });

  it("handles a 60,000 character CV in under one second", () => {
    const block = RULES_CV_EN.split("\n").slice(5, 16).join("\n");
    let text = "Rina Fiktif\nWork Experience\n";
    while (text.length < 59_000) text += `${block}\n`;
    const started = performance.now();
    const raw = extractImportByRules(text);
    const elapsed = performance.now() - started;
    console.info(`rules extraction 60k text: ${elapsed.toFixed(1)} ms`);
    expect(elapsed).toBeLessThan(1000);
    expect(raw.experiences.length).toBe(60);
    expect(validateImportResult(raw, text).ok).toBe(true);
  });
});
