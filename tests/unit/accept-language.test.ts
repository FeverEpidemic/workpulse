import { describe, expect, it } from "vitest";

import { localeFromAcceptLanguage } from "@/i18n/accept-language";
import { resolveLocale } from "@/i18n/messages";

describe("T32 Accept-Language parser", () => {
  it.each([
    ["id-ID,id;q=0.9", "id"],
    ["id", "id"],
    ["in-ID", "id"],
    ["ID-id", "id"],
    ["en-US,en;q=0.9", "en"],
    ["ms-MY,ms;q=0.9", "en"],
    ["", "en"],
    [null, "en"],
    [undefined, "en"],
  ] as const)("reads %j as %s", (header, locale) => {
    expect(localeFromAcceptLanguage(header)).toBe(locale);
  });

  it("follows the highest q-value, not the order", () => {
    expect(localeFromAcceptLanguage("en;q=0.5,id;q=0.8")).toBe("id");
    expect(localeFromAcceptLanguage("id;q=0.4,en-GB;q=0.9")).toBe("en");
  });

  it("keeps the first tag when q-values tie", () => {
    expect(localeFromAcceptLanguage("id,en")).toBe("id");
    expect(localeFromAcceptLanguage("en,id")).toBe("en");
  });

  it("ignores tags the browser marks unacceptable", () => {
    expect(localeFromAcceptLanguage("id;q=0,en;q=0.1")).toBe("en");
  });

  it("treats a wildcard as not Indonesian", () => {
    expect(localeFromAcceptLanguage("*")).toBe("en");
    expect(localeFromAcceptLanguage("*,id;q=0.5")).toBe("en");
  });

  it.each([",,,", ";q=1", "id;q=abc", "id;q=2", "\u0000\u0001", "id-;;;q", "x".repeat(5000)])("does not throw on malformed %j", (header) => {
    expect(() => localeFromAcceptLanguage(header)).not.toThrow();
    expect(["en", "id"]).toContain(localeFromAcceptLanguage(header));
  });

  it("skips a tag with an invalid q-value and uses the rest", () => {
    expect(localeFromAcceptLanguage("en;q=abc,id;q=0.5")).toBe("id");
  });
});

describe("T32 locale priority", () => {
  it("uses the profile over cookie and header", () => {
    expect(resolveLocale("en", "id", "id-ID")).toBe("en");
    expect(resolveLocale("id", "en", "en-US")).toBe("id");
  });

  it("uses a valid cookie over the header", () => {
    expect(resolveLocale(null, "en", "id-ID")).toBe("en");
    expect(resolveLocale(null, "id", "en-US")).toBe("id");
  });

  it("falls back to the header when the cookie is missing or invalid", () => {
    expect(resolveLocale(null, undefined, "id-ID,id;q=0.9")).toBe("id");
    expect(resolveLocale(null, "fr", "id-ID")).toBe("id");
    expect(resolveLocale(null, undefined, "en-US")).toBe("en");
  });

  it("keeps the two-argument behaviour", () => {
    expect(resolveLocale(null, undefined)).toBe("en");
    expect(resolveLocale(null, "id")).toBe("id");
  });
});
