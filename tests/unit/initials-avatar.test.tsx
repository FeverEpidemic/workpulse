import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { InitialsAvatar, initialsFrom } from "@/components/ui/initials-avatar";

describe("T27 initials", () => {
  it.each([
    ["Rina Wulandari", "RW"],
    ["rina wulandari putri", "RW"],
    ["  Rina   Wulandari ", "RW"],
    ["Rina", "R"],
    ["élodie durand", "ÉD"],
  ])("takes at most two capital letters from %j", (name, initials) => {
    expect(initialsFrom(name, "someone@example.test")).toBe(initials);
  });

  it("falls back to one letter of the email when the name is empty", () => {
    expect(initialsFrom("", "rina@example.test")).toBe("R");
    expect(initialsFrom("   ", "rina@example.test")).toBe("R");
  });

  it("returns an empty string when there is nothing to use", () => {
    expect(initialsFrom("", "")).toBe("");
  });

  it("hides the circle from screen readers", () => {
    const html = renderToStaticMarkup(<InitialsAvatar name="Rina Wulandari" fallback="rina@example.test" />);
    expect(html).toBe('<span class="initials-avatar" aria-hidden="true">RW</span>');
  });
});
