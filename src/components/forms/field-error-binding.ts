import type { AriaAttributes } from "react";

import type { ActionState } from "@/server/action-result";

function safeIdPart(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "field";
}

export function fieldErrorId(formId: string, field: string): string {
  return `wp-${safeIdPart(formId)}-${safeIdPart(field)}-error`;
}

export function fieldErrorControlProps(
  state: ActionState,
  field: string,
  errorId: string,
  helpTextIds: string[] = [],
): Pick<AriaAttributes, "aria-describedby" | "aria-invalid"> {
  const invalid = state.status === "error" && Boolean(state.error.fieldErrors?.[field]);
  const describedBy = [...new Set([...helpTextIds, errorId].filter(Boolean))].join(" ");
  return {
    "aria-describedby": describedBy,
    "aria-invalid": invalid ? true : undefined,
  };
}
