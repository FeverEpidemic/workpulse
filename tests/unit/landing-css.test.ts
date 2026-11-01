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

  it("hides reveal items only after JavaScript marks the page ready", () => {
    const hiding = [...landing.matchAll(/([^{}]+)\{[^}]*opacity:\s*0;[^}]*\}/g)].map((match) => match[1]!.trim());
    const revealHiding = hiding.filter((selector) => selector.includes("data-reveal-item"));
    expect(revealHiding.length).toBeGreaterThan(0);
    for (const selector of revealHiding) expect(selector).toContain(".is-reveal-ready");
    expect(landing).toMatch(/\[data-reveal-item\][^{]*\{[^}]*transition-delay:\s*var\(--reveal-delay\)/);
    expect(landing).toMatch(/\[data-reveal-item\][^{]*\{[^}]*transition:[^;]*var\(--motion-slow\)[^;]*var\(--ease-out\)/);
  });

  it("hides the hero story parts before hydration only while the inline script has armed it", () => {
    for (const [selector] of landing.matchAll(/[^{}]+\{[^}]*visibility:\s*hidden;[^}]*\}/g)) {
      if (selector.includes("landing-hero")) expect(selector).toContain('[data-hero-story="armed"]');
    }
  });

  it("lifts cards on hover only for a fine pointer without reduced motion", () => {
    const hoverBlock = landing.slice(landing.indexOf("@media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)"));
    expect(hoverBlock.length).toBeGreaterThan(0);
    expect(hoverBlock).toMatch(/\.landing-example:hover \.landing-card\s*\{[^}]*translateY\(-2px\)[^}]*var\(--shadow-lg\)/);
    const outside = landing.replace(/@media \(hover: hover\)[^{]*\{(?:[^{}]*\{[^}]*\})*\s*\}/g, "");
    expect(outside).not.toMatch(/\.landing-example:hover/);
  });

  it("has no looping animation and leaves the logo still", () => {
    expect(landing).not.toMatch(/infinite/);
    expect(landing).not.toMatch(/brand-symbol[^{]*\{[^}]*(animation|transition)/);
    expect(landing).not.toMatch(/landing-closing-mark[^{]*\{[^}]*(animation|transition)/);
  });

  it("slides tab panels in from the side of the move", () => {
    expect(landing).toMatch(/@keyframes landing-panel-from-right\s*\{\s*from\s*\{[^}]*translateX\(24px\)/);
    expect(landing).toMatch(/@keyframes landing-panel-from-left\s*\{\s*from\s*\{[^}]*translateX\(-24px\)/);
    for (const [, value] of landing.matchAll(/animation\s*:\s*([^;]+);/g)) {
      if (value !== "none !important") expect(value).toContain("var(--motion-slow)");
    }
  });

  it("turns landing motion off under reduced motion", () => {
    expect(landing).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.landing \*,[^{]*\{\s*transition: none !important;\s*animation: none !important;/);
  });

  it("keeps durations on the motion tokens", () => {
    for (const [, value] of landing.matchAll(/transition(?:-duration)?\s*:\s*([^;]+);/g)) {
      expect(value, value).not.toMatch(/\d(ms|s)\b/);
    }
  });
});
