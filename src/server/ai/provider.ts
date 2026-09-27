import type { AiErrorCode } from "../../domain/ai/contracts.ts";
import type { DetectInput } from "../../domain/ai/minimize.ts";

export interface AIProviderUsage {
  inputTokens: number;
  outputTokens: number;
}

export type AIProviderResult =
  | { status: "ok"; output: unknown; model: string; usage?: AIProviderUsage }
  | { status: "error"; code: AiErrorCode };

/**
 * Server-side AI adapter. Implementations never log or rethrow provider bodies,
 * request text or credentials; failures collapse to a stable AiErrorCode.
 */
export interface AIProvider {
  readonly kind: "openai" | "fake" | "unavailable";
  detect(input: DetectInput, signal: AbortSignal): Promise<AIProviderResult>;
}

export class UnavailableAIProvider implements AIProvider {
  readonly kind = "unavailable" as const;
  private readonly code: "AI_UNAVAILABLE" | "AI_CONFIG_INVALID";

  // No TypeScript parameter properties: the worker runs under Node type stripping.
  constructor(code: "AI_UNAVAILABLE" | "AI_CONFIG_INVALID" = "AI_UNAVAILABLE") {
    this.code = code;
  }

  async detect(): Promise<AIProviderResult> {
    return { status: "error", code: this.code };
  }
}
