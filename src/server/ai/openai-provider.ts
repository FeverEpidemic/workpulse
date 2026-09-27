import type { AiErrorCode } from "../../domain/ai/contracts.ts";
import { detectResultJsonSchema } from "../../domain/ai/detect-result.ts";
import type { DetectInput } from "../../domain/ai/minimize.ts";
import { DETECT_INSTRUCTIONS } from "./detect-prompt.ts";
import type { AIProvider, AIProviderResult } from "./provider.ts";

export const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
const MAX_OUTPUT_TOKENS = 4_000;

export interface OpenAIProviderOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  reasoningEffort?: "none" | "low" | "medium";
  fetch?: typeof fetch;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function statusToCode(status: number): AiErrorCode {
  if (status === 401 || status === 403 || status === 400 || status === 404 || status === 422) return "AI_CONFIG_INVALID";
  if (status === 429 || status === 409) return "AI_RATE_LIMITED";
  if (status === 408) return "AI_PROVIDER_TIMEOUT";
  return "AI_PROVIDER_UNAVAILABLE";
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

/** Extracts the structured output from a Responses API body without echoing it anywhere. */
export function readResponsesOutput(body: unknown): AIProviderResult {
  if (!isObject(body)) return { status: "error", code: "AI_OUTPUT_INVALID" };
  if (body.status === "failed" || body.status === "cancelled") {
    return { status: "error", code: "AI_PROVIDER_UNAVAILABLE" };
  }
  if (body.status !== "completed") return { status: "error", code: "AI_OUTPUT_INVALID" };

  const output = Array.isArray(body.output) ? body.output : [];
  for (const item of output) {
    if (!isObject(item) || item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (!isObject(content)) continue;
      if (content.type === "refusal") return { status: "error", code: "AI_REFUSED" };
      if (content.type === "output_text" && typeof content.text === "string") {
        let parsed: unknown;
        try {
          parsed = JSON.parse(content.text);
        } catch {
          return { status: "error", code: "AI_OUTPUT_INVALID" };
        }
        const usage = isObject(body.usage)
          && typeof body.usage.input_tokens === "number"
          && typeof body.usage.output_tokens === "number"
          ? { inputTokens: body.usage.input_tokens, outputTokens: body.usage.output_tokens }
          : undefined;
        return {
          status: "ok",
          output: parsed,
          model: typeof body.model === "string" ? body.model : "unknown",
          ...(usage ? { usage } : {}),
        };
      }
    }
  }
  return { status: "error", code: "AI_OUTPUT_INVALID" };
}

/**
 * OpenAI Responses API adapter using fetch directly (no SDK). Requests use strict
 * Structured Outputs and store=false. The API key only ever appears in the
 * Authorization header; errors carry codes, never bodies or input text.
 */
export class OpenAIProvider implements AIProvider {
  readonly kind = "openai" as const;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenAIProviderOptions) {
    this.endpoint = `${(options.baseUrl ?? OPENAI_DEFAULT_BASE_URL).replace(/\/+$/, "")}/responses`;
    this.fetchImpl = options.fetch ?? fetch;
  }

  requestBody(input: DetectInput): JsonObject {
    return {
      model: this.options.model,
      instructions: DETECT_INSTRUCTIONS,
      input: JSON.stringify(input),
      reasoning: { effort: this.options.reasoningEffort ?? "low" },
      text: {
        format: { type: "json_schema", name: "detect_v1", strict: true, schema: detectResultJsonSchema },
      },
      store: false,
      max_output_tokens: MAX_OUTPUT_TOKENS,
    };
  }

  async detect(input: DetectInput, signal: AbortSignal): Promise<AIProviderResult> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(this.requestBody(input)),
        signal,
      });
    } catch (error) {
      return { status: "error", code: isAbort(error) || signal.aborted ? "AI_PROVIDER_TIMEOUT" : "AI_PROVIDER_UNAVAILABLE" };
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { status: "error", code: statusToCode(response.status) };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      return { status: "error", code: isAbort(error) || signal.aborted ? "AI_PROVIDER_TIMEOUT" : "AI_OUTPUT_INVALID" };
    }
    return readResponsesOutput(body);
  }
}
