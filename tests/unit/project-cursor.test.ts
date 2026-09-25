import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import { ProjectCursorError, decodeProjectCursor, encodeProjectCursor } from "@/domain/project/project-cursor";

describe("Project keyset cursor", () => {
  const cursor = {
    updatedAt: "2026-09-20T12:00:00.000Z",
    id: "22222222-2222-4222-8222-222222222222",
  };

  it("round trips the versioned timestamp and UUID without exposing them plainly", () => {
    const token = encodeProjectCursor(cursor);
    expect(token).not.toContain(cursor.id);
    expect(decodeProjectCursor(token)).toEqual(cursor);
  });

  it("rejects malformed, tampered, unknown-field, and unsupported cursors", () => {
    expect(() => decodeProjectCursor("%%%"),).toThrow(ProjectCursorError);
    expect(() => decodeProjectCursor("x".repeat(257))).toThrow(ProjectCursorError);

    for (const payload of [
      { version: 2, ...cursor },
      { version: 1, ...cursor, ownerId: "secret" },
      { version: 1, ...cursor, updatedAt: "not-a-date" },
    ]) {
      const token = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
      expect(() => decodeProjectCursor(token)).toThrow(ProjectCursorError);
    }
  });

  it("refuses invalid values at encode time", () => {
    expect(() => encodeProjectCursor({ ...cursor, id: "not-a-uuid" })).toThrow(ProjectCursorError);
    expect(() => encodeProjectCursor({ ...cursor, updatedAt: "not-a-date" })).toThrow(ProjectCursorError);
  });
});
