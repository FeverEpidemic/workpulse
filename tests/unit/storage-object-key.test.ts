import { describe, expect, it } from "vitest";

import {
  createStorageObjectKey,
  formatStorageObjectKey,
  parseStorageObjectKey,
} from "@/server/storage/object-key";

const ownerId = "11111111-1111-4111-8111-111111111111";
const objectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("private storage object keys", () => {
  it("builds and parses an exact owner/category/object UUID key", () => {
    const key = formatStorageObjectKey(ownerId, "evidence", objectId);

    expect(key).toBe(ownerId + "/evidence/" + objectId);
    expect(parseStorageObjectKey(key)).toEqual({
      ownerId,
      category: "evidence",
      objectId,
    });
  });

  it("generates a fresh canonical UUID for a new object", () => {
    const key = createStorageObjectKey(ownerId, "import");

    expect(parseStorageObjectKey(key)).toMatchObject({ ownerId, category: "import" });
    expect(parseStorageObjectKey(key)?.objectId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it.each([
    "11111111-1111-4111-8111-111111111111/evidence",
    ownerId + "/evidence/" + objectId + "/extra",
    ownerId + "/unknown/" + objectId,
    ownerId + "/evidence/../" + objectId,
    ownerId + "/evidence/%2F" + objectId,
    ownerId + "/evidence/" + objectId + "?download=1",
    ownerId + "/evidence/" + objectId + "#fragment",
    ownerId + "/evidence/" + objectId + ".pdf",
    "11111111-1111-4111-8111-11111111111A/evidence/" + objectId,
    ownerId + "\\evidence\\" + objectId,
  ])("rejects non-canonical key %s", (key) => {
    expect(parseStorageObjectKey(key)).toBeNull();
  });

  it("rejects malformed UUIDs when building a key", () => {
    expect(() => formatStorageObjectKey("not-an-id", "evidence", objectId)).toThrow(
      "Storage object key is invalid",
    );
    expect(() => formatStorageObjectKey(ownerId, "evidence", "Aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toThrow(
      "Storage object key is invalid",
    );
  });
});
