import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// T25 plan section 1.7: WCAG contrast of the colour tokens that components really pair, measured for both themes.
// The tokens are read from src/styles/tokens.css; a colour the parser cannot read fails the test by token name.

const css = readFileSync(new URL("../../src/styles/tokens.css", import.meta.url), "utf8");

function block(selector: RegExp): Record<string, string> {
  const match = css.match(selector);
  if (!match?.[1]) throw new Error(`token block not found: ${selector}`);
  const tokens: Record<string, string> = {};
  for (const declaration of match[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    tokens[declaration[1]!] = declaration[2]!.trim();
  }
  return tokens;
}

const light = block(/:root,\s*\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/);
const dark = block(/\n\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/);

/** The dark block only overrides; every other token falls through from the light block, as in the cascade. */
const themes: Record<"light" | "dark", Record<string, string>> = { light, dark: { ...light, ...dark } };

function channels(token: string, value: string): [number, number, number] {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (!hex) throw new Error(`token ${token} has a colour the contrast test cannot read: ${value}`);
  const n = parseInt(hex[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(token: string, value: string): number {
  const [r, g, b] = channels(token, value).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(fgToken: string, fgValue: string, bgToken: string, bgValue: string): number {
  const a = luminance(fgToken, fgValue);
  const b = luminance(bgToken, bgValue);
  const [hi, lo] = a >= b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

interface Pair { fg: string; bg: string; min: 3 | 4.5; use: string }

// Each pair is a foreground that a component paints on a background it really sits on (src/app/globals.css and the
// components that use these tokens). 4.5 for text of normal size, 3 for the edge of a control, a focus ring or an icon.
const PAIRS: Pair[] = [
  { fg: "--color-text-primary", bg: "--color-bg-canvas", min: 4.5, use: "body text on the page" },
  { fg: "--color-text-primary", bg: "--color-bg-surface", min: 4.5, use: "text in cards, inputs and rows" },
  { fg: "--color-text-primary", bg: "--color-bg-subtle", min: 4.5, use: "hovered rows, current navigation item" },
  { fg: "--color-text-primary", bg: "--color-bg-elevated", min: 4.5, use: "dialogs" },
  { fg: "--color-text-secondary", bg: "--color-bg-canvas", min: 4.5, use: "private label, help text on the page" },
  { fg: "--color-text-secondary", bg: "--color-bg-surface", min: 4.5, use: "meta lines and help text in cards" },
  { fg: "--color-text-secondary", bg: "--color-bg-subtle", min: 4.5, use: "meta lines in hovered rows" },
  { fg: "--color-text-secondary", bg: "--color-bg-elevated", min: 4.5, use: "help text in dialogs" },
  { fg: "--color-text-tertiary", bg: "--color-bg-surface", min: 4.5, use: "input placeholder" },
  { fg: "--color-text-tertiary", bg: "--color-bg-canvas", min: 4.5, use: "tertiary text on the page" },
  { fg: "--color-text-tertiary", bg: "--color-bg-subtle", min: 4.5, use: "tertiary text in hovered rows" },
  { fg: "--color-action-primary-text", bg: "--color-action-primary", min: 4.5, use: "primary button label" },
  { fg: "--color-action-primary-text", bg: "--color-action-primary-hover", min: 4.5, use: "primary button label on hover" },
  { fg: "--color-text-primary", bg: "--color-action-secondary", min: 4.5, use: "secondary button label" },
  { fg: "--color-text-primary", bg: "--color-action-secondary-hover", min: 4.5, use: "secondary button label on hover" },
  { fg: "--color-danger", bg: "--color-bg-canvas", min: 4.5, use: "field error on the page" },
  { fg: "--color-danger", bg: "--color-bg-surface", min: 4.5, use: "field error in cards" },
  { fg: "--color-danger", bg: "--color-bg-elevated", min: 4.5, use: "field error in dialogs" },
  { fg: "--color-danger", bg: "--color-danger-surface", min: 4.5, use: "inline error and destructive notice" },
  { fg: "--color-success", bg: "--color-success-surface", min: 4.5, use: "success notice" },
  { fg: "--color-warning", bg: "--color-warning-surface", min: 4.5, use: "warning notice" },
  { fg: "--color-info", bg: "--color-info-surface", min: 4.5, use: "information notice" },
  { fg: "--color-success", bg: "--color-bg-surface", min: 4.5, use: "confirmed status text" },
  { fg: "--color-warning", bg: "--color-bg-surface", min: 4.5, use: "needs-attention status text" },
  { fg: "--color-info", bg: "--color-bg-surface", min: 4.5, use: "information status text" },
  { fg: "--color-border-control", bg: "--color-bg-surface", min: 3, use: "input and secondary button edge on cards" },
  { fg: "--color-border-control", bg: "--color-bg-canvas", min: 3, use: "input and secondary button edge on the page" },
  { fg: "--color-border-control", bg: "--color-bg-elevated", min: 3, use: "input edge in dialogs" },
  { fg: "--color-focus-ring", bg: "--color-bg-canvas", min: 3, use: "focus indicator on the page" },
  { fg: "--color-focus-ring", bg: "--color-bg-surface", min: 3, use: "focus indicator in cards" },
  { fg: "--color-focus-ring", bg: "--color-bg-subtle", min: 3, use: "focus indicator on hovered rows" },
  { fg: "--color-focus-ring", bg: "--color-bg-elevated", min: 3, use: "focus indicator in dialogs" },
  { fg: "--color-action-primary", bg: "--color-bg-surface", min: 3, use: "checked choice edge and current navigation icon" },
  { fg: "--color-action-primary", bg: "--color-bg-canvas", min: 3, use: "primary button edge on the page" },
  { fg: "--color-action-primary", bg: "--color-bg-subtle", min: 3, use: "current navigation icon on its row" },
  { fg: "--color-success", bg: "--color-bg-canvas", min: 3, use: "private-workspace status dot" },
  { fg: "--color-text-primary", bg: "--color-selection-bg", min: 4.5, use: "selected text (::selection)" },
];

const OVERRIDES = new Set<string>();

describe("theme tokens", () => {
  it("reads both blocks and resolves every token a pair uses", () => {
    for (const theme of ["light", "dark"] as const) {
      for (const pair of PAIRS) {
        expect(themes[theme][pair.fg], `${theme}: ${pair.fg}`).toBeDefined();
        expect(themes[theme][pair.bg], `${theme}: ${pair.bg}`).toBeDefined();
      }
    }
    expect(Object.keys(dark).length).toBeGreaterThan(10);
  });

  it("fails by token name on a colour it cannot parse", () => {
    expect(() => channels("--color-bg-overlay", "rgb(17 22 19 / 0.48)")).toThrowError(/--color-bg-overlay/);
    expect(() => channels("--x", "#12345")).toThrowError(/--x/);
  });

  it("computes the WCAG ratio (black on white is 21, #777777 on white is 4.48)", () => {
    expect(contrastRatio("a", "#000000", "b", "#ffffff")).toBeCloseTo(21, 5);
    expect(Number(contrastRatio("a", "#777777", "b", "#ffffff").toFixed(2))).toBe(4.48);
    expect(Number(contrastRatio("a", "#ffffff", "b", "#999999").toFixed(2))).toBe(2.85);
  });

  for (const theme of ["light", "dark"] as const) {
    it(`meets WCAG AA for every pair in the ${theme} theme`, () => {
      const failures: string[] = [];
      for (const pair of PAIRS) {
        const ratio = contrastRatio(pair.fg, themes[theme][pair.fg]!, pair.bg, themes[theme][pair.bg]!);
        const key = `${theme} ${pair.fg} on ${pair.bg}`;
        if (ratio + 1e-9 < pair.min && !OVERRIDES.has(key)) {
          failures.push(`${key}: ${ratio.toFixed(2)} < ${pair.min} (${pair.use})`);
        }
      }
      expect(failures).toEqual([]);
    });
  }
});
