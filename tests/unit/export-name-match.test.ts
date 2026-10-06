import { describe, expect, it } from "vitest";

import { exportTextShowsName } from "@/domain/cv/export";

// Text exactly as pdf.js extracts it from the real Chromium renderer (gate review T21 RV1 probe, workpulse-t21-pdf).
const EXTRACTED = {
  /** 李小龙: 小 comes out as the Kangxi radical U+2F29, 龙 as the CJK radical supplement U+2EF0 (no NFKC fold). */
  li: "李⼩⻰",
  /** 山田太郎: 山 and 田 come out as Kangxi radicals (they fold back under NFKC). */
  yamada: "⼭⽥太郎",
  /** محمد عبدالله: Arabic presentation forms in visual (reversed) order. */
  arabic: "ﻪﻠﻟاﺪﺒﻋ ﺪﻤﺤﻣ",
  /** דוד כהן: Hebrew words in visual order. */
  hebrew: "כהן דוד",
  /** प्रिया शर्मा: shaping loses characters; the name cannot be recovered from the text. */
  devanagari: "या शमा",
  /** ﬁona ﬂores typed with ligature characters comes out decomposed. */
  ligature: "fiona flores",
} as const;

const HEADINGS = ["Education", "Achievements"];
const page = (nameLine: string, headings: readonly string[] = HEADINGS) => [nameLine, ...headings.flatMap((heading) => [heading, "Universitas Contoh"])].join("\n");

describe("T21 RV1: the export text check accepts real renderer output for non-Latin names", () => {
  it.each([
    ["Kangxi radicals that fold back under NFKC", "山田太郎", EXTRACTED.yamada],
    ["Arabic presentation forms in visual order", "محمد عبدالله", EXTRACTED.arabic],
    ["Hebrew words in visual order", "דוד כהן", EXTRACTED.hebrew],
    ["ligature characters typed by the user", "ﬁona ﬂores", EXTRACTED.ligature],
  ])("finds the name: %s", (_label, name, nameLine) => {
    expect(exportTextShowsName(page(nameLine), name, HEADINGS)).toBe(true);
    // These are found from the name itself, without the heading fallback.
    expect(exportTextShowsName(nameLine, name, [])).toBe(true);
  });

  it.each([
    ["Han characters printed as radicals without a compatibility fold", "李小龙", EXTRACTED.li],
    ["Devanagari whose shaping loses characters", "प्रिया शर्मा", EXTRACTED.devanagari],
  ])("falls back to the localized section headings: %s", (_label, name, nameLine) => {
    expect(exportTextShowsName(page(nameLine), name, HEADINGS)).toBe(true);
    // Without every rendered heading the PDF does not prove searchable text.
    expect(exportTextShowsName(page(nameLine, ["Education"]), name, HEADINGS)).toBe(false);
    expect(exportTextShowsName(nameLine, name, HEADINGS)).toBe(false);
    expect(exportTextShowsName(page(nameLine), name, [])).toBe(false);
  });

  it("keeps the strict check for Latin, Greek and Cyrillic names", () => {
    expect(exportTextShowsName(page("Siti\nNurhaliza   Ç.  Ñuñez"), "Siti Nurhaliza Ç. Ñuñez", HEADINGS)).toBe(true);
    expect(exportTextShowsName(page("Siti Nurhaliza Ç. Ñuñez"), "Siti Nurhaliza Ç. Ñuñez", HEADINGS)).toBe(true);
    // Headings alone never stand in for a Latin, Greek or Cyrillic name, and neither does the reversed name.
    expect(exportTextShowsName(page("Someone Else"), "Siti Nurhaliza", HEADINGS)).toBe(false);
    expect(exportTextShowsName(page("azilahruN itiS"), "Siti Nurhaliza", HEADINGS)).toBe(false);
    expect(exportTextShowsName(page("Nurhaliza Siti"), "Siti Nurhaliza", HEADINGS)).toBe(false);
    expect(exportTextShowsName(page("Иван"), "Дмитрий Иванов", HEADINGS)).toBe(false);
    expect(exportTextShowsName(page("Ἀλέξανδρος"), "Ἀλέξανδρος Παπαδόπουλος", HEADINGS)).toBe(false);
  });

  it("rejects empty text and a blank name", () => {
    expect(exportTextShowsName("", "李小龙", HEADINGS)).toBe(false);
    expect(exportTextShowsName(page("x"), "   ", HEADINGS)).toBe(false);
  });
});
