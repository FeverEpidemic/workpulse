import { describe, expect, it } from "vitest";

import { insertedTextOf } from "@/features/activity/before-input";

describe("Gate M4: the text a before-input event is about to insert", () => {
  it("reads the character from the React event when the native event is a textInput or keypress event without inputType", () => {
    expect(() => insertedTextOf({ data: "a" }, {})).not.toThrow();
    expect(insertedTextOf({ data: "a" }, {})).toBe("a");
    expect(insertedTextOf({}, { data: "b" })).toBe("b");
  });

  it("ignores deletions", () => {
    expect(insertedTextOf({}, { inputType: "deleteContentBackward" })).toBeNull();
    expect(insertedTextOf({ data: "x" }, { inputType: "deleteByCut" })).toBeNull();
  });

  it("counts a line break or paragraph as one newline", () => {
    expect(insertedTextOf({}, { inputType: "insertLineBreak" })).toBe("\n");
    expect(insertedTextOf({}, { inputType: "insertParagraph" })).toBe("\n");
  });

  it("returns null when nothing is being inserted", () => {
    expect(insertedTextOf({}, {})).toBeNull();
    expect(insertedTextOf({ data: null }, { data: null, inputType: "insertText" })).toBeNull();
  });
});
