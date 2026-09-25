import { describe, expect, it } from "vitest";

import { ActivityServiceError } from "@/features/activity/activity-service";
import {
  activityActionErrorState,
  activityCreateInputFromForm,
  activityUpdateInputFromForm,
} from "@/features/activity/activity-action-contract";

function makeForm(entries: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(entries)) form.set(key, value);
  return form;
}

describe("Activity form and action boundary", () => {
  it("preserves source text exactly and excludes owner identity from create input", () => {
    const rawText = "  launch notes\n\nwith spacing  ";
    const input = activityCreateInputFromForm(makeForm({
      operation_key: "bb781741-c3ab-4113-a873-ed0282e8311e",
      capture_mode: "note",
      raw_text: rawText,
      occurred_on: "2026-09-17",
      role: "stale role",
      scope: "stale scope",
      outcome: "stale outcome",
      project_id: "",
      experience_id: "",
      user_id: "attacker-controlled-owner",
    }));

    expect(input.rawText).toBe(rawText);
    expect(input).toMatchObject({ role: null, scope: null, outcome: null, projectId: null, experienceId: null });
    expect(input).not.toHaveProperty("user_id");
  });

  it("reverses only HTML textarea CRLF submission encoding", () => {
    const input = activityCreateInputFromForm(makeForm({
      operation_key: "bb781741-c3ab-4113-a873-ed0282e8311e",
      capture_mode: "note",
      raw_text: "  first line\r\nsecond line\r\n  ",
      occurred_on: "2026-09-17",
    }));

    expect(input.rawText).toBe("  first line\nsecond line\n  ");
  });

  it("keeps optional structured fields for Form and preserves owned fields for Note or Chat edits", () => {
    const formInput = activityCreateInputFromForm(makeForm({
      operation_key: "bb781741-c3ab-4113-a873-ed0282e8311e",
      capture_mode: "form",
      raw_text: "Delivered an update.",
      occurred_on: "2026-09-17",
      role: "  Analyst  ",
      scope: "  Three regions  ",
      outcome: "  Published  ",
      project_id: "d8edc2e3-618e-4f23-a1de-e9ae18cb9740",
      experience_id: "69d5940d-288c-4d5b-a9a7-41954870c1b8",
    }));
    expect(formInput).toMatchObject({ role: "  Analyst  ", scope: "  Three regions  ", outcome: "  Published  " });

    const updateInput = activityUpdateInputFromForm(makeForm({
      activity_id: "bb781741-c3ab-4113-a873-ed0282e8311e",
      expected_revision: "4",
      capture_mode: "form",
      raw_text: "Edited current text.",
      occurred_on: "2026-09-17",
      role: "hidden role",
      scope: "hidden scope",
      outcome: "hidden outcome",
    }), "chat", {
      role: "Canonical role",
      scope: "Canonical scope",
      outcome: "Canonical outcome",
    });
    expect(updateInput).toMatchObject({
      expectedRevision: 4,
      role: "Canonical role",
      scope: "Canonical scope",
      outcome: "Canonical outcome",
      projectId: null,
      experienceId: null,
    });
  });

  it("maps service errors to localized action state without changing their correlation ID", () => {
    const serviceError = new ActivityServiceError("VALIDATION", {
      fieldErrors: { rawText: "error.validation", occurredOn: "error.validation", projectId: "error.validation" },
    });
    const actionState = activityActionErrorState(serviceError);

    expect(actionState).toEqual({
      status: "error",
      error: {
        code: "VALIDATION",
        messageKey: "error.validation",
        correlationId: serviceError.correlationId,
        fieldErrors: {
          raw_text: "error.validation",
          occurred_on: "error.validation",
          project_id: "error.validation",
        },
      },
    });

    const reusedKeyState = activityActionErrorState(new ActivityServiceError("IDEMPOTENCY_KEY_REUSED"));
    expect(reusedKeyState).toMatchObject({
      status: "error",
      error: { code: "CONFLICT", messageKey: "error.operationKeyReused" },
    });
  });
});
