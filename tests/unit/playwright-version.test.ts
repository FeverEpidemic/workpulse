import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync("package.json", "utf8")) as { devDependencies: Record<string, string> };

describe("Playwright packages", () => {
  // Two versions make the `playwright` bin load a second test runner, and every spec fails before it starts.
  it("pins playwright to the exact @playwright/test version", () => {
    const runner = manifest.devDependencies["@playwright/test"];
    expect(runner).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.devDependencies["playwright"]).toBe(runner);
  });
});
