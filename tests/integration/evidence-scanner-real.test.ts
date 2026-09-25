import { describe, expect, it } from "vitest";
import { createClamAVScanner } from "@/server/storage/clamav-scanner";

/** Requires a real clamd, never the development fake. Harmless EICAR fixture stays in memory. */
describe("T10 real ClamAV INSTREAM", () => {
  const scanner = createClamAVScanner({
    host: process.env.WORKPULSE_CLAMD_HOST ?? "127.0.0.1",
    port: Number(process.env.WORKPULSE_CLAMD_PORT ?? "13310"),
    timeoutMs: 15_000,
  });

  it("accepts clean document bytes and detects the standard harmless EICAR test signature", async () => {
    const clean = Buffer.from("%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n");
    expect(await scanner.scan({ bytes: clean, contentType: "application/pdf" })).toEqual({ status: "clean" });
    const testSignature = ["X5O!P%@AP[4\\PZX54(P^)7CC)7}$", "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"].join("");
    expect(await scanner.scan({ bytes: Buffer.from(testSignature), contentType: "application/pdf" })).toEqual({ status: "infected", errorCode: "MALWARE_DETECTED" });
  });

  it("never accepts an unavailable scanner as clean", async () => {
    const offline = createClamAVScanner({ host: "127.0.0.1", port: 1, timeoutMs: 200 });
    expect(await offline.scan({ bytes: Buffer.from("%PDF-1.7\n%%EOF\n"), contentType: "application/pdf" })).toEqual({ status: "unavailable", errorCode: "SCANNER_UNAVAILABLE" });
  });
});
