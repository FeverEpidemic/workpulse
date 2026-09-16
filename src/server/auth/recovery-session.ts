const RECOVERY_WINDOW_SECONDS = 15 * 60;
const CLOCK_SKEW_SECONDS = 60;

function hasRecentMethod(amr: unknown, methods: readonly string[], nowSeconds: number): boolean {
  if (!Array.isArray(amr)) return false;

  return amr.some((entry: unknown) => {
    if (!entry || typeof entry !== "object") return false;
    const method = "method" in entry ? entry.method : undefined;
    const timestamp = "timestamp" in entry ? entry.timestamp : undefined;
    if (typeof method !== "string" || !methods.includes(method) || typeof timestamp !== "number" || !Number.isFinite(timestamp)) return false;

    const ageSeconds = nowSeconds - timestamp;
    return ageSeconds >= -CLOCK_SKEW_SECONDS && ageSeconds <= RECOVERY_WINDOW_SECONDS;
  });
}

/** Recovery proof used by PKCE callbacks when Auth marks the method as recovery. */
export function hasRecentRecoveryMethod(amr: unknown, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  return hasRecentMethod(amr, ["recovery"], nowSeconds);
}

/**
 * Token-hash recovery uses verifyOtp(type=recovery), which Auth records as `otp`
 * in the local stack. Callers must also require the server-issued recovery-flow cookie.
 */
export function hasRecentRecoveryProof(amr: unknown, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  return hasRecentMethod(amr, ["recovery", "otp"], nowSeconds);
}
