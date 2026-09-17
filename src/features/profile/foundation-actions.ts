"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";

import { parsePartialDateForm, PartialDateValidationError, type CanonicalPartialDate } from "@/domain/dates/partial-date";
import { FOUNDATION_FIELD_LIMITS } from "@/domain/profile/field-contract";
import type { MessageKey } from "@/i18n/messages";
import { actionFailure, actionSuccess, type ActionState } from "@/server/action-result";
import { createSupabaseServerClient } from "@/server/supabase/server";
import type { Database, Json } from "@/server/supabase/database.types";

const kindSchema = z.enum(["experience", "education", "certification", "skill"]);
type FoundationKind = z.infer<typeof kindSchema>;

interface FoundationPayload {
  [key: string]: string | boolean | null;
}

interface ParsedFoundationForm {
  kind: FoundationKind;
  id: string | null;
  expectedRevision: number;
  operationKey: string | null;
  payload: FoundationPayload;
}

interface DatabaseErrorShape {
  code?: string;
  message?: string;
  status?: number;
}

type PublicFunctionName = keyof Database["public"]["Functions"];
type PublicFunctionArgs<Name extends PublicFunctionName> =
  Database["public"]["Functions"][Name] extends { Args: infer Args extends object } ? Args : never;
type NullableFunctionArgs<Name extends PublicFunctionName, Keys extends keyof PublicFunctionArgs<Name>> =
  Omit<PublicFunctionArgs<Name>, Keys> & {
    [Key in Keys]: PublicFunctionArgs<Name>[Key] | null;
  };

// Supabase's generated RPC Args currently marks SQL parameters required even when
// the PostgreSQL function accepts NULL. Keep the generated shape intact and adapt
// only those nullable parameters at this call boundary.
function withNullableFunctionArgs<
  Name extends PublicFunctionName,
  Keys extends keyof PublicFunctionArgs<Name>,
>(args: NullableFunctionArgs<Name, Keys>): PublicFunctionArgs<Name> {
  return args as unknown as PublicFunctionArgs<Name>;
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function zodFailure(error: z.ZodError): ActionState {
  const fieldErrors: Partial<Record<string, MessageKey>> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    fieldErrors[field] = issue.message.startsWith("validation.") ? issue.message as MessageKey : "error.validation";
  }
  return actionFailure("VALIDATION", "error.validation", { fieldErrors });
}

function formParseFailure(field: string): ActionState {
  return actionFailure("VALIDATION", "error.validation", {
    fieldErrors: { [field]: "validation.partialDate" },
  });
}

function partialDateFailure(error: unknown, prefix: string): ActionState {
  const field = error instanceof PartialDateValidationError && error.inputName
    ? error.inputName
    : `${prefix}_${error instanceof PartialDateValidationError ? error.field : "year"}`;
  return formParseFailure(field);
}

function commonValues(formData: FormData): { id: string | null; expectedRevision: number } | ActionState {
  const rawId = text(formData, "id");
  let id: string | null = null;
  if (rawId) {
    const parsedId = z.uuid().safeParse(rawId);
    if (!parsedId.success) return actionFailure("VALIDATION", "error.validation");
    id = parsedId.data;
  }

  const rawRevision = text(formData, "expected_revision");
  if (!id && !rawRevision) return { id, expectedRevision: 1 };
  const parsedRevision = z.coerce.number().int().positive().safeParse(rawRevision);
  if (!parsedRevision.success) return actionFailure("VALIDATION", "error.validation");
  return { id, expectedRevision: parsedRevision.data };
}

function dateFields(formData: FormData, startPrefix: string, endPrefix?: string, isCurrent = false): Record<string, string | null | boolean> {
  const start: CanonicalPartialDate = parsePartialDateForm(formData, startPrefix);
  const fields: Record<string, string | null | boolean> = {
    [`${startPrefix}_date`]: start.date,
    [`${startPrefix}_precision`]: start.precision,
  };

  if (endPrefix) {
    const end = isCurrent ? { date: null, precision: null } : parsePartialDateForm(formData, endPrefix);
    fields[`${endPrefix}_date`] = end.date;
    fields[`${endPrefix}_precision`] = end.precision;
    fields.is_current = isCurrent;
  }
  return fields;
}

function parseFoundationForm(formData: FormData): ParsedFoundationForm | ActionState {
  const parsedKind = kindSchema.safeParse(text(formData, "kind"));
  if (!parsedKind.success) return actionFailure("VALIDATION", "error.validation");
  const common = commonValues(formData);
  if ("status" in common) return common;
  let operationKey: string | null = null;
  if (!common.id) {
    const parsedOperationKey = z.uuid().safeParse(text(formData, "operation_key"));
    if (!parsedOperationKey.success) return actionFailure("VALIDATION", "error.validation");
    operationKey = parsedOperationKey.data;
  }
  const isCurrent = formData.get("is_current") === "on";

  if (parsedKind.data === "experience") {
    const parsed = z.object({
      organization: z.string().trim().min(1, "validation.required").max(FOUNDATION_FIELD_LIMITS.organization),
      role_title: z.string().trim().min(1, "validation.required").max(FOUNDATION_FIELD_LIMITS.roleTitle),
      description: z.string().trim().max(FOUNDATION_FIELD_LIMITS.experienceDescription),
      kind: z.enum(["employment", "internship", "volunteer"]),
    }).safeParse({
      organization: text(formData, "organization"),
      role_title: text(formData, "role_title"),
      description: text(formData, "description"),
      kind: text(formData, "experience_kind"),
    });
    if (!parsed.success) return zodFailure(parsed.error);
    try {
      return {
        kind: "experience",
        ...common,
        operationKey,
        payload: {
          organization: parsed.data.organization,
          role_title: parsed.data.role_title,
          description: parsed.data.description || null,
          kind: parsed.data.kind,
          ...dateFields(formData, "start", "end", isCurrent),
        },
      };
    } catch (error) {
      return partialDateFailure(error, "start");
    }
  }

  if (parsedKind.data === "education") {
    const parsed = z.object({
      institution: z.string().trim().min(1, "validation.required").max(FOUNDATION_FIELD_LIMITS.institution),
      qualification: z.string().trim().min(1, "validation.required").max(FOUNDATION_FIELD_LIMITS.qualification),
      field_of_study: z.string().trim().max(FOUNDATION_FIELD_LIMITS.fieldOfStudy),
      description: z.string().trim().max(FOUNDATION_FIELD_LIMITS.educationDescription),
    }).safeParse({
      institution: text(formData, "institution"),
      qualification: text(formData, "qualification"),
      field_of_study: text(formData, "field_of_study"),
      description: text(formData, "description"),
    });
    if (!parsed.success) return zodFailure(parsed.error);
    try {
      return {
        kind: "education",
        ...common,
        operationKey,
        payload: {
          institution: parsed.data.institution,
          qualification: parsed.data.qualification,
          field_of_study: parsed.data.field_of_study || null,
          description: parsed.data.description || null,
          ...dateFields(formData, "start", "end", isCurrent),
        },
      };
    } catch (error) {
      return partialDateFailure(error, "start");
    }
  }

  if (parsedKind.data === "certification") {
    const credentialUrl = text(formData, "credential_url").trim();
    const parsed = z.object({
      name: z.string().trim().min(1, "validation.required").max(FOUNDATION_FIELD_LIMITS.certificationName),
      issuer: z.string().trim().max(FOUNDATION_FIELD_LIMITS.issuer),
      credential_url: z.string().trim().max(FOUNDATION_FIELD_LIMITS.credentialUrl).refine((value) => {
        if (!value) return true;
        try {
          const url = new URL(value);
          return url.protocol === "http:" || url.protocol === "https:";
        } catch {
          return false;
        }
      }, "validation.url"),
    }).safeParse({
      name: text(formData, "name"),
      issuer: text(formData, "issuer"),
      credential_url: credentialUrl,
    });
    if (!parsed.success) return zodFailure(parsed.error);
    try {
      const issued = parsePartialDateForm(formData, "issued");
      return {
        kind: "certification",
        ...common,
        operationKey,
        payload: {
          name: parsed.data.name,
          issuer: parsed.data.issuer || null,
          credential_url: parsed.data.credential_url || null,
          issued_date: issued.date,
          issued_precision: issued.precision,
        },
      };
    } catch (error) {
      return partialDateFailure(error, "issued");
    }
  }

  const skill = z.string().trim().min(1, "validation.required").max(FOUNDATION_FIELD_LIMITS.skillName).safeParse(text(formData, "name"));
  if (!skill.success) return zodFailure(skill.error);
  return { kind: "skill", ...common, operationKey, payload: { name: skill.data } };
}

async function getLatestRecord(
  client: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  kind: FoundationKind,
  id: string,
  userId: string,
) {
  switch (kind) {
    case "experience": {
      const { data } = await client.from("experiences").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
      return data;
    }
    case "education": {
      const { data } = await client.from("education").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
      return data;
    }
    case "certification": {
      const { data } = await client.from("certifications").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
      return data;
    }
    case "skill": {
      const { data } = await client.from("skills").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
      return data;
    }
  }
}

function databaseFailure(
  error: DatabaseErrorShape,
  kind: FoundationKind,
  latestRecord?: Record<string, unknown> | null,
): ActionState {
  if (error.code === "22023" && error.message === "IDEMPOTENCY_KEY_REUSED") {
    return actionFailure("CONFLICT", "error.operationKeyReused");
  }
  if (error.code === "P0001" && error.message === "STALE_REVISION") {
    return latestRecord
      ? actionFailure("CONFLICT", "error.conflict", { latestRecord })
      : actionFailure("NOT_FOUND", "error.notFound");
  }
  if (error.code === "42501") return actionFailure("UNAUTHENTICATED", "auth.signInRequired");
  if (error.code === "23505" && kind === "skill") {
    return actionFailure("VALIDATION", "error.validation", {
      fieldErrors: { name: "validation.skillDuplicate" },
    });
  }
  if (error.code === "23514") return actionFailure("VALIDATION", "error.validation");
  if (/^(22|23)/.test(error.code ?? "")) return actionFailure("VALIDATION", "error.validation");
  return actionFailure("UNAVAILABLE", "error.unavailable");
}

export async function saveFoundationAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseFoundationForm(formData);
  if ("status" in parsed) return parsed;

  try {
    const client = await createSupabaseServerClient();
    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError || !authData.user) return actionFailure("UNAUTHENTICATED", "auth.signInRequired");

    if (!parsed.id) {
      if (!parsed.operationKey) return actionFailure("VALIDATION", "error.validation");
      let result;
      switch (parsed.kind) {
        case "experience":
          result = await client.rpc("create_experience_idempotent", withNullableFunctionArgs<
            "create_experience_idempotent",
            "p_description" | "p_start_date" | "p_start_precision" | "p_end_date" | "p_end_precision"
          >({
            p_operation_key: parsed.operationKey,
            p_organization: parsed.payload.organization as string,
            p_role_title: parsed.payload.role_title as string,
            p_description: parsed.payload.description as string | null,
            p_kind: parsed.payload.kind as string,
            p_start_date: parsed.payload.start_date as string | null,
            p_start_precision: parsed.payload.start_precision as string | null,
            p_end_date: parsed.payload.end_date as string | null,
            p_end_precision: parsed.payload.end_precision as string | null,
            p_is_current: parsed.payload.is_current as boolean,
          }));
          break;
        case "education":
          result = await client.rpc("create_education_idempotent", withNullableFunctionArgs<
            "create_education_idempotent",
            "p_field_of_study" | "p_description" | "p_start_date" | "p_start_precision" | "p_end_date" | "p_end_precision"
          >({
            p_operation_key: parsed.operationKey,
            p_institution: parsed.payload.institution as string,
            p_qualification: parsed.payload.qualification as string,
            p_field_of_study: parsed.payload.field_of_study as string | null,
            p_description: parsed.payload.description as string | null,
            p_start_date: parsed.payload.start_date as string | null,
            p_start_precision: parsed.payload.start_precision as string | null,
            p_end_date: parsed.payload.end_date as string | null,
            p_end_precision: parsed.payload.end_precision as string | null,
            p_is_current: parsed.payload.is_current as boolean,
          }));
          break;
        case "certification":
          result = await client.rpc("create_certification_idempotent", withNullableFunctionArgs<
            "create_certification_idempotent",
            "p_issuer" | "p_credential_url" | "p_issued_date" | "p_issued_precision"
          >({
            p_operation_key: parsed.operationKey,
            p_name: parsed.payload.name as string,
            p_issuer: parsed.payload.issuer as string | null,
            p_credential_url: parsed.payload.credential_url as string | null,
            p_issued_date: parsed.payload.issued_date as string | null,
            p_issued_precision: parsed.payload.issued_precision as string | null,
          }));
          break;
        case "skill":
          result = await client.rpc("create_skill_idempotent", {
            p_operation_key: parsed.operationKey,
            p_name: parsed.payload.name as string,
          });
          break;
      }
      if (result.error) return databaseFailure(result.error, parsed.kind);
      const row = result.data?.[0];
      if (!row) return actionFailure("UNAVAILABLE", "error.unavailable");
      revalidatePath("/settings/profile");
      return actionSuccess("profile.recordSaved", row);
    }

    let result;
    const changes = parsed.payload as unknown as Json;
    switch (parsed.kind) {
      case "experience":
        result = await client.rpc("update_experience", { p_experience_id: parsed.id, p_expected_revision: parsed.expectedRevision, p_changes: changes });
        break;
      case "education":
        result = await client.rpc("update_education", { p_education_id: parsed.id, p_expected_revision: parsed.expectedRevision, p_changes: changes });
        break;
      case "certification":
        result = await client.rpc("update_certification", { p_certification_id: parsed.id, p_expected_revision: parsed.expectedRevision, p_changes: changes });
        break;
      case "skill":
        result = await client.rpc("update_skill", { p_skill_id: parsed.id, p_expected_revision: parsed.expectedRevision, p_changes: changes });
        break;
    }
    if (result.error) {
      const latest = result.error.code === "P0001" ? await getLatestRecord(client, parsed.kind, parsed.id, authData.user.id) : null;
      return databaseFailure(result.error, parsed.kind, latest as Record<string, unknown> | null);
    }
    const row = result.data?.[0];
    if (!row) {
      const latest = await getLatestRecord(client, parsed.kind, parsed.id, authData.user.id);
      return latest
        ? actionFailure("CONFLICT", "error.conflict", { latestRecord: latest as unknown as Record<string, unknown> })
        : actionFailure("NOT_FOUND", "error.notFound");
    }
    revalidatePath("/settings/profile");
    return actionSuccess("profile.recordSaved", row);
  } catch {
    return actionFailure("UNAVAILABLE", "error.unavailable");
  }
}

export async function deleteFoundationAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const kind = kindSchema.safeParse(text(formData, "kind"));
  const id = z.uuid().safeParse(text(formData, "id"));
  const revision = z.coerce.number().int().positive().safeParse(text(formData, "expected_revision"));
  if (!kind.success || !id.success || !revision.success) return actionFailure("VALIDATION", "error.validation");

  try {
    const client = await createSupabaseServerClient();
    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError || !authData.user) return actionFailure("UNAUTHENTICATED", "auth.signInRequired");

    let result;
    switch (kind.data) {
      case "experience":
        result = await client.rpc("delete_experience", { p_experience_id: id.data, p_expected_revision: revision.data });
        break;
      case "education":
        result = await client.rpc("delete_education", { p_education_id: id.data, p_expected_revision: revision.data });
        break;
      case "certification":
        result = await client.rpc("delete_certification", { p_certification_id: id.data, p_expected_revision: revision.data });
        break;
      case "skill":
        result = await client.rpc("delete_skill", { p_skill_id: id.data, p_expected_revision: revision.data });
        break;
    }

    if (result.error) {
      const latest = result.error.code === "P0001" ? await getLatestRecord(client, kind.data, id.data, authData.user.id) : null;
      return databaseFailure(result.error, kind.data, latest as Record<string, unknown> | null);
    }

    let releasedProjectCount = 0;
    if (kind.data === "experience") {
      const deleted = Array.isArray(result.data) ? result.data[0] : null;
      if (!deleted || typeof deleted !== "object" || !("released_project_count" in deleted)) {
        return actionFailure("NOT_FOUND", "error.notFound");
      }
      releasedProjectCount = Number(deleted.released_project_count);
    } else if (!result.data) {
      return actionFailure("NOT_FOUND", "error.notFound");
    }

    revalidatePath("/settings/profile");
    revalidatePath("/dashboard");
    return actionSuccess(kind.data === "experience" ? "profile.recordDeleted" : "profile.recordDeleted", {
      releasedProjectCount,
    });
  } catch {
    return actionFailure("UNAVAILABLE", "error.unavailable");
  }
}
