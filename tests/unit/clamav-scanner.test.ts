import { createServer, type Server } from "node:net";

import { describe, expect, it } from "vitest";

import { createClamAVScanner } from "../../src/server/storage/clamav-scanner.ts";

type ClamdFixture = {
  port: number;
  close(): Promise<void>;
  requests: Buffer[];
};

async function startClamdFixture(reply: Buffer | null): Promise<ClamdFixture> {
  const requests: Buffer[] = [];
  const server: Server = createServer((socket) => {
    const chunks: Buffer[] = [];
    socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    socket.on("end", () => {
      requests.push(Buffer.concat(chunks));
      if (reply) socket.end(reply);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("FIXTURE_LISTEN_FAILED");

  return {
    port: address.port,
    requests,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

function decodeInstreamFrame(wire: Buffer): Buffer {
  const commandEnd = wire.indexOf(0);
  expect(wire.subarray(0, commandEnd).toString("ascii")).toBe("zINSTREAM");
  let offset = commandEnd + 1;
  const chunks: Buffer[] = [];
  while (offset + 4 <= wire.length) {
    const length = wire.readUInt32BE(offset);
    offset += 4;
    if (length === 0) {
      expect(offset).toBe(wire.length);
      return Buffer.concat(chunks);
    }
    expect(length).toBeLessThanOrEqual(64 * 1024);
    expect(offset + length).toBeLessThanOrEqual(wire.length);
    chunks.push(wire.subarray(offset, offset + length));
    offset += length;
  }
  throw new Error("INSTREAM_TERMINATOR_MISSING");
}

describe("ClamAV INSTREAM scanner", () => {
  it("streams bounded chunks over TCP and accepts only an explicit clean reply", async () => {
    const fixture = await startClamdFixture(Buffer.from("stream: OK\0", "ascii"));
    try {
      const bytes = Buffer.alloc(64 * 1024 + 7, 0xa5);
      const scanner = createClamAVScanner({ host: "127.0.0.1", port: fixture.port });

      await expect(scanner.scan({ bytes, contentType: "application/pdf" })).resolves.toEqual({ status: "clean" });
      expect(fixture.requests).toHaveLength(1);
      expect(decodeInstreamFrame(fixture.requests[0]!)).toEqual(bytes);
    } finally {
      await fixture.close();
    }
  });

  it("returns infected for FOUND and failed for daemon errors or unknown replies", async () => {
    const infected = await startClamdFixture(Buffer.from("stream: Eicar-Signature FOUND\0", "ascii"));
    const error = await startClamdFixture(Buffer.from("stream: Access denied ERROR\0", "ascii"));
    const unknown = await startClamdFixture(Buffer.from("unexpected reply\0", "ascii"));
    try {
      const bytes = new Uint8Array([1, 2, 3]);
      await expect(createClamAVScanner({ host: "127.0.0.1", port: infected.port }).scan({ bytes, contentType: "image/png" }))
        .resolves.toEqual({ status: "infected", errorCode: "MALWARE_DETECTED" });
      await expect(createClamAVScanner({ host: "127.0.0.1", port: error.port }).scan({ bytes, contentType: "image/png" }))
        .resolves.toEqual({ status: "failed", errorCode: "SCANNER_FAILED" });
      await expect(createClamAVScanner({ host: "127.0.0.1", port: unknown.port }).scan({ bytes, contentType: "image/png" }))
        .resolves.toEqual({ status: "failed", errorCode: "SCANNER_FAILED" });
    } finally {
      await Promise.all([infected.close(), error.close(), unknown.close()]);
    }
  });

  it("fails closed on missing daemon, timeout, oversized input, and invalid scanner configuration", async () => {
    const stopped = await startClamdFixture(null);
    await stopped.close();

    const quiet = await startClamdFixture(null);
    try {
      const tooLarge = new Uint8Array(10 * 1024 * 1024 + 1);
      await expect(createClamAVScanner({ host: "127.0.0.1", port: stopped.port }).scan({
        bytes: new Uint8Array([1]), contentType: "application/pdf",
      })).resolves.toEqual({ status: "unavailable", errorCode: "SCANNER_UNAVAILABLE" });
      await expect(createClamAVScanner({ host: "127.0.0.1", port: quiet.port, timeoutMs: 100 }).scan({
        bytes: new Uint8Array([1]), contentType: "application/pdf",
      })).resolves.toEqual({ status: "unavailable", errorCode: "SCANNER_UNAVAILABLE" });
      await expect(createClamAVScanner({ host: "127.0.0.1", port: quiet.port }).scan({
        bytes: tooLarge, contentType: "application/pdf",
      })).resolves.toEqual({ status: "failed", errorCode: "SCANNER_FAILED" });
      await expect(createClamAVScanner({ host: "", port: 0 }).scan({
        bytes: new Uint8Array([1]), contentType: "application/pdf",
      })).resolves.toEqual({ status: "unavailable", errorCode: "SCANNER_UNAVAILABLE" });
    } finally {
      await quiet.close();
    }
  });
});
