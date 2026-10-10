import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAchievementService } from "@/features/achievement/achievement-service";
import { createActivityService } from "@/features/activity/activity-service";
import { createDashboardService } from "@/features/dashboard/dashboard-service";
import { createProjectService } from "@/features/project/project-service";
import { createTimelineService } from "@/features/timeline/timeline-service";

import {
  clientFromSession, ensureAccount, environmentInfo, removeAccount, setupHarness, signInClient, sql, writeResults,
  type Client, type Harness, type PerfAccount,
} from "./perf-support";
import { countDataset, datasetMatches, EXPECTED_DATASET, MIN_CV_ITEMS, seedDataset, type DatasetCounts } from "./seed";
import { percentileNearestRank, summarize } from "./stats";

const SAMPLES = Number(process.env.WORKPULSE_PERF_SAMPLES ?? 50);
const WARMUPS = 5;
const READ_TARGET_MS = 2000;
const SAVE_TARGET_MS = 1000;
const ORDER_SEED = 24;

interface Ctx {
  dashboard: ReturnType<typeof createDashboardService>;
  activities: ReturnType<typeof createActivityService>;
  achievements: ReturnType<typeof createAchievementService>;
  projects: ReturnType<typeof createProjectService>;
  timeline: ReturnType<typeof createTimelineService>;
}

const makeCtx = (client: Client): Ctx => ({
  dashboard: createDashboardService(client),
  activities: createActivityService(client),
  achievements: createAchievementService(client),
  projects: createProjectService(client),
  timeline: createTimelineService(client),
});

interface Operation {
  name: string;
  surface: string;
  kind: "read" | "write";
  targetMs: number;
  prepare?: (ctx: Ctx) => Promise<unknown>;
  run: (ctx: Ctx, prepared: unknown) => Promise<void>;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round1 = (value: number) => Math.round(value * 10) / 10;

let harness: Harness;
let p: PerfAccount;
let q: PerfAccount;
const accounts: PerfAccount[] = [];

describe("T24 performance: dataset and p95 of reads and saves", () => {
  beforeAll(async () => {
    harness = setupHarness();
    p = await ensureAccount(harness, "p");
    q = await ensureAccount(harness, "q");
    accounts.push(p, q);
  });

  afterAll(async () => {
    for (const account of accounts) await removeAccount(harness, account.id);
  });

  it("seeds accounts P and Q through the user RPCs with the volumes of plan section 6", () => {
    for (const account of accounts) {
      const result = seedDataset(account.id);
      expect(datasetMatches(result.counts), `${account.label} dataset`).toBe(true);
    }
    for (const account of accounts) {
      const counts = countDataset(account.id);
      for (const key of Object.keys(EXPECTED_DATASET) as (keyof typeof EXPECTED_DATASET)[]) {
        expect(counts[key], `${account.label}.${key}`).toBe(EXPECTED_DATASET[key]);
      }
      expect(counts.cv_items).toBeGreaterThanOrEqual(MIN_CV_ITEMS);
    }
  });

  it("does not duplicate data when the same account is seeded again", () => {
    for (const account of accounts) {
      const before = countDataset(account.id);
      const again = seedDataset(account.id);
      expect(again.seeded).toBe(false);
      expect(countDataset(account.id)).toEqual(before);
    }
  });

  it("measures p95 of the page reads and of the saves at the service layer", async () => {
    expect(SAMPLES).toBeGreaterThanOrEqual(50);
    const datasetBefore: DatasetCounts = countDataset(p.id);
    const datasetQ: DatasetCounts = countDataset(q.id);
    expect(datasetMatches(datasetBefore)).toBe(true);
    expect(datasetMatches(datasetQ)).toBe(true);
    const triggerCount = Number(sql("select count(1) from pg_trigger where tgname like 'product\\_event\\_%' and not tgisinternal;"));
    expect(triggerCount).toBe(10);

    const source = await signInClient(harness, p);
    const main = makeCtx(source);
    const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

    // Inputs for the filtered and cursor reads are taken from the data, not guessed.
    const projectId = sql(
      `select project_id from public.activities where user_id = '${p.id}'::uuid and project_id is not null ` +
      `group by project_id order by count(1) desc, project_id limit 1`,
    );
    const page1 = await main.activities.listActivities({});
    const page2 = await main.activities.listActivities({ cursor: page1.nextCursor! });
    const page3Cursor = page2.nextCursor!;
    const firstActivity = page1.items[0]!;
    const firstProject = (await main.projects.listProjects({})).items[0]!.project;
    const activityState = { revision: firstActivity.revision };
    const projectState = { revision: firstProject.revision };

    const read = (name: string, surface: string, run: (ctx: Ctx) => Promise<unknown>): Operation => ({
      name, surface, kind: "read", targetMs: READ_TARGET_MS, run: async (ctx) => { await run(ctx); },
    });
    const operations: Operation[] = [
      read("dashboard.getDashboard", "S04", (ctx) => ctx.dashboard.getDashboard()),
      read("activities.list first page", "S06", (ctx) => ctx.activities.listActivities({})),
      read("activities.list third page (cursor)", "S06", (ctx) => ctx.activities.listActivities({ cursor: page3Cursor })),
      read("activities.list project filter", "S06", (ctx) => ctx.activities.listActivities({ projectId })),
      read("achievements.list all", "S07", (ctx) => ctx.achievements.listAchievements({})),
      read("achievements.list confirmed", "S07", (ctx) => ctx.achievements.listAchievements({ status: "confirmed" })),
      read("achievements.list missing evidence", "S07", (ctx) => ctx.achievements.listAchievements({ missingEvidence: true })),
      read("projects.list all", "S09", (ctx) => ctx.projects.listProjects({})),
      read("projects.list outcome missing", "S09", (ctx) => ctx.projects.listProjects({ outcomeMissing: true })),
      read("timeline.getTimeline", "S11", (ctx) => ctx.timeline.getTimeline({ type: "", project: "" })),
    ];

    const writeOp = (
      name: string, surface: string, run: Operation["run"], prepare?: Operation["prepare"],
    ): Operation => ({ name, surface, kind: "write", targetMs: SAVE_TARGET_MS, run, prepare });
    const achievementChanges = (title: string, confirm: boolean) => ({
      title, contribution: "Kontribusi sintetis", scope: "", outcome: confirm ? "Hasil sintetis" : "", cvBullet: "",
      achievedOn: confirm ? day : null, metrics: [],
    });
    const draftAchievement = async (ctx: Ctx, title: string) => {
      const receipt = await ctx.achievements.createAchievement({ operationKey: randomUUID(), activityId: null, projectId: null, experienceId: null });
      return { receipt, title };
    };
    operations.push(
      writeOp("createActivity (note)", "save", async (ctx) => {
        await ctx.activities.createActivity({
          operationKey: randomUUID(), captureMode: "note", rawText: "Catatan sintetis untuk pengukuran simpan.", occurredOn: day,
          role: null, scope: null, outcome: null, experienceId: null, projectId: null,
        });
      }),
      writeOp("updateActivity", "save", async (ctx) => {
        const updated = await ctx.activities.updateActivity({
          activityId: firstActivity.id, expectedRevision: activityState.revision, rawText: `Catatan diperbarui ${randomUUID()}`,
          occurredOn: firstActivity.occurred_on, role: null, scope: null, outcome: null, experienceId: null, projectId: null,
        });
        activityState.revision = updated.revision;
      }),
      writeOp("saveAchievement save_draft", "save", async (ctx, prepared) => {
        const { receipt, title } = prepared as Awaited<ReturnType<typeof draftAchievement>>;
        await ctx.achievements.saveAchievement({
          achievementId: receipt.achievementId, expectedRevision: receipt.revision, action: "save_draft",
          changes: achievementChanges(title, false), skillNames: [],
        });
      }, (ctx) => draftAchievement(ctx, `Capaian draft ${randomUUID()}`)),
      writeOp("saveAchievement confirm", "save", async (ctx, prepared) => {
        const { receipt, revision, title } = prepared as { receipt: { achievementId: string }; revision: number; title: string };
        await ctx.achievements.saveAchievement({
          achievementId: receipt.achievementId, expectedRevision: revision, action: "confirm",
          changes: achievementChanges(title, true), skillNames: [],
        });
      }, async (ctx) => {
        const { receipt, title } = await draftAchievement(ctx, `Capaian konfirmasi ${randomUUID()}`);
        const drafted = await ctx.achievements.saveAchievement({
          achievementId: receipt.achievementId, expectedRevision: receipt.revision, action: "save_draft",
          changes: achievementChanges(title, true), skillNames: [],
        });
        return { receipt, revision: drafted.revision, title };
      }),
      writeOp("createProject", "save", async (ctx) => {
        await ctx.projects.createProject({
          operationKey: randomUUID(), title: `Proyek sintetis ${randomUUID()}`, description: null, userRole: null, outcome: null,
          status: "planned", experienceId: null, startDate: null, startPrecision: null, endDate: null, endPrecision: null, isCurrent: false,
        });
      }),
      writeOp("updateProject", "save", async (ctx) => {
        const updated = await ctx.projects.updateProject({
          projectId: firstProject.id, expectedRevision: projectState.revision, title: `Proyek diperbarui ${randomUUID()}`,
          description: firstProject.description, userRole: firstProject.user_role, outcome: firstProject.outcome,
          status: firstProject.status, experienceId: firstProject.experience_id, startDate: firstProject.start_date,
          startPrecision: firstProject.start_precision, endDate: firstProject.end_date, endPrecision: firstProject.end_precision,
          isCurrent: firstProject.is_current,
        });
        projectState.revision = updated.revision;
      }),
    );

    const timed = async (operation: Operation, ctx: Ctx): Promise<number> => {
      const prepared = operation.prepare ? await operation.prepare(ctx) : undefined;
      const started = performance.now();
      await operation.run(ctx, prepared);
      return performance.now() - started;
    };

    // Cold: the first call of each operation on a client object that has made no request yet. PostgreSQL buffers are not flushed.
    const cold = new Map<string, number>();
    for (const operation of operations.filter((item) => item.kind === "read")) {
      cold.set(operation.name, await timed(operation, makeCtx(await clientFromSession(harness, source))));
    }
    const random = mulberry32(ORDER_SEED);
    const shuffled = <T,>(list: readonly T[]): T[] => {
      const copy = [...list];
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [copy[i], copy[j]] = [copy[j]!, copy[i]!];
      }
      return copy;
    };
    const samples = new Map<string, number[]>(operations.map((operation) => [operation.name, []]));

    // Reads run on the dataset of section 6 exactly; the saves that follow add rows (the counts afterwards are recorded).
    const reads = operations.filter((operation) => operation.kind === "read");
    for (let round = 0; round < WARMUPS + SAMPLES; round += 1) {
      for (const operation of shuffled(reads)) {
        const elapsed = await timed(operation, main);
        if (round >= WARMUPS) samples.get(operation.name)!.push(elapsed);
      }
    }
    const datasetAfterReads = countDataset(p.id);
    expect(datasetAfterReads).toEqual(datasetBefore);

    const writes = operations.filter((operation) => operation.kind === "write");
    for (const operation of writes) {
      cold.set(operation.name, await timed(operation, makeCtx(await clientFromSession(harness, source))));
    }
    for (let round = 0; round < WARMUPS + SAMPLES; round += 1) {
      for (const operation of shuffled(writes)) {
        const elapsed = await timed(operation, main);
        if (round >= WARMUPS) samples.get(operation.name)!.push(elapsed);
      }
    }
    const datasetAfterWrites = countDataset(p.id);

    const results = operations.map((operation) => {
      const warm = samples.get(operation.name)!;
      const summary = summarize(warm);
      return {
        operation: operation.name,
        surface: operation.surface,
        kind: operation.kind,
        targetMs: operation.targetMs,
        n: summary.n,
        warmupsDiscarded: WARMUPS,
        p50Ms: round1(summary.p50),
        p95Ms: round1(summary.p95),
        maxMs: round1(summary.max),
        coldFirstCallMs: round1(cold.get(operation.name)!),
        pass: summary.p95 < operation.targetMs,
        samplesMs: warm.map(round1),
      };
    });

    const report = {
      task: "T24",
      generatedAt: new Date().toISOString(),
      environment: environmentInfo(),
      method: {
        layer: "service (src/features/*) -> Kong/PostgREST loopback -> PostgreSQL; no React render, no public network, no AI",
        timer: "performance.now() around one service call",
        samplesPerOperation: SAMPLES,
        warmupsDiscardedPerOperation: WARMUPS,
        percentile: "nearest-rank: sorted[ceil(0.95 * n) - 1]",
        order: `operations shuffled per round, seeded (${ORDER_SEED}); reads first on the exact section 6 dataset, then saves`,
        cold: "first call of each operation on a new client object that reuses the signed-in session; PostgreSQL buffers are not flushed and containers are not restarted",
        eventTriggers: `${triggerCount} product_event_ triggers active`,
        seed: "user RPCs with JWT claims in psql; ANALYZE after seed; account Q holds the same volume in the same database and is not measured",
        evidence: "none attached (the scan pipeline is not part of the measurement); missing-evidence filters run over the 150 confirmed achievements",
        targets: { readP95Ms: READ_TARGET_MS, saveP95Ms: SAVE_TARGET_MS },
      },
      dataset: { accountP: datasetBefore, accountQ: datasetQ, accountPAfterSaves: datasetAfterWrites },
      operations: results,
      pass: results.every((item) => item.pass),
    };
    const written = writeResults(report);
    process.stdout.write(`T24-PERF-RESULTS ${written}\n`);
    for (const item of results) {
      process.stdout.write(
        `T24-PERF ${item.kind} ${item.surface} ${item.operation}: n=${item.n} p50=${item.p50Ms} p95=${item.p95Ms} max=${item.maxMs} cold=${item.coldFirstCallMs} ms\n`,
      );
    }

    for (const item of results) {
      expect(item.n, item.operation).toBeGreaterThanOrEqual(50);
      expect(item.p95Ms, `${item.operation} p95`).toBeLessThan(item.targetMs);
      expect(percentileNearestRank(item.samplesMs, 95)).toBe(item.p95Ms);
    }
  });
});
