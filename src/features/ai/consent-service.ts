import * as z from "zod";

import { AI_CONSENT_VERSION } from "@/domain/ai/contracts";
import {
  AiServiceError,
  mapAiDatabaseError,
  requireAiActorId,
  withAiErrorBoundary,
  type AiClient,
} from "@/features/ai/ai-errors";

export interface AiConsentState {
  revision: number;
  aiConsentAt: string | null;
  aiConsentVersion: string | null;
}

/** True only for consent to the version this build sends text under. */
export function hasCurrentAiConsent(profile: { ai_consent_at: string | null; ai_consent_version: string | null }): boolean {
  return profile.ai_consent_at !== null && profile.ai_consent_version === AI_CONSENT_VERSION;
}

const consentInputSchema = z.object({
  expectedRevision: z.number().int().positive(),
  consented: z.boolean(),
}).strict();

const consentRowSchema = z.object({
  revision: z.number().int().positive(),
  ai_consent_at: z.string().nullable(),
  ai_consent_version: z.string().nullable(),
}).strict();

export function createAiConsentService(client: AiClient) {
  return {
    /** Grant (current version) or withdraw AI processing consent for the session owner. */
    async setConsent(input: unknown): Promise<AiConsentState> {
      return withAiErrorBoundary(async () => {
        const parsed = consentInputSchema.safeParse(input);
        if (!parsed.success) throw new AiServiceError("VALIDATION");
        await requireAiActorId(client);
        const { data, error } = await client.rpc("set_ai_consent", {
          p_expected_revision: parsed.data.expectedRevision,
          p_consented: parsed.data.consented,
        });
        if (error) throw mapAiDatabaseError(error);
        const row = consentRowSchema.safeParse(Array.isArray(data) ? data[0] : null);
        if (!row.success) throw new AiServiceError("UNAVAILABLE");
        const consistent = parsed.data.consented
          ? row.data.ai_consent_version === AI_CONSENT_VERSION && row.data.ai_consent_at !== null
          : row.data.ai_consent_version === null && row.data.ai_consent_at === null;
        if (!consistent) throw new AiServiceError("UNAVAILABLE");
        return {
          revision: row.data.revision,
          aiConsentAt: row.data.ai_consent_at,
          aiConsentVersion: row.data.ai_consent_version,
        };
      });
    },
  };
}
