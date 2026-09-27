import { ExplicitTestFakeAIProvider, FAKE_AI_SCENARIOS, type FakeAIScenario } from "./fake-provider.ts";
import { OPENAI_DEFAULT_BASE_URL, OpenAIProvider } from "./openai-provider.ts";
import { type AIProvider, UnavailableAIProvider } from "./provider.ts";

export type AIProviderMode = "unavailable" | "openai" | "fake";

export interface AIProviderOptions {
  mode?: string;
  nodeEnv?: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
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

/**
 * Resolve the AI adapter from worker configuration. Default is unavailable. The fake
 * adapter is refused outside development/test; an incomplete OpenAI configuration
 * fails closed with AI_CONFIG_INVALID instead of throwing or sending anything.
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

  if (mode === "openai") {
    const apiKey = (options.apiKey ?? process.env.WORKPULSE_OPENAI_API_KEY ?? "").trim();
    const model = (options.model ?? process.env.WORKPULSE_AI_MODEL ?? "").trim();
    const baseUrl = (options.baseUrl ?? process.env.WORKPULSE_OPENAI_BASE_URL ?? OPENAI_DEFAULT_BASE_URL).trim();
    if (!apiKey || !model || !isAllowedBaseUrl(baseUrl)) return new UnavailableAIProvider("AI_CONFIG_INVALID");
    return new OpenAIProvider({ apiKey, model, baseUrl, fetch: options.fetch });
  }

  return new UnavailableAIProvider("AI_UNAVAILABLE");
}
