import { describe, expect, it } from "vitest";

import { isOperationKey, operationKeyStorageKey } from "@/components/forms/operation-key";

describe("foundation create operation keys", () => {
  it("requires and namespaces an owner and form key", () => {
    expect(operationKeyStorageKey(null, "foundation-experience-new")).toBeNull();
    expect(operationKeyStorageKey("user-a", null)).toBeNull();
    expect(operationKeyStorageKey("user-a", "foundation-experience-new")).toBe(
      "workpulse:operation:v1:user-a:foundation-experience-new",
    );
    expect(operationKeyStorageKey("user-a", "foundation-experience-new")).not.toBe(
      operationKeyStorageKey("user-b", "foundation-experience-new"),
    );
    expect(operationKeyStorageKey("user-a", "foundation-experience-new")).not.toBe(
      operationKeyStorageKey("user-a", "foundation-education-new"),
    );
  });

  it("accepts UUIDs and rejects missing or malformed retry keys", () => {
    expect(isOperationKey("11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(isOperationKey("not-a-uuid")).toBe(false);
    expect(isOperationKey(null)).toBe(false);
    expect(isOperationKey(undefined)).toBe(false);
  });
});
