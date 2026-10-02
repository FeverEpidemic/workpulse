"use server";

import { revalidatePath } from "next/cache";

import {
  removeCvItemInput,
  reorderCvSectionInput,
  resolveCvFreshnessInput,
  saveCvEditsInput,
  selectCvSourceInput,
  updateCvLayoutInput,
} from "@/domain/cv/contracts";
import { actionFailure, actionSuccess, type ActionState, type ErrorCode } from "@/server/action-result";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { CvServiceError, toCvServiceError } from "./cv-errors";
import { createCvService, type CvService } from "./cv-service";

function mapCode(code: CvServiceError["code"]): ErrorCode {
  switch (code) {
    case "VALIDATION":
    case "OVERRIDE_UNSUPPORTED":
    case "RESOLUTION_INVALID":
    case "ONBOARDING_REQUIRED":
    case "SOURCE_INELIGIBLE": return "VALIDATION";
    case "UNAUTHENTICATED": return "UNAUTHENTICATED";
    case "NOT_FOUND":
    case "SOURCE_NOT_FOUND": return "NOT_FOUND";
    case "UNAVAILABLE": return "UNAVAILABLE";
    default: return "CONFLICT";
  }
}

/** Codes, message keys and item ids only; the service correlation ID is kept so support can match logs. */
function failure(error: unknown, correlationId: string): ActionState {
  const cvError = toCvServiceError(error, correlationId);
  const details = cvError.code === "CHILD_ITEMS_EXIST" ? { latestRecord: { childItemIds: cvError.childItemIds } } : {};
  const state = actionFailure(mapCode(cvError.code), cvError.messageKey, details);
  return state.status === "error" ? { status: "error", error: { ...state.error, correlationId: cvError.correlationId } } : state;
}

/** Dashboard S04 shows CV checks, so a freshness resolution also refreshes it. */
async function run<T>(operation: (service: CvService) => Promise<T>, alsoRevalidate: readonly string[] = []): Promise<ActionState> {
  // One ID per request: the service stamps its errors with it and failure() reuses it for anything else.
  const correlationId = crypto.randomUUID();
  try {
    const supabase = await createSupabaseServerClient();
    const data = await operation(createCvService({ supabase, correlationId }));
    revalidatePath("/cv");
    for (const path of alsoRevalidate) revalidatePath(path);
    return actionSuccess(undefined, data);
  } catch (error) {
    return failure(error, correlationId);
  }
}

function text(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" && value !== "" ? value : undefined;
}

function texts(formData: FormData, name: string): string[] {
  return formData.getAll(name).filter((value): value is string => typeof value === "string");
}

function revisionOf(formData: FormData): number {
  return Number(text(formData, "expected_revision"));
}

/** First open of the single master CV (UI in T19). */
export async function ensureCvAction(_previous: ActionState): Promise<ActionState> {
  return run((service) => service.ensure());
}

/** Add one source; an achievement also adds its required parent. */
export async function selectCvSourceAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = selectCvSourceInput.safeParse({
    expected_revision: revisionOf(formData),
    source_type: text(formData, "source_type"),
    source_id: text(formData, "source_id"),
  });
  if (!parsed.success) return actionFailure("VALIDATION", "error.validation");
  return run((service) => service.select(parsed.data));
}

/** Remove one item; remove_children must be an explicit "true" or "false". */
export async function removeCvItemAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const removeChildren = text(formData, "remove_children");
  const parsed = removeCvItemInput.safeParse({
    expected_revision: revisionOf(formData),
    item_id: text(formData, "item_id"),
    remove_children: removeChildren === "true" ? true : removeChildren === "false" ? false : removeChildren,
  });
  if (!parsed.success) return actionFailure("VALIDATION", "error.validation");
  return run((service) => service.remove(parsed.data));
}

/** Reorder one section; the item ids arrive as repeated "item_id" fields in the new order. */
export async function reorderCvSectionAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = reorderCvSectionInput.safeParse({
    expected_revision: revisionOf(formData),
    section_key: text(formData, "section_key"),
    item_ids: texts(formData, "item_id"),
  });
  if (!parsed.success) return actionFailure("VALIDATION", "error.validation");
  return run((service) => service.reorder(parsed.data));
}

/** Locale label and/or section order; the order arrives as repeated "section" fields. */
export async function updateCvLayoutAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const sections = texts(formData, "section");
  const parsed = updateCvLayoutInput.safeParse({
    expected_revision: revisionOf(formData),
    locale: text(formData, "locale"),
    section_order: sections.length > 0 ? sections : undefined,
  });
  if (!parsed.success) return actionFailure("VALIDATION", "error.validation");
  return run((service) => service.updateLayout(parsed.data));
}

/** Explicit Save of the text edits; "edits" is a JSON object with only the changed fields. */
export async function saveCvEditsAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  let edits: unknown;
  try {
    edits = JSON.parse(text(formData, "edits") ?? "");
  } catch {
    return actionFailure("VALIDATION", "error.validation");
  }
  if (typeof edits !== "object" || edits === null || Array.isArray(edits)) return actionFailure("VALIDATION", "error.validation");
  const parsed = saveCvEditsInput.safeParse({ ...edits, expected_revision: revisionOf(formData) });
  if (!parsed.success) return actionFailure("VALIDATION", "error.validation");
  return run((service) => service.saveEdits(parsed.data));
}

/** Keep, refresh or replace changed sources; "resolutions" is a JSON array and the revision comes from its own field. */
export async function resolveCvFreshnessAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  let resolutions: unknown;
  try {
    resolutions = JSON.parse(text(formData, "resolutions") ?? "");
  } catch {
    return actionFailure("VALIDATION", "error.validation");
  }
  const parsed = resolveCvFreshnessInput.safeParse({ expected_revision: revisionOf(formData), resolutions });
  if (!parsed.success) return actionFailure("VALIDATION", "error.validation");
  return run((service) => service.resolveFreshness(parsed.data), ["/dashboard"]);
}
