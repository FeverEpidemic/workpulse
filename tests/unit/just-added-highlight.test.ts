import { describe, expect, it } from "vitest";
import { matchesJustAdded } from "@/components/ui/just-added-highlight";
describe("T30 one-time activity marker", () => {
  const marker = JSON.stringify({ id: "activity-1", at: 1000 });
  it("matches only the saved activity within ten seconds", () => {
    expect(matchesJustAdded(marker, "activity-1", 1000)).toBe(true);
    expect(matchesJustAdded(marker, "activity-1", 10_999)).toBe(true);
    expect(matchesJustAdded(marker, "activity-2", 1000)).toBe(false);
    expect(matchesJustAdded(marker, "activity-1", 11_000)).toBe(false);
  });
  it.each([null, "{", "null", "[]", "42", '{"id":"activity-1","at":"1000"}'])("ignores malformed input %s", input => {
    expect(matchesJustAdded(input, "activity-1", 1000)).toBe(false);
  });
  it("rejects future timestamps", () => expect(matchesJustAdded(marker, "activity-1", 999)).toBe(false));
});
