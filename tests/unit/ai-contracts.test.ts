import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ACHIEVEMENT_FIELD_LIMITS } from "@/domain/achievement/contracts";
import { AI_CONSENT_VERSION, AI_LEASE_SECONDS, AI_MAX_ATTEMPTS, AI_PROVIDER_TIMEOUT_MS } from "@/domain/ai/contracts";
import { DETECT_LIMITS } from "@/domain/ai/detect-result";

const migration = readFileSync("supabase/migrations/20260928090000_t13_ai_jobs_consent.sql", "utf8");

describe("AI contracts", () => {
  it("keeps the consent version identical to the single SQL source", () => {
    const match = migration.match(/current_ai_consent_version\(\)[\s\S]*?select '([^']+)'::text;/);
    expect(match?.[1]).toBe(AI_CONSENT_VERSION);
  });

  it("matches the database lease and attempt limits", () => {
    expect(AI_MAX_ATTEMPTS).toBe(3);
    expect(migration).toContain("attempt_count between 0 and 3");
    expect(AI_LEASE_SECONDS).toBe(120);
    expect(migration).toContain("interval '120 seconds'");
    expect(AI_PROVIDER_TIMEOUT_MS).toBeLessThan(AI_LEASE_SECONDS * 1000);
  });

  it("keeps detect suggestion limits inside the Achievement draft limits", () => {
    expect(DETECT_LIMITS.title).toBeLessThanOrEqual(ACHIEVEMENT_FIELD_LIMITS.title);
    expect(DETECT_LIMITS.contribution).toBeLessThanOrEqual(ACHIEVEMENT_FIELD_LIMITS.contribution);
    expect(DETECT_LIMITS.outcome).toBeLessThanOrEqual(ACHIEVEMENT_FIELD_LIMITS.outcome);
    expect(DETECT_LIMITS.scope).toBeLessThanOrEqual(ACHIEVEMENT_FIELD_LIMITS.scope);
    expect(DETECT_LIMITS.cvBullet).toBeLessThanOrEqual(ACHIEVEMENT_FIELD_LIMITS.cvBullet);
    expect(DETECT_LIMITS.metricLabel).toBeLessThanOrEqual(ACHIEVEMENT_FIELD_LIMITS.metricLabel);
    expect(DETECT_LIMITS.metricUnit).toBeLessThanOrEqual(ACHIEVEMENT_FIELD_LIMITS.metricUnit);
    expect(DETECT_LIMITS.metrics).toBeLessThanOrEqual(ACHIEVEMENT_FIELD_LIMITS.metrics);
    expect(DETECT_LIMITS.skills).toBeLessThanOrEqual(ACHIEVEMENT_FIELD_LIMITS.skills);
  });
});
