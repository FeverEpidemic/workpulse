import { describe, expect, it, vi } from "vitest";

import { buildDetectInput } from "@/domain/ai/minimize";
import { OpenAIProvider } from "@/server/ai/openai-provider";

const KEY = "sk-test-WP-SENTINEL-KEY";
const input = buildDetectInput({ raw_text: "WP-PRIVATE-SENTINEL led 3 reports", role: null, scope: null, outcome: null, locale: "en" });
const output = { schema_version: "detect.v1", potential: false, suggestion: null, questions: [] };

function completed(content: unknown[]) {
  return {
    id: "resp_1",
    status: "completed",
    model: "gpt-6-luna",
    output: [
      { type: "reasoning", summary: [] },
      { type: "message", role: "assistant", content },
    ],
    usage: { input_tokens: 120, output_tokens: 40 },
  };
}

function providerWith(response: Response | Error) {
  const fetchMock = vi.fn<typeof fetch>(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  const provider = new OpenAIProvider({ apiKey: KEY, model: "gpt-6-luna", baseUrl: "http://127.0.0.1:9/v1", fetch: fetchMock });
  return { provider, fetchMock };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("OpenAI Responses adapter", () => {
  it("sends a strict structured-output request with store=false and the key only in the header", async () => {
    const { provider, fetchMock } = providerWith(json(completed([{ type: "output_text", text: JSON.stringify(output) }])));

    const result = await provider.detect(input, new AbortController().signal);

    expect(result).toEqual({ status: "ok", output, model: "gpt-6-luna", usage: { inputTokens: 120, outputTokens: 40 } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:9/v1/responses");
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      model: "gpt-6-luna",
      store: false,
      reasoning: { effort: "low" },
      text: { format: { type: "json_schema", name: "detect_v1", strict: true } },
    });
    expect(JSON.parse(body.input)).toEqual(input);
    expect(String(init?.body)).not.toContain(KEY);
  });

  it.each([
    [401, "AI_CONFIG_INVALID"],
    [403, "AI_CONFIG_INVALID"],
    [400, "AI_CONFIG_INVALID"],
    [404, "AI_CONFIG_INVALID"],
    [429, "AI_RATE_LIMITED"],
    [500, "AI_PROVIDER_UNAVAILABLE"],
    [503, "AI_PROVIDER_UNAVAILABLE"],
  ])("maps HTTP %i to %s without the body", async (status, code) => {
    const { provider } = providerWith(json({ error: { message: `leak ${KEY} WP-PRIVATE-SENTINEL` } }, status));
    const result = await provider.detect(input, new AbortController().signal);
    expect(result).toEqual({ status: "error", code });
    expect(JSON.stringify(result)).not.toMatch(/SENTINEL/);
  });

  it("maps network failures and aborts", async () => {
    expect(await providerWith(new TypeError("fetch failed WP-PRIVATE-SENTINEL")).provider.detect(input, new AbortController().signal))
      .toEqual({ status: "error", code: "AI_PROVIDER_UNAVAILABLE" });
    const timeout = new DOMException("timed out", "TimeoutError");
    expect(await providerWith(timeout).provider.detect(input, new AbortController().signal))
      .toEqual({ status: "error", code: "AI_PROVIDER_TIMEOUT" });
  });

  it("maps refusals, incomplete responses and broken JSON", async () => {
    expect(await providerWith(json(completed([{ type: "refusal", refusal: "no" }]))).provider.detect(input, new AbortController().signal))
      .toEqual({ status: "error", code: "AI_REFUSED" });
    expect(await providerWith(json({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] }))
      .provider.detect(input, new AbortController().signal)).toEqual({ status: "error", code: "AI_OUTPUT_INVALID" });
    expect(await providerWith(json(completed([{ type: "output_text", text: "{not json" }]))).provider.detect(input, new AbortController().signal))
      .toEqual({ status: "error", code: "AI_OUTPUT_INVALID" });
    expect(await providerWith(new Response("<html>", { status: 200 })).provider.detect(input, new AbortController().signal))
      .toEqual({ status: "error", code: "AI_OUTPUT_INVALID" });
    expect(await providerWith(json({ status: "failed", output: [] })).provider.detect(input, new AbortController().signal))
      .toEqual({ status: "error", code: "AI_PROVIDER_UNAVAILABLE" });
  });
});
