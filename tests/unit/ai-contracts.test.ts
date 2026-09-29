import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ACHIEVEMENT_FIELD_LIMITS } from "@/domain/achievement/contracts";
import {
  AI_CONSENT_VERSION, AI_ERROR_CODES, AI_JOB_KINDS, AI_LEASE_SECONDS, AI_MAX_ATTEMPTS,
  AI_PROVIDER_TIMEOUT_MS, AI_REVIEW_ERROR_CODES,
} from "@/domain/ai/contracts";
import { DETECT_LIMITS } from "@/domain/ai/detect-result";

const migration = readFileSync("supabase/migrations/20260928090000_t13_ai_jobs_consent.sql", "utf8");
const reviewMigration = readFileSync("supabase/migrations/20260929090000_t14_ai_review.sql", "utf8");

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

  it("keeps job kinds identical to the SQL check constraint", () => {
    expect(AI_JOB_KINDS).toEqual(["detect", "refine"]);
    expect(reviewMigration).toContain("check (kind in ('detect', 'refine'))");
  });

  it("keeps review error codes disjoint from worker error codes and correctly formed", () => {
    const errorCodePattern = /^[A-Z][A-Z0-9_]{0,63}$/;
    for (const code of AI_REVIEW_ERROR_CODES) {
      expect(code).toMatch(errorCodePattern);
      expect(AI_ERROR_CODES as readonly string[]).not.toContain(code);
    }
    for (const code of ["AI_SUGGESTION_DISMISSED", "AI_SUGGESTION_APPLIED", "AI_QUESTIONS_CLOSED", "DRAFT_EDITED", "ACHIEVEMENT_CONFIRMED", "ACHIEVEMENT_DISMISSED"]) {
      expect(reviewMigration).toContain(code);
    }
  });
});
