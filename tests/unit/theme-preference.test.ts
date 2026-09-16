import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseThemePreference, resolveTheme } from "@/domain/theme/theme-preference";

type Theme = "light" | "dark";

const tokensCss = readFileSync(new URL("../../src/styles/tokens.css", import.meta.url), "utf8");

function themeTokens(theme: Theme): Record<string, string> {
  const pattern = theme === "light"
    ? /:root,\s*\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/
    : /\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/;
  const block = tokensCss.match(pattern)?.[1];
  if (!block) throw new Error(`Missing ${theme} token block`);
  return Object.fromEntries(
    Array.from(block.matchAll(/(--[\w-]+):\s*(#[\da-f]{3,8})\s*;/gi), ([, name, value]) => [name, value]),
  );
}

function luminance(hex: string): number {
  const value = hex.slice(1);
  const channels = value.length === 3
    ? value.split("").map((channel) => Number.parseInt(channel + channel, 16))
    : [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16));
  const [red, green, blue] = channels.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0);
}

function contrast(first: string, second: string): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

describe("theme preference", () => {
  it("accepts explicit themes and defaults unknown or missing values to system", () => {
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("system")).toBe("system");
    expect(parseThemePreference(undefined)).toBe("system");
  });

  it("resolves system preference from the operating system", () => {
    expect(resolveTheme("system", "dark")).toBe("dark");
    expect(resolveTheme("system", "light")).toBe("light");
    expect(resolveTheme("dark", "light")).toBe("dark");
  });

  it.each(["light", "dark"] as const)("uses %s tokens with readable contrast", (theme) => {
    const tokens = themeTokens(theme);
    const token = (name: string) => {
      const value = tokens[name];
      if (!value) throw new Error(`Missing ${theme} token ${name}`);
      return value;
    };

    const textPairs: Array<[string, string]> = [
      ["--color-text-primary", "--color-bg-canvas"],
      ["--color-text-secondary", "--color-bg-canvas"],
      ["--color-text-tertiary", "--color-bg-canvas"],
      ["--color-text-primary", "--color-bg-surface"],
      ["--color-action-primary-text", "--color-action-primary"],
      ["--color-success", "--color-success-surface"],
      ["--color-warning", "--color-warning-surface"],
      ["--color-danger", "--color-danger-surface"],
      ["--color-info", "--color-info-surface"],
      ["--color-focus-ring", "--color-bg-canvas"],
    ];

    for (const [foreground, background] of textPairs) {
      expect(
        contrast(token(foreground), token(background)),
        `${theme} ${foreground} on ${background}`,
      ).toBeGreaterThanOrEqual(4.5);
    }

    expect(
      contrast(token("--color-border-control"), token("--color-bg-surface")),
      `${theme} form border against its surface`,
    ).toBeGreaterThanOrEqual(3);

    const destructiveText = theme === "dark" ? "#1a1111" : "#ffffff";
    expect(contrast(destructiveText, token("--color-danger"))).toBeGreaterThanOrEqual(4.5);
  });
});
