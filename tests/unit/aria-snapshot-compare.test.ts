import { describe, expect, it } from "vitest";

import { compareAriaSnapshot } from "../e2e/helpers/aria-snapshot";

// T25 RV1: a locked aria snapshot checked out with CRLF (core.autocrlf=true) must still match the LF snapshot the
// browser produces, and a real difference must name its line.

const LOCKED = ["- main:", '  - heading "Dashboard" [level=1]', '  - button "Quick log"'].join("\n");

describe("compareAriaSnapshot", () => {
  it("treats a CRLF golden as equal to the same LF snapshot", () => {
    expect(compareAriaSnapshot(`${LOCKED.replaceAll("\n", "\r\n")}\r\n`, LOCKED)).toBeNull();
  });

  it("ignores trailing whitespace at the end of the file", () => {
    expect(compareAriaSnapshot(`${LOCKED}\n\n`, `${LOCKED}  \n`)).toBeNull();
  });

  it("names the first differing line, counting from 1, with both contents", () => {
    const actual = LOCKED.replace("Quick log", "Quick note");
    expect(compareAriaSnapshot(LOCKED.replaceAll("\n", "\r\n"), actual)).toEqual({
      line: 3,
      expected: '  - button "Quick log"',
      actual: '  - button "Quick note"',
    });
  });

  it("reports a snapshot longer or shorter than the golden without undefined", () => {
    const longer = `${LOCKED}\n  - link "CV"`;
    expect(compareAriaSnapshot(LOCKED, longer)).toEqual({ line: 4, expected: "<end of file>", actual: '  - link "CV"' });
    expect(compareAriaSnapshot(longer, LOCKED)).toEqual({ line: 4, expected: '  - link "CV"', actual: "<end of file>" });
  });
});
