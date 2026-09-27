import { describe, expect, it, vi } from "vitest";

import { buildDetectInput } from "@/domain/ai/minimize";
import { OpenAIProvider, type OpenAIProviderOptions } from "@/server/ai/openai-provider";

const KEY = "sk-test-WP-SENTINEL-KEY";
const input = buildDetectInput({ raw_text: "WP-PRIVATE-SENTINEL led 3 reports", role: null, scope: null, outcome: null, locale: "en" });
const output = { schema_version: "detect.v1", potential: false, suggestion: null, questions: [] };
const signal = () => new AbortController().signal;

function responsesBody(content: unknown[]) {
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

function chatBody(message: Record<string, unknown>, finishReason = "stop") {
  return {
    id: "chatcmpl_1",
    model: "gpt-6-luna",
    choices: [{ index: 0, finish_reason: finishReason, message: { role: "assistant", ...message } }],
    usage: { prompt_tokens: 90, completion_tokens: 30 },
  };
}

function providerWith(response: Response | Error, options: Partial<OpenAIProviderOptions> = {}) {
  const fetchMock = vi.fn<typeof fetch>(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  const provider = new OpenAIProvider({
    apiKey: KEY,
    model: "gpt-6-luna",
    baseUrl: "https://compatible.example.test/v1",
    fetch: fetchMock,
    ...options,
  });
  return { provider, fetchMock };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("OpenAI-compatible Chat Completions adapter (default)", () => {
  it("sends a strict json_schema chat request with the key only in the header", async () => {
    const { provider, fetchMock } = providerWith(json(chatBody({ content: JSON.stringify(output) })));

    const result = await provider.detect(input, signal());

    expect(result).toEqual({ status: "ok", output, model: "gpt-6-luna", usage: { inputTokens: 90, outputTokens: 30 } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://compatible.example.test/v1/chat/completions");
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      model: "gpt-6-luna",
      response_format: { type: "json_schema", json_schema: { name: "detect_v1", strict: true } },
      max_completion_tokens: 4000,
    });
    expect(body.messages.map((message: { role: string }) => message.role)).toEqual(["system", "user"]);
    expect(JSON.parse(body.messages[1].content)).toEqual(input);
    // store is an official-OpenAI parameter; compatible processors are not sent unknown fields.
    expect(body).not.toHaveProperty("store");
    expect(body).not.toHaveProperty("reasoning");
    expect(String(init?.body)).not.toContain(KEY);
  });

  it("sends store=false when the base URL is the official OpenAI API", async () => {
    const { provider, fetchMock } = providerWith(json(chatBody({ content: JSON.stringify(output) })), {
      baseUrl: "https://api.openai.com/v1",
    });
    await provider.detect(input, signal());
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)).store).toBe(false);
  });

  it("uses JSON mode with the schema in the system prompt when json_schema is unsupported", async () => {
    const fenced = "```json\n" + JSON.stringify(output) + "\n```";
    const { provider, fetchMock } = providerWith(json(chatBody({ content: fenced })), { structuredOutput: "json_object" });

    expect(await provider.detect(input, signal())).toMatchObject({ status: "ok", output });
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0].content).toContain("JSON Schema");
    expect(body.messages[0].content).toContain("\"schema_version\"");
  });

  it("maps chat refusals, filtering, truncation and broken JSON", async () => {
    expect(await providerWith(json(chatBody({ content: null, refusal: "no" }))).provider.detect(input, signal()))
      .toEqual({ status: "error", code: "AI_REFUSED" });
    expect(await providerWith(json(chatBody({ content: "" }, "content_filter"))).provider.detect(input, signal()))
      .toEqual({ status: "error", code: "AI_REFUSED" });
    expect(await providerWith(json(chatBody({ content: "{\"schema" }, "length"))).provider.detect(input, signal()))
      .toEqual({ status: "error", code: "AI_OUTPUT_INVALID" });
    expect(await providerWith(json(chatBody({ content: "Sure! Here it is: {" }))).provider.detect(input, signal()))
      .toEqual({ status: "error", code: "AI_OUTPUT_INVALID" });
    expect(await providerWith(json({ choices: [] })).provider.detect(input, signal()))
      .toEqual({ status: "error", code: "AI_OUTPUT_INVALID" });
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
    const result = await provider.detect(input, signal());
    expect(result).toEqual({ status: "error", code });
    expect(JSON.stringify(result)).not.toMatch(/SENTINEL/);
  });

  it("maps network failures and aborts", async () => {
    expect(await providerWith(new TypeError("fetch failed WP-PRIVATE-SENTINEL")).provider.detect(input, signal()))
      .toEqual({ status: "error", code: "AI_PROVIDER_UNAVAILABLE" });
    const timeout = new DOMException("timed out", "TimeoutError");
    expect(await providerWith(timeout).provider.detect(input, signal()))
      .toEqual({ status: "error", code: "AI_PROVIDER_TIMEOUT" });
  });
});

describe("OpenAI Responses adapter (api=responses)", () => {
  const responses = { api: "responses" as const };

  it("sends a strict structured-output request with store=false", async () => {
    const { provider, fetchMock } = providerWith(json(responsesBody([{ type: "output_text", text: JSON.stringify(output) }])), responses);

    const result = await provider.detect(input, signal());

    expect(result).toEqual({ status: "ok", output, model: "gpt-6-luna", usage: { inputTokens: 120, outputTokens: 40 } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://compatible.example.test/v1/responses");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      model: "gpt-6-luna",
      store: false,
      reasoning: { effort: "low" },
      text: { format: { type: "json_schema", name: "detect_v1", strict: true } },
    });
    expect(JSON.parse(body.input)).toEqual(input);
  });

  it("maps refusals, incomplete responses and broken JSON", async () => {
    expect(await providerWith(json(responsesBody([{ type: "refusal", refusal: "no" }])), responses).provider.detect(input, signal()))
      .toEqual({ status: "error", code: "AI_REFUSED" });
    expect(await providerWith(json({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] }), responses)
      .provider.detect(input, signal())).toEqual({ status: "error", code: "AI_OUTPUT_INVALID" });
    expect(await providerWith(json(responsesBody([{ type: "output_text", text: "{not json" }])), responses).provider.detect(input, signal()))
      .toEqual({ status: "error", code: "AI_OUTPUT_INVALID" });
    expect(await providerWith(new Response("<html>", { status: 200 }), responses).provider.detect(input, signal()))
      .toEqual({ status: "error", code: "AI_OUTPUT_INVALID" });
    expect(await providerWith(json({ status: "failed", output: [] }), responses).provider.detect(input, signal()))
      .toEqual({ status: "error", code: "AI_PROVIDER_UNAVAILABLE" });
  });
});
