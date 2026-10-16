import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DEFAULT_THRESHOLDS, METRIC_NAMES } from "../../workers/ops-check.ts";

// T25 plan sections 1.16 and 3.4: the release runbook lists exactly the variables of .env.example, with the alert
// thresholds the check really uses, and the checklist keeps the production blockers open until they are proven.

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

const RUNBOOK = "docs/verification/T25-release-runbook.md";
const CHECKLIST = "docs/verification/T25-release-checklist.md";

function envNames(): string[] {
  const names = new Set<string>();
  for (const line of read(".env.example").split(/\r?\n/)) {
    const match = line.match(/^\s*#?\s*([A-Z][A-Z0-9_]*)=/);
    if (match) names.add(match[1]!);
  }
  return [...names].sort();
}

/** Rows of the environment table in the runbook: `| \`NAME\` | process | kind | default | … |`. */
function runbookRows(): { name: string; cells: string[] }[] {
  const section = read(RUNBOOK).split(/^## /m).find((part) => part.startsWith("2. Variabel lingkungan"));
  if (!section) throw new Error("the runbook has no section '2. Variabel lingkungan'");
  const rows: { name: string; cells: string[] }[] = [];
  for (const line of section.split(/\r?\n/)) {
    const match = line.match(/^\|\s*`([A-Z][A-Z0-9_]*)`\s*\|(.*)\|\s*$/);
    if (match) rows.push({ name: match[1]!, cells: match[2]!.split("|").map((cell) => cell.trim()) });
  }
  return rows;
}

describe("T25 release documents", () => {
  it("exist", () => {
    expect(existsSync(new URL(RUNBOOK, root)), RUNBOOK).toBe(true);
    expect(existsSync(new URL(CHECKLIST, root)), CHECKLIST).toBe(true);
  });

  it("list in the runbook exactly the variables of .env.example, once each", () => {
    const names = runbookRows().map((row) => row.name);
    expect(new Set(names).size, "a variable is listed twice").toBe(names.length);
    expect(names.slice().sort()).toEqual(envNames());
  });

  it("say for every variable which process reads it, whether it is secret, and its default", () => {
    for (const row of runbookRows()) {
      expect(row.cells.length, `${row.name}: columns`).toBeGreaterThanOrEqual(4);
      expect(row.cells[0], `${row.name}: process`).toMatch(/^(web|worker|web dan worker|ops|tes)/);
      expect(row.cells[1], `${row.name}: kind`).toMatch(/^(publik|rahasia|konfigurasi)/);
      expect(row.cells[2], `${row.name}: default`).not.toBe("");
    }
  });

  it("states the default threshold the check uses for each alert variable", () => {
    const rows = runbookRows();
    const variableOf: Record<string, string> = {
      account_deletion_overdue: "WORKPULSE_ALERT_DELETION_OVERDUE", storage_cleanup_failed: "WORKPULSE_ALERT_CLEANUP_FAILED",
      storage_cleanup_overdue: "WORKPULSE_ALERT_CLEANUP_OVERDUE", import_purge_overdue: "WORKPULSE_ALERT_IMPORT_PURGE_OVERDUE",
      export_purge_overdue: "WORKPULSE_ALERT_EXPORT_PURGE_OVERDUE", evidence_stuck: "WORKPULSE_ALERT_EVIDENCE_STUCK",
      jobs_failed_24h: "WORKPULSE_ALERT_JOBS_FAILED_24H", jobs_expired_lease: "WORKPULSE_ALERT_JOBS_EXPIRED_LEASE",
    };
    for (const metric of METRIC_NAMES) {
      const row = rows.find((entry) => entry.name === variableOf[metric]);
      expect(row, `${metric}: variable row`).toBeDefined();
      expect(row!.cells[2], `${metric}: default`).toBe(String(DEFAULT_THRESHOLDS[metric]));
    }
  });

  it("describes every metric of ops:check with its action", () => {
    const text = read(RUNBOOK);
    for (const metric of METRIC_NAMES) expect(text, metric).toContain(`\`${metric}\``);
  });

  it("covers deploy order, rollback by forward fix, restore without a ledger, and the privacy incident", () => {
    const text = read(RUNBOOK);
    for (const heading of ["## 1. Topologi", "## 3. Deploy", "## 4. Worker", "## 5. Pemeriksaan kesehatan", "## 6. Rollback", "## 7. Backup dan restore", "## 8. Insiden privasi"]) {
      expect(text, heading).toContain(heading);
    }
    expect(text).toMatch(/migrate.*worker.*web/is);
    expect(text).toMatch(/forward fix|perbaikan maju/i);
    expect(text).not.toMatch(/db reset/i);
    expect(text).not.toMatch(/sb_secret_[A-Za-z0-9]|eyJ[A-Za-z0-9_-]{10}/);
  });

  it("keeps the production blockers open in the checklist until they are proven", () => {
    const rows = read(CHECKLIST).split(/\r?\n/).filter((line) => /\bBLOCKER\b/.test(line));
    const joined = rows.join("\n").toLowerCase();
    for (const topic of ["staging", "retensi backup", "otorisasi deploy", "domain", "smtp", "scanner", "renderer", "ai"]) {
      expect(joined, `BLOCKER about ${topic}`).toContain(topic);
    }
    for (const row of rows) expect(row, "a blocker is never ticked without a receipt").not.toMatch(/\[x\]/i);
  });
});
