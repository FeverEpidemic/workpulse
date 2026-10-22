import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tokens = readFileSync("src/styles/tokens.css", "utf8");
const css = readFileSync("src/app/globals.css", "utf8");

describe("T30 motion contract", () => {
  it.each([
    ["instant", "100ms"], ["fast", "120ms"], ["normal", "180ms"], ["slow", "240ms"],
  ])("defines the %s duration", (name, value) => {
    expect(tokens).toContain(`--motion-${name}: ${value};`);
  });

  it.each([
    ["out", "0.2, 0, 0, 1"], ["in", "0.4, 0, 1, 1"], ["standard", "0.4, 0, 0.2, 1"],
  ])("defines the %s easing", (name, value) => {
    expect(tokens).toContain(`--ease-${name}: cubic-bezier(${value});`);
  });

  it("limits interaction motion to 240 ms, with named loading and insertion exceptions", () => {
    const declarations = [...css.matchAll(/(?:transition(?:-duration)?|animation(?:-duration)?)\s*:\s*([^;]+);/g)];
    expect(declarations.length).toBeGreaterThan(0);
    for (const [, value] of declarations) {
      const allowedLoop = /\bui-(?:skeleton-pulse|just-added|spin)\b/.test(value!);
      for (const [, number, unit] of value!.matchAll(/(?<![\w-])([\d.]+)(ms|s)\b/g)) {
        const ms = Number(number) * (unit === "s" ? 1000 : 1);
        if (!allowedLoop) expect(ms, value).toBeLessThanOrEqual(240);
      }
    }
  });
});
