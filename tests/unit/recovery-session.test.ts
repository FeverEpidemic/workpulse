import { describe, expect, it } from "vitest";

import { hasRecentRecoveryMethod, hasRecentRecoveryProof } from "@/server/auth/recovery-session";

describe("verified recovery session claims", () => {
  const now = 1_800_000_000;

  it("accepts a recent recovery method from the verified JWT", () => {
    expect(hasRecentRecoveryMethod([{ method: "recovery", timestamp: now - 30 }], now)).toBe(true);
  });

  it("accepts Supabase's recent OTP proof for a type=recovery callback", () => {
    expect(hasRecentRecoveryProof([{ method: "otp", timestamp: now - 30 }], now)).toBe(true);
    expect(hasRecentRecoveryMethod([{ method: "otp", timestamp: now - 30 }], now)).toBe(false);
  });

  it("rejects a normal password sign-in", () => {
    expect(hasRecentRecoveryMethod([{ method: "password", timestamp: now }], now)).toBe(false);
  });

  it("rejects expired, future, and timestamp-free recovery values", () => {
    expect(hasRecentRecoveryMethod([{ method: "recovery", timestamp: now - 901 }], now)).toBe(false);
    expect(hasRecentRecoveryMethod([{ method: "recovery", timestamp: now + 61 }], now)).toBe(false);
    expect(hasRecentRecoveryMethod(["recovery"], now)).toBe(false);
    expect(hasRecentRecoveryProof([{ method: "otp", timestamp: now - 901 }], now)).toBe(false);
    expect(hasRecentRecoveryProof([{ method: "password", timestamp: now }], now)).toBe(false);
  });
});
