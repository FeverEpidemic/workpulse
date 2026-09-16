import { describe, expect, it } from "vitest";

import { actionFailure, actionSuccess } from "@/server/action-result";

describe("mutation result contract", () => {
  it("returns a discriminated success with a correlation id", () => {
    const result = actionSuccess("profile.saved");
    expect(result.status).toBe("success");
    if (result.status === "success") expect(result.correlationId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("returns localized error keys and field errors without raw messages", () => {
    const result = actionFailure("VALIDATION", "error.validation", {
      fieldErrors: { display_name: "validation.displayName" },
    });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.messageKey).toBe("error.validation");
      expect(result.error.fieldErrors?.display_name).toBe("validation.displayName");
      expect(result.error.correlationId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(result.error).not.toHaveProperty("message");
    }
  });
});
