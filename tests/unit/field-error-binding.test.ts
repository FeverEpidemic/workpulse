import { describe, expect, it } from "vitest";

import { fieldErrorControlProps, fieldErrorId } from "@/components/forms/field-error-binding";
import { actionFailure, IDLE_ACTION_STATE } from "@/server/action-result";

describe("field error bindings", () => {
  it("creates stable IDs scoped to both form and field", () => {
    expect(fieldErrorId("profile-settings-form", "start_year")).toBe("wp-profile-settings-form-start_year-error");
    expect(fieldErrorId("profile-settings-form", "start_year")).not.toBe(fieldErrorId("foundation-experience-new", "start_year"));
  });

  it("always preserves help and error references and marks only invalid fields", () => {
    const errorId = fieldErrorId("onboarding-profile-form", "timezone");
    expect(fieldErrorControlProps(IDLE_ACTION_STATE, "timezone", errorId, ["timezone-help", errorId])).toEqual({
      "aria-describedby": `timezone-help ${errorId}`,
      "aria-invalid": undefined,
    });

    const invalidState = actionFailure("VALIDATION", "error.validation", {
      fieldErrors: { timezone: "validation.timezone" },
    });
    expect(fieldErrorControlProps(invalidState, "timezone", errorId, ["timezone-help"])).toEqual({
      "aria-describedby": `timezone-help ${errorId}`,
      "aria-invalid": true,
    });
    expect(fieldErrorControlProps(invalidState, "display_name", errorId)["aria-invalid"]).toBeUndefined();
  });
});
