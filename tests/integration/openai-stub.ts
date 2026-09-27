import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type OpenAIStubMode = "valid" | "rate_limited" | "refusal" | "slow" | "server_error_leaky";

export interface OpenAIStubRequest {
  path: string;
  authorization: string | undefined;
  body: Record<string, unknown>;
}

/** Local stand-in for POST /v1/responses so the real adapter runs without a network call. */
export interface OpenAIStub {
  baseUrl: string;
  requests: OpenAIStubRequest[];
  setMode(mode: OpenAIStubMode, leakText?: string): void;
  close(): Promise<void>;
}

const VALID_OUTPUT = {
  schema_version: "detect.v1",
  potential: false,
  suggestion: null,
  questions: [],
};

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

export async function startOpenAIStub(): Promise<OpenAIStub> {
  let mode: OpenAIStubMode = "valid";
  let leak = "";
  const requests: OpenAIStubRequest[] = [];
  const server: Server = createServer(async (request, response) => {
    const body = await readBody(request);
    requests.push({ path: request.url ?? "", authorization: request.headers.authorization, body });
    const send = (status: number, payload: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
    };
    switch (mode) {
      case "rate_limited":
        return send(429, { error: { message: `rate limited ${leak}` } });
      case "server_error_leaky":
        return send(500, { error: { message: `internal ${leak}` } });
      case "refusal":
        return send(200, {
          status: "completed",
          model: "stub-model",
          output: [{ type: "message", content: [{ type: "refusal", refusal: `no ${leak}` }] }],
        });
      case "slow":
        setTimeout(() => {
          if (!response.writableEnded) send(200, { status: "completed", model: "stub-model", output: [] });
        }, 2_000);
        return;
      default:
        return send(200, {
          status: "completed",
          model: "stub-model",
          output: [
            { type: "reasoning", summary: [] },
            { type: "message", content: [{ type: "output_text", text: JSON.stringify(VALID_OUTPUT) }] },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
        });
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    setMode(next, leakText = "") {
      mode = next;
      leak = leakText;
    },
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}
