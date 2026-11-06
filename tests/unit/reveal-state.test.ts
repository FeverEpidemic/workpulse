import { describe, expect, it } from "vitest";

import { revealOffscreen } from "@/features/marketing/reveal-state";

const VIEWPORT = 800;

function rect(top: number, height: number) {
  return { top, bottom: top + height };
}

describe("revealOffscreen", () => {
  it("leaves an item alone while it is in the viewport", () => {
    expect(revealOffscreen(rect(100, 200), VIEWPORT)).toBeNull();
  });

  it("marks an item past the top edge as above", () => {
    expect(revealOffscreen(rect(-300, 200), VIEWPORT)).toBe("above");
  });

  it("marks an item past the bottom edge as below", () => {
    expect(revealOffscreen(rect(900, 200), VIEWPORT)).toBe("below");
  });

  it("uses at least 24 px of visible item, so a short title still fades on screen", () => {
    expect(revealOffscreen(rect(-37, 60), VIEWPORT)).toBe("above");
    expect(revealOffscreen(rect(-36, 60), VIEWPORT)).toBeNull();
    expect(revealOffscreen(rect(777, 60), VIEWPORT)).toBe("below");
    expect(revealOffscreen(rect(776, 60), VIEWPORT)).toBeNull();
  });

  it("uses 5% of the height for a tall item", () => {
    expect(revealOffscreen(rect(-951, 1000), VIEWPORT)).toBe("above");
    expect(revealOffscreen(rect(-950, 1000), VIEWPORT)).toBeNull();
    expect(revealOffscreen(rect(751, 1000), VIEWPORT)).toBe("below");
    expect(revealOffscreen(rect(750, 1000), VIEWPORT)).toBeNull();
  });

  it("never hides an item that fills the viewport", () => {
    expect(revealOffscreen(rect(-500, 2000), VIEWPORT)).toBeNull();
  });
});
