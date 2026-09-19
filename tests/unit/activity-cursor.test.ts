import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import { ActivityCursorError, decodeActivityCursor, encodeActivityCursor } from "@/domain/activity/activity-cursor";

describe("Activity keyset cursor", () => {
  const cursor = {
    occurredOn: "2026-02-28",
    id: "22222222-2222-4222-8222-222222222222",
  };

  it("round trips the exact date and UUID in a versioned opaque token", () => {
    const token = encodeActivityCursor(cursor);
    expect(token).not.toContain(cursor.id);
    expect(decodeActivityCursor(token)).toEqual(cursor);
  });

  it("rejects malformed, oversized, tampered, and unsupported payloads", () => {
    expect(() => decodeActivityCursor("%%%")).toThrow(ActivityCursorError);
    expect(() => decodeActivityCursor("x".repeat(257))).toThrow(ActivityCursorError);

    const unsupported = Buffer.from(JSON.stringify({
      version: 2,
      ...cursor,
    }), "utf8").toString("base64url");
    expect(() => decodeActivityCursor(unsupported)).toThrow(ActivityCursorError);

    const unknownField = Buffer.from(JSON.stringify({
      version: 1,
      ...cursor,
      ownerId: "33333333-3333-4333-8333-333333333333",
    }), "utf8").toString("base64url");
    expect(() => decodeActivityCursor(unknownField)).toThrow(ActivityCursorError);

    const invalidDate = Buffer.from(JSON.stringify({
      version: 1,
      ...cursor,
      occurredOn: "2026-02-30",
    }), "utf8").toString("base64url");
    expect(() => decodeActivityCursor(invalidDate)).toThrow(ActivityCursorError);
  });

  it("refuses to encode invalid cursor fields", () => {
    expect(() => encodeActivityCursor({ ...cursor, occurredOn: "2026-02-30" })).toThrow(ActivityCursorError);
    expect(() => encodeActivityCursor({ ...cursor, id: "not-a-uuid" })).toThrow(ActivityCursorError);
  });
});

