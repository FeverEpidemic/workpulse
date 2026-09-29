import { describe, expect, it } from "vitest";

import { validateImportResult } from "@/domain/import/extract-result";
import { ExplicitTestFakeAIProvider } from "@/server/ai/fake-provider";

import { CV_LINES } from "../import-fixtures";

const TEXT = [
  ...CV_LINES,
  "Riwayat: Jan 2019 - Mar 2022 di PT Sentinel Nusantara sebagai Analis Data.",
  "Portfolio https://example.org/cv dan email nama@example.org, 12 Mei 2021 menang lomba.",
].join("\n");

const empty = { schema_version: "import.v1", profile: null, experiences: [], education: [], certifications: [], skills: [], achievements: [] };
const date = (year: number, month: number | null = null, day: number | null = null) => ({ year, month, day });

function experience(overrides: Record<string, unknown> = {}) {
  return {
    ref: "exp-1", organization: "PT Sentinel Nusantara", role_title: "Analis Data", kind: "employment", description: null,
    start: date(2019), end: date(2022), is_current: false, excerpt: "EXP|PT Sentinel Nusantara|Analis Data|2019|2022", ...overrides,
  };
}

function achievement(overrides: Record<string, unknown> = {}) {
  return {
    title: "Menurunkan waktu laporan dari 5 ke 2 jam", contribution: null, outcome: null, achieved_on: null,
    experience_ref: "exp-1", cv_bullet: null, metrics: [],
    excerpt: "ACH|Menurunkan waktu laporan dari 5 ke 2 jam|PT Sentinel Nusantara", ...overrides,
  };
}

function run(raw: unknown) {
  const result = validateImportResult(raw, TEXT);
  if (!result.ok) throw new Error("expected ok");
  return result;
}

describe("T15 import.v1 validation and grounding", () => {
  it("rejects output that fails the schema", () => {
    expect(validateImportResult({ schema_version: "import.v1", unexpected: true }, TEXT)).toEqual({ ok: false });
    expect(validateImportResult({ ...empty, schema_version: "detect.v1" }, TEXT)).toEqual({ ok: false });
    expect(validateImportResult({ ...empty, experiences: [{ ...experience(), extra: 1 }] }, TEXT)).toEqual({ ok: false });
  });

  it("stages grounded candidates with canonical field names and partial dates", () => {
    const result = run({ ...empty, experiences: [experience()], skills: [{ name: "Statistika", excerpt: "SKILL|Statistika" }] });
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      entity_type: "experience", ref: "exp-1", validation_errors: [],
      payload: {
        organization: "PT Sentinel Nusantara", role_title: "Analis Data", kind: "employment",
        start_date: "2019-01-01", start_precision: "year", end_date: "2022-01-01", end_precision: "year", is_current: false,
      },
    });
    expect(result.summary).toEqual({
      schema_version: "import.v1", dropped_ungrounded: 0,
      counts: { profile: 0, experience: 1, education: 0, certification: 0, skill: 1, achievement: 0 },
    });
  });

  it("drops a candidate whose excerpt is not in the text", () => {
    const result = run({ ...empty, experiences: [experience({ excerpt: "EXP|Invented Corp|CEO|2010|2012", organization: "Invented Corp" })] });
    expect(result.items).toHaveLength(0);
    expect(result.summary.dropped_ungrounded).toBe(1);
  });

  it("clears and flags an employer that is not in its own excerpt", () => {
    const result = run({ ...empty, experiences: [experience({ organization: "Fabricated Holdings" })] });
    expect(result.items[0]!.payload.organization).toBeNull();
    expect(result.items[0]!.validation_errors).toContainEqual({ field: "organization", code: "UNGROUNDED" });
  });

  it("keeps partial candidates and flags missing required fields", () => {
    const result = run({ ...empty, experiences: [experience({ role_title: null, kind: null })] });
    expect(result.items[0]!.validation_errors).toEqual(expect.arrayContaining([
      { field: "role_title", code: "REQUIRED" },
      { field: "kind", code: "REQUIRED" },
    ]));
  });

  it("removes invented numbers from achievement wording and metrics", () => {
    const result = run({
      ...empty,
      experiences: [experience()],
      achievements: [achievement({
        title: "Menurunkan waktu laporan untuk 4173 orang",
        cv_bullet: "Menurunkan waktu laporan dari 5 ke 2 jam",
        metrics: [
          { label: "Jam laporan", value: 2, unit: "jam", baseline: 5 },
          { label: "Pengguna", value: 4173, unit: "orang", baseline: null },
        ],
      })],
    });
    const item = result.items.find((row) => row.entity_type === "achievement")!;
    expect(item.payload.title).toBeNull();
    expect(item.payload.cv_bullet).toBe("Menurunkan waktu laporan dari 5 ke 2 jam");
    expect(item.payload.metrics).toEqual([{ label: "Jam laporan", value: 2, unit: "jam", baseline: 5 }]);
    expect(item.validation_errors).toEqual(expect.arrayContaining([
      { field: "title", code: "UNGROUNDED" },
      { field: "metrics", code: "UNGROUNDED" },
    ]));
  });

  it("keeps every achievement a draft, links it to its experience and requires an exact date", () => {
    const result = run({ ...empty, experiences: [experience()], achievements: [achievement()] });
    const item = result.items.find((row) => row.entity_type === "achievement")!;
    expect(item.payload).toMatchObject({ status: "draft", experience_ref: "exp-1", achieved_on: null });
    expect(item.validation_errors).toEqual(expect.arrayContaining([
      { field: "contribution", code: "REQUIRED" },
      { field: "outcome", code: "REQUIRED" },
      { field: "cv_bullet", code: "REQUIRED" },
      { field: "achieved_on", code: "REQUIRED" },
    ]));
    const unknownRef = run({ ...empty, achievements: [achievement({ experience_ref: "exp-9" })] });
    expect(unknownRef.items[0]!.payload).not.toHaveProperty("experience_ref");
  });

  it("never makes a date more precise than its excerpt", () => {
    const excerpt = "Riwayat: Jan 2019 - Mar 2022 di PT Sentinel Nusantara sebagai Analis Data.";
    const grounded = run({ ...empty, experiences: [experience({ excerpt, start: date(2019, 1), end: date(2022, 3, 15) })] });
    expect(grounded.items[0]!.payload).toMatchObject({
      start_date: "2019-01-01", start_precision: "month", end_date: "2022-03-01", end_precision: "month",
    });
    const invented = run({ ...empty, experiences: [experience({ start: date(2019, 6, 3), end: date(2031) })] });
    expect(invented.items[0]!.payload).toMatchObject({ start_date: "2019-01-01", start_precision: "year", end_date: null, end_precision: null });
    const day = run({ ...empty, achievements: [achievement({ excerpt: "Portfolio https://example.org/cv dan email nama@example.org, 12 Mei 2021 menang lomba.", title: "Menang lomba", achieved_on: date(2021, 5, 12), experience_ref: null })] });
    expect(day.items[0]!.payload.achieved_on).toBe("2021-05-12");
  });

  it("accepts overlapping roles and flags only impossible ranges", () => {
    const result = run({
      ...empty,
      experiences: [
        experience(),
        experience({ ref: "exp-2", organization: "WP Labs", role_title: "Data Lead", start: date(2021), end: null, is_current: true, excerpt: "EXP|WP Labs|Data Lead|2021|" }),
      ],
    });
    expect(result.items.every((item) => item.validation_errors.length === 0)).toBe(true);
    const reversed = run({ ...empty, experiences: [experience({ start: date(2022), end: date(2019) })] });
    expect(reversed.items[0]!.validation_errors).toContainEqual({ field: "end_date", code: "DATE_RANGE" });
  });

  it("keeps only http(s) URLs present in the excerpt and removes placeholder names", () => {
    const excerpt = "Portfolio https://example.org/cv dan email nama@example.org, 12 Mei 2021 menang lomba.";
    const result = run({
      ...empty,
      profile: { display_name: "Pending onboarding", headline: null, summary: null, contact_email: "nama@example.org", phone: null, location: null, website: "https://example.org/cv", excerpt },
      certifications: [{ name: "Google Data Analytics", issuer: "Google", issued: date(2020), credential_url: "javascript:alert(1)", excerpt: "CERT|Google Data Analytics|Google|2020" }],
    });
    expect(result.items[0]!.payload).toMatchObject({ display_name: null, contact_email: "nama@example.org", website: "https://example.org/cv" });
    expect(result.items[1]!.payload).toMatchObject({ credential_url: null, issued_date: "2020-01-01", issued_precision: "year" });
    expect(result.items[1]!.validation_errors).toContainEqual({ field: "credential_url", code: "INVALID" });
  });

  it("deduplicates skills and caps each type at 60 items", () => {
    const skills = Array.from({ length: 70 }, () => ({ name: "Statistika", excerpt: "SKILL|Statistika" }));
    expect(run({ ...empty, skills }).items).toHaveLength(1);
    const experiences = Array.from({ length: 70 }, (_, index) => experience({ ref: `exp-${index}` }));
    expect(run({ ...empty, experiences }).items).toHaveLength(60);
  });
});

describe("T15 fake import provider", () => {
  it("extracts fixture lines with verbatim excerpts that pass validation", async () => {
    const provider = new ExplicitTestFakeAIProvider("valid");
    const output = await provider.extractImport({ text: TEXT }, AbortSignal.timeout(1_000));
    expect(output.status).toBe("ok");
    if (output.status !== "ok") return;
    const result = run(output.output);
    expect(result.summary.counts).toMatchObject({ experience: 2, education: 1, certification: 1, skill: 2, achievement: 1 });
    expect(result.summary.dropped_ungrounded).toBe(0);
    expect(provider.importCalls).toEqual([{ text: TEXT }]);
  });

  it("covers empty, partial, ungrounded, numbers and malformed scenarios", async () => {
    const extract = async (scenario: ConstructorParameters<typeof ExplicitTestFakeAIProvider>[0]) => {
      const output = await new ExplicitTestFakeAIProvider(scenario).extractImport({ text: TEXT }, AbortSignal.timeout(1_000));
      if (output.status !== "ok") return { ok: false as const, code: output.code };
      return validateImportResult(output.output, TEXT);
    };
    expect(await extract("import_empty")).toMatchObject({ ok: true, items: [] });
    const partial = await extract("import_partial");
    expect(partial.ok && partial.items.filter((item) => item.entity_type === "experience").every((item) =>
      item.validation_errors.some((error) => error.field === "role_title"))).toBe(true);
    const ungrounded = await extract("import_ungrounded");
    expect(ungrounded.ok && ungrounded.summary.dropped_ungrounded).toBe(1);
    const numbers = await extract("import_numbers");
    expect(numbers.ok && numbers.items.find((item) => item.entity_type === "achievement")!.payload.title).toBeNull();
    expect(await extract("malformed")).toEqual({ ok: false });
    expect(await extract("unavailable")).toEqual({ ok: false, code: "AI_PROVIDER_UNAVAILABLE" });
  });
});
