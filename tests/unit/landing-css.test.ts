import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tokens = readFileSync("src/styles/tokens.css", "utf8");
const css = readFileSync("src/app/globals.css", "utf8");
const landing = css.slice(css.indexOf("/* T32 landing */"));

const lightBlock = tokens.slice(0, tokens.indexOf('[data-theme="dark"]'));
const darkBlock = tokens.slice(tokens.indexOf('[data-theme="dark"]'));

describe("T32 landing CSS", () => {
  it.each(["--color-bg-warm", "--color-bg-warm-subtle"])("defines %s in light and dark", (token) => {
    expect(lightBlock).toMatch(new RegExp(`${token}: #[0-9a-f]{6};`));
    expect(darkBlock).toMatch(new RegExp(`${token}: #[0-9a-f]{6};`));
  });

  it("has a landing block that uses the warm surfaces", () => {
    expect(css).toContain("/* T32 landing */");
    expect(landing).toContain("var(--color-bg-warm)");
    expect(landing).toContain("var(--color-bg-warm-subtle)");
    expect(landing).toContain("var(--color-action-primary)");
  });

  it("adds no gradient, new color literal, or new accent", () => {
    expect(landing).not.toMatch(/gradient/i);
    expect(landing).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(landing).not.toMatch(/rgba?\(/i);
    expect(landing).not.toMatch(/orange/i);
  });

  it("keeps durations on the motion tokens", () => {
    for (const [, value] of landing.matchAll(/transition(?:-duration)?\s*:\s*([^;]+);/g)) {
      expect(value, value).not.toMatch(/\d(ms|s)\b/);
    }
  });
});
