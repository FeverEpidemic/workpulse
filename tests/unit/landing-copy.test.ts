import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { t, type MessageKey } from "@/i18n/messages";
import { landingSample } from "@/features/marketing/sample-data";

const source = readFileSync("src/i18n/messages.ts", "utf8");
const landingKeys = [...new Set([...source.matchAll(/^ {2}"(landing\.[^"]+)":/gm)].map((match) => match[1] as MessageKey))];

function sampleStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(sampleStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(sampleStrings);
  return [];
}

const forbidden: [string, RegExp][] = [
  ["ATS", /\bATS\b/],
  ["testimonial", /testimon/i],
  ["percent", /\d\s*%|persen|percent/i],
  ["times more", /\b\d+\s*x\b|x lebih|times (faster|more|better)/i],
  ["user count", /\d[\d.,]*\+?\s*(pengguna|users|orang|people)/i],
  ["AI provider", /openai|anthropic|claude|\bgpt|gemini|mistral|llama/i],
  ["server region", /singapore|singapura|tokyo|frankfurt|us-east|ap-southeast|\baws\b|\bgcp\b|azure|supabase|vercel/i],
  ["pricing words", /freemium|berbayar|premium|waitlist|kuota|quota/i],
];

describe("T32 landing copy", () => {
  it("has the landing keys in both locales", () => {
    expect(landingKeys.length).toBeGreaterThan(40);
    for (const key of landingKeys) {
      expect(t("en", key), key).not.toBe("");
      expect(t("id", key), key).not.toBe("");
    }
  });

  it.each(["en", "id"] as const)("avoids claims the brief rules out in %s", (locale) => {
    const texts = [...landingKeys.map((key) => t(locale, key)), ...sampleStrings(landingSample(locale))];
    for (const text of texts) {
      for (const [name, pattern] of forbidden) expect(pattern.test(text), `${name}: ${text}`).toBe(false);
    }
  });

  it("has no video section yet", () => {
    expect(landingKeys.some((key) => key.startsWith("landing.video"))).toBe(false);
  });

  it("keeps the typed hero note within 90 characters", () => {
    for (const locale of ["en", "id"] as const) expect(Array.from(landingSample(locale).hero.note).length).toBeLessThanOrEqual(90);
  });

  it("uses sample data that is labelled as fictional and has no email", () => {
    for (const locale of ["en", "id"] as const) {
      const text = sampleStrings(landingSample(locale)).join("\n");
      expect(text).not.toMatch(/@/);
      expect(text).toContain("PT Contoh");
    }
  });
});
