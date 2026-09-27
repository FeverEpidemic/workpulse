import type { AiErrorCode } from "../../domain/ai/contracts.ts";
import { detectResultJsonSchema } from "../../domain/ai/detect-result.ts";
import type { DetectInput } from "../../domain/ai/minimize.ts";
import { DETECT_INSTRUCTIONS } from "./detect-prompt.ts";
import type { AIProvider, AIProviderResult } from "./provider.ts";

export const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
const MAX_OUTPUT_TOKENS = 4_000;

export const OPENAI_API_STYLES = ["chat_completions", "responses"] as const;
export type OpenAIApiStyle = (typeof OPENAI_API_STYLES)[number];
export const STRUCTURED_OUTPUT_MODES = ["json_schema", "json_object"] as const;
export type StructuredOutputMode = (typeof STRUCTURED_OUTPUT_MODES)[number];

export interface OpenAIProviderOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  /** Chat Completions is the widest OpenAI-compatible surface; Responses is OpenAI's newer API. */
  api?: OpenAIApiStyle;
  /** json_schema = strict Structured Outputs; json_object = JSON mode with the schema in the prompt. */
  structuredOutput?: StructuredOutputMode;
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

/** Some compatible models wrap JSON mode output in a Markdown fence; accept only that exact wrapper. */
function parseJsonText(text: string): { ok: true; value: unknown } | { ok: false } {
  const fenced = text.trim().match(/^```(?:json)?\s*\n([\s\S]*)\n```$/);
  try {
    return { ok: true, value: JSON.parse(fenced ? fenced[1]! : text) };
  } catch {
    return { ok: false };
  }
}

function okResult(output: unknown, model: unknown, inputTokens: unknown, outputTokens: unknown): AIProviderResult {
  const usage = typeof inputTokens === "number" && typeof outputTokens === "number"
    ? { inputTokens, outputTokens }
    : undefined;
  return { status: "ok", output, model: typeof model === "string" ? model : "unknown", ...(usage ? { usage } : {}) };
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
        const parsed = parseJsonText(content.text);
        if (!parsed.ok) return { status: "error", code: "AI_OUTPUT_INVALID" };
        const usage = isObject(body.usage) ? body.usage : {};
        return okResult(parsed.value, body.model, usage.input_tokens, usage.output_tokens);
      }
    }
  }
  return { status: "error", code: "AI_OUTPUT_INVALID" };
}

/** Extracts the structured output from a Chat Completions body without echoing it anywhere. */
export function readChatCompletionOutput(body: unknown): AIProviderResult {
  if (!isObject(body) || !Array.isArray(body.choices)) return { status: "error", code: "AI_OUTPUT_INVALID" };
  const choice = body.choices[0];
  if (!isObject(choice) || !isObject(choice.message)) return { status: "error", code: "AI_OUTPUT_INVALID" };
  if (choice.finish_reason === "content_filter") return { status: "error", code: "AI_REFUSED" };
  if (typeof choice.message.refusal === "string" && choice.message.refusal.trim() !== "") {
    return { status: "error", code: "AI_REFUSED" };
  }
  if (choice.finish_reason === "length") return { status: "error", code: "AI_OUTPUT_INVALID" };
  if (typeof choice.message.content !== "string") return { status: "error", code: "AI_OUTPUT_INVALID" };
  const parsed = parseJsonText(choice.message.content);
  if (!parsed.ok) return { status: "error", code: "AI_OUTPUT_INVALID" };
  const usage = isObject(body.usage) ? body.usage : {};
  return okResult(parsed.value, body.model, usage.prompt_tokens, usage.completion_tokens);
}

function instructionsFor(mode: StructuredOutputMode): string {
  if (mode === "json_schema") return DETECT_INSTRUCTIONS;
  return `${DETECT_INSTRUCTIONS}\n\nRespond with exactly one JSON object and nothing else (no Markdown). `
    + `It must validate against this JSON Schema:\n${JSON.stringify(detectResultJsonSchema)}`;
}

/**
 * OpenAI and OpenAI-compatible adapter using fetch directly (no SDK). The base URL selects
 * the processor; the API key only ever appears in the Authorization header, and errors
 * carry stable codes, never response bodies or input text. store=false is sent where the
 * official OpenAI API defines it; other processors apply their own retention policy.
 */
export class OpenAIProvider implements AIProvider {
  readonly kind = "openai" as const;
  private readonly options: OpenAIProviderOptions;
  private readonly baseUrl: string;
  private readonly api: OpenAIApiStyle;
  private readonly structuredOutput: StructuredOutputMode;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAIProviderOptions) {
    this.options = options;
    this.baseUrl = (options.baseUrl ?? OPENAI_DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.api = options.api ?? "chat_completions";
    this.structuredOutput = options.structuredOutput ?? "json_schema";
    this.fetchImpl = options.fetch ?? fetch;
  }

  private get isOfficialOpenAI(): boolean {
    try {
      return new URL(this.baseUrl).hostname === "api.openai.com";
    } catch {
      return false;
    }
  }

  get endpoint(): string {
    return `${this.baseUrl}/${this.api === "responses" ? "responses" : "chat/completions"}`;
  }

  requestBody(input: DetectInput): JsonObject {
    const instructions = instructionsFor(this.structuredOutput);
    const userContent = JSON.stringify(input);
    if (this.api === "responses") {
      return {
        model: this.options.model,
        instructions,
        input: userContent,
        reasoning: { effort: this.options.reasoningEffort ?? "low" },
        text: {
          format: this.structuredOutput === "json_schema"
            ? { type: "json_schema", name: "detect_v1", strict: true, schema: detectResultJsonSchema }
            : { type: "json_object" },
        },
        store: false,
        max_output_tokens: MAX_OUTPUT_TOKENS,
      };
    }
    return {
      model: this.options.model,
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: userContent },
      ],
      response_format: this.structuredOutput === "json_schema"
        ? { type: "json_schema", json_schema: { name: "detect_v1", strict: true, schema: detectResultJsonSchema } }
        : { type: "json_object" },
      max_completion_tokens: MAX_OUTPUT_TOKENS,
      ...(this.isOfficialOpenAI ? { store: false } : {}),
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
    return this.api === "responses" ? readResponsesOutput(body) : readChatCompletionOutput(body);
  }
}
