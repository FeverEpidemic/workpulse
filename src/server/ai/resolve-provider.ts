import { ExplicitTestFakeAIProvider, FAKE_AI_SCENARIOS, type FakeAIScenario } from "./fake-provider.ts";
import {
  OPENAI_API_STYLES,
  OPENAI_DEFAULT_BASE_URL,
  OpenAIProvider,
  STRUCTURED_OUTPUT_MODES,
  type OpenAIApiStyle,
  type StructuredOutputMode,
} from "./openai-provider.ts";
import { type AIProvider, UnavailableAIProvider } from "./provider.ts";

/** `openai-compatible` and `openai` select the same adapter; the base URL chooses the processor. */
export type AIProviderMode = "unavailable" | "openai" | "openai-compatible" | "fake";

export interface AIProviderOptions {
  mode?: string;
  nodeEnv?: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  api?: string;
  structuredOutput?: string;
  fakeScenario?: string;
  fetch?: typeof fetch;
}

function isAllowedBaseUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password || url.search || url.hash) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
}

function pick<T extends string>(value: string, allowed: readonly T[]): T | null {
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/**
 * Resolve the AI adapter from worker configuration. Default is unavailable. The fake
 * adapter is refused outside development/test; an incomplete or unknown OpenAI-compatible
 * configuration fails closed with AI_CONFIG_INVALID instead of throwing or sending anything.
 */
export function resolveAIProvider(options: AIProviderOptions = {}): AIProvider {
  const mode = options.mode ?? process.env.WORKPULSE_AI_MODE ?? "unavailable";
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;

  if (mode === "fake") {
    if (nodeEnv !== "development" && nodeEnv !== "test") {
      throw new Error("FAKE_AI_NOT_ALLOWED_IN_PRODUCTION");
    }
    const scenario = options.fakeScenario ?? process.env.WORKPULSE_AI_FAKE_SCENARIO ?? "valid";
    return new ExplicitTestFakeAIProvider(
      (FAKE_AI_SCENARIOS as readonly string[]).includes(scenario) ? (scenario as FakeAIScenario) : "valid",
    );
  }

  if (mode === "openai" || mode === "openai-compatible") {
    const apiKey = (options.apiKey ?? process.env.WORKPULSE_OPENAI_API_KEY ?? "").trim();
    const model = (options.model ?? process.env.WORKPULSE_AI_MODEL ?? "").trim();
    const baseUrl = (options.baseUrl ?? process.env.WORKPULSE_OPENAI_BASE_URL ?? OPENAI_DEFAULT_BASE_URL).trim();
    const api = pick<OpenAIApiStyle>((options.api ?? process.env.WORKPULSE_AI_API ?? "chat_completions").trim(), OPENAI_API_STYLES);
    const structuredOutput = pick<StructuredOutputMode>(
      (options.structuredOutput ?? process.env.WORKPULSE_AI_STRUCTURED_OUTPUT ?? "json_schema").trim(),
      STRUCTURED_OUTPUT_MODES,
    );
    if (!apiKey || !model || !isAllowedBaseUrl(baseUrl) || !api || !structuredOutput) {
      return new UnavailableAIProvider("AI_CONFIG_INVALID");
    }
    return new OpenAIProvider({ apiKey, model, baseUrl, api, structuredOutput, fetch: options.fetch });
  }

  return new UnavailableAIProvider("AI_UNAVAILABLE");
}
