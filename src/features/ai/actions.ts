"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";

import { AiServiceError } from "@/features/ai/ai-errors";
import { createAiConsentService } from "@/features/ai/consent-service";
import { actionFailure, actionSuccess, type ActionState } from "@/server/action-result";
import { createSupabaseServerClient } from "@/server/supabase/server";

const consentFormSchema = z.object({
  consent: z.enum(["allow", "withdraw"]),
  expected_revision: z.coerce.number().int().positive(),
}).strict();

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** S12 AI processing consent: grant the current version or withdraw for future requests. */
export async function setAiConsentAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = consentFormSchema.safeParse({
    consent: text(formData, "consent"),
    expected_revision: text(formData, "expected_revision"),
  });
  if (!parsed.success) return actionFailure("VALIDATION", "error.validation");

  try {
    const client = await createSupabaseServerClient();
    const consented = parsed.data.consent === "allow";
    const state = await createAiConsentService(client).setConsent({
      expectedRevision: parsed.data.expected_revision,
      consented,
    });
    revalidatePath("/settings/profile");
    return actionSuccess(consented ? "ai.consent.allowed" : "ai.consent.withdrawn", state);
  } catch (error) {
    if (!(error instanceof AiServiceError)) return actionFailure("UNAVAILABLE", "error.unavailable");
    switch (error.code) {
      case "UNAUTHENTICATED":
        return actionFailure("UNAUTHENTICATED", error.messageKey);
      case "CONFLICT":
        return actionFailure("CONFLICT", "ai.consent.conflict");
      case "VALIDATION":
        return actionFailure("VALIDATION", error.messageKey);
      default:
        return actionFailure("UNAVAILABLE", "error.unavailable");
    }
  }
}
