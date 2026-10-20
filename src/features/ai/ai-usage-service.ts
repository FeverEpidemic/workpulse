import { parseAiUsageRows, type AiUsage } from "@/domain/ai/usage";
import {
  AiServiceError,
  mapAiDatabaseError,
  requireAiActorId,
  withAiErrorBoundary,
  type AiClient,
} from "@/features/ai/ai-errors";

export function createAiUsageService(client: AiClient) {
  return {
    /** The session owner's AI units and the window that blocks the next request, per bucket. */
    async getUsage(): Promise<AiUsage> {
      return withAiErrorBoundary(async () => {
        await requireAiActorId(client);
        const { data, error } = await client.rpc("get_ai_usage");
        if (error) throw mapAiDatabaseError(error);
        const usage = parseAiUsageRows(data);
        if (!usage) throw new AiServiceError("UNAVAILABLE");
        return usage;
      });
    },
  };
}
