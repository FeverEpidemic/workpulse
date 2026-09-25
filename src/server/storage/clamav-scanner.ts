import { createConnection, type Socket } from "node:net";

import { MALWARE_SCAN_MAX_BYTES, type MalwareScanResult, type MalwareScanner } from "./malware-scanner.ts";
import type { PrivateStorageMimeType } from "./constants.ts";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 60_000;
const CHUNK_BYTES = 64 * 1024;
const MAX_REPLY_BYTES = 4 * 1024;

export interface ClamAVScannerOptions {
  host: string;
  port: number;
  timeoutMs?: number;
}

function unavailable(): MalwareScanResult {
  return { status: "unavailable", errorCode: "SCANNER_UNAVAILABLE" };
}

function failed(): MalwareScanResult {
  return { status: "failed", errorCode: "SCANNER_FAILED" };
}

function parseReply(reply: Buffer): MalwareScanResult {
  const record = reply.toString("utf8").replaceAll("\0", "").trim();
  if (!record) return failed();

  if (/\bFOUND\s*$/i.test(record)) {
    return { status: "infected", errorCode: "MALWARE_DETECTED" };
  }
  if (/(?:^|:\s*)OK\s*$/i.test(record)) return { status: "clean" };
  if (/\bERROR\s*$/i.test(record) || /\bERROR\s*:/i.test(record)) return failed();
  return failed();
}

function isValidOptions(options: ClamAVScannerOptions): boolean {
  return (
    typeof options.host === "string" &&
    options.host.trim().length > 0 &&
    options.host.length <= 253 &&
    Number.isInteger(options.port) &&
    options.port >= 1 &&
    options.port <= 65_535 &&
    (options.timeoutMs === undefined ||
      (Number.isInteger(options.timeoutMs) && options.timeoutMs >= 100 && options.timeoutMs <= MAX_TIMEOUT_MS))
  );
}

function write(socket: Socket, bytes: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      socket.write(bytes, (error) => (error ? reject(error) : resolve()));
    } catch (error) {
      reject(error);
    }
  });
}

async function sendStream(socket: Socket, bytes: Buffer): Promise<void> {
  await write(socket, Buffer.from("zINSTREAM\0", "ascii"));

  for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
    const end = Math.min(offset + CHUNK_BYTES, bytes.length);
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(end - offset, 0);
    await write(socket, length);
    await write(socket, bytes.subarray(offset, end));
  }

  await write(socket, Buffer.alloc(4));
  socket.end();
}

/**
 * A small clamd TCP client using the documented NUL-framed INSTREAM command. The
 * caller supplies the bytes already fetched from private storage; no path or filename
 * is sent to clamd. TCP should be restricted to a trusted private network because
 * clamd's protocol does not authenticate or encrypt clients.
 */
export function createClamAVScanner(options: ClamAVScannerOptions): MalwareScanner {
  if (!isValidOptions(options)) {
    return { async scan() { return unavailable(); } };
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async scan(input: { bytes: Uint8Array; contentType: PrivateStorageMimeType }): Promise<MalwareScanResult> {
      if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0 || input.bytes.byteLength > MALWARE_SCAN_MAX_BYTES) {
        return failed();
      }

      // Take a private snapshot so caller-side mutation cannot change bytes mid-stream.
      const bytes = Buffer.from(input.bytes);

      return new Promise((resolve) => {
        const socket = createConnection({ host: options.host, port: options.port });
        let settled = false;
        let reply = Buffer.alloc(0);

        const finish = (result: MalwareScanResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          socket.destroy();
          resolve(result);
        };

        const timer = setTimeout(() => finish(unavailable()), timeoutMs);
        socket.setNoDelay(true);
        socket.on("connect", () => {
          void sendStream(socket, bytes).catch(() => finish(unavailable()));
        });
        socket.on("data", (chunk: Buffer) => {
          if (reply.byteLength + chunk.byteLength > MAX_REPLY_BYTES) {
            finish(failed());
            return;
          }
          reply = Buffer.concat([reply, chunk]);
          if (reply.includes(0)) finish(parseReply(reply));
        });
        socket.on("end", () => {
          if (!settled) finish(reply.length > 0 ? parseReply(reply) : unavailable());
        });
        socket.on("close", () => {
          if (!settled) finish(reply.length > 0 ? parseReply(reply) : unavailable());
        });
        socket.on("error", () => finish(unavailable()));
      });
    },
  };
}
