"use server";

import { revalidatePath } from "next/cache";

import { removeCvItemInput, reorderCvSectionInput, selectCvSourceInput, updateCvLayoutInput } from "@/domain/cv/contracts";
import { actionFailure, actionSuccess, type ActionState, type ErrorCode } from "@/server/action-result";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { CvServiceError, toCvServiceError } from "./cv-errors";
import { createCvService, type CvService } from "./cv-service";

function mapCode(code: CvServiceError["code"]): ErrorCode {
  switch (code) {
    case "VALIDATION":
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
function failure(error: unknown): ActionState {
  const cvError = toCvServiceError(error, crypto.randomUUID());
  const details = cvError.code === "CHILD_ITEMS_EXIST" ? { latestRecord: { childItemIds: cvError.childItemIds } } : {};
  const state = actionFailure(mapCode(cvError.code), cvError.messageKey, details);
  return state.status === "error" ? { status: "error", error: { ...state.error, correlationId: cvError.correlationId } } : state;
}

async function run<T>(operation: (service: CvService) => Promise<T>): Promise<ActionState> {
  try {
    const supabase = await createSupabaseServerClient();
    const data = await operation(createCvService({ supabase, correlationId: crypto.randomUUID() }));
    revalidatePath("/cv");
    return actionSuccess(undefined, data);
  } catch (error) {
    return failure(error);
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
