import { describe, expect, it } from "vitest";

import { buildDetectInput } from "@/domain/ai/minimize";
import { resolveAIProvider } from "@/server/ai/resolve-provider";

const input = buildDetectInput({ raw_text: "Did 3 things", role: null, scope: null, outcome: null, locale: "en" });
const signal = () => new AbortController().signal;

describe("AI provider resolution", () => {
  it("defaults to unavailable", async () => {
    const provider = resolveAIProvider({ mode: "unavailable", nodeEnv: "production" });
    expect(provider.kind).toBe("unavailable");
    expect(await provider.detect(input, signal())).toEqual({ status: "error", code: "AI_UNAVAILABLE" });
  });

  it("treats an unknown mode as unavailable", async () => {
    expect(resolveAIProvider({ mode: "magic", nodeEnv: "production" }).kind).toBe("unavailable");
  });

  it("allows the explicit fake only in development or tests", () => {
    expect(resolveAIProvider({ mode: "fake", nodeEnv: "test" }).kind).toBe("fake");
    expect(resolveAIProvider({ mode: "fake", nodeEnv: "development" }).kind).toBe("fake");
    expect(() => resolveAIProvider({ mode: "fake", nodeEnv: "production" })).toThrow("FAKE_AI_NOT_ALLOWED_IN_PRODUCTION");
    expect(() => resolveAIProvider({ mode: "fake", nodeEnv: "staging" })).toThrow("FAKE_AI_NOT_ALLOWED_IN_PRODUCTION");
  });

  it("fails closed when OpenAI configuration is incomplete or unsafe", async () => {
    for (const options of [
      { apiKey: "", model: "gpt-6-luna" },
      { apiKey: "sk-test", model: "" },
      { apiKey: "sk-test", model: "gpt-6-luna", baseUrl: "http://api.example.com/v1" },
      { apiKey: "sk-test", model: "gpt-6-luna", baseUrl: "https://user:pass@api.openai.com/v1" },
      { apiKey: "sk-test", model: "gpt-6-luna", baseUrl: "not a url" },
    ]) {
      const provider = resolveAIProvider({ mode: "openai", nodeEnv: "production", ...options });
      expect(provider.kind).toBe("unavailable");
      expect(await provider.detect(input, signal())).toEqual({ status: "error", code: "AI_CONFIG_INVALID" });
    }
  });

  it("builds the OpenAI adapter for https or a localhost stub", () => {
    expect(resolveAIProvider({ mode: "openai", nodeEnv: "production", apiKey: "sk-test", model: "gpt-6-luna" }).kind).toBe("openai");
    expect(resolveAIProvider({ mode: "openai", nodeEnv: "test", apiKey: "sk-test", model: "gpt-6-luna", baseUrl: "http://127.0.0.1:4010/v1" }).kind)
      .toBe("openai");
  });
});
