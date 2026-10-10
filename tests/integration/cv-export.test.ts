import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PdfRenderer } from "@/server/export/pdf-renderer";

import {
  BUCKET,
  LONG_TIMEOUT,
  RACE_ROUNDS,
  SENTINEL,
  START_DELAYS_MS,
  achievementRow,
  allSummaries,
  collectedErrors,
  createAccount,
  createAchievement,
  createEducation,
  createProject,
  createSkill,
  cvFingerprint,
  cvRevision,
  drain,
  editBullet,
  exportCount,
  exportInfo,
  expectExportError,
  expectOutcomes,
  failingRenderer,
  fake,
  getAdmin,
  getAdminConfig,
  newKey,
  objectNames,
  outcomeOf,
  pdfOf,
  raceLog,
  readyAccount,
  request,
  required,
  select,
  setupHarness,
  signedUrlTtlSeconds,
  sql,
  teardownHarness,
  type Client,
  type Ready,
} from "./cv-export-support";

describe("local CV export backend integration", () => {
  beforeAll(() => setupHarness());

  afterAll(async () => teardownHarness());

  it("exports a ready CV end to end: readiness, request, worker, stored object, signed URL of at most five minutes", async () => {
    const { account, bullet } = await readyAccount("main", { displayName: `Siti ${SENTINEL}` });
    const service = account.exports[0]!;
    const revision = await cvRevision(account);
    expect(await service.getReadiness()).toEqual({ has_cv: true, cv_revision: revision, ready: true, blockers: [] });

    const requested = await service.requestExport({ expected_revision: revision, idempotency_key: newKey() });
    expect(requested).toMatchObject({ status: "queued", cvRevision: revision, reused: false });
    expect(exportInfo(requested.exportId)).toMatchObject({ status: "queued", cv_revision: revision, attempt_count: 0, object_key: null });

    const run = await drain();
    expect(run).toMatchObject({ claimed: 1, succeeded: 1, stale: 0, errored: 0, failed: {} });
    const info = exportInfo(requested.exportId);
    expect(info).toMatchObject({ status: "succeeded", error_code: null, attempt_count: 1, ttl_ok: true });
    expect(info.page_count).toBeGreaterThanOrEqual(1);
    expect(info.byte_size).toBeGreaterThan(100);

    // One object per attempt, under the owner's export prefix and keyed by the attempt token.
    const names = await objectNames(account.id);
    expect(names).toHaveLength(1);
    expect(info.object_key).toBe(`${account.id}/export/${names[0]}`);
    expect(info.object_key).toBe(`${account.id}/export/${info.attempt_token}`);

    const pdf = await pdfOf(requested.exportId);
    expect(pdf.pageCount).toBe(info.page_count);
    expect(pdf.text).toContain(`Siti ${SENTINEL}`);
    expect(pdf.text).toContain(bullet);

    const listed = await service.listExports();
    expect(listed.map((row) => row.id)).toEqual([requested.exportId]);
    expect(listed[0]).toMatchObject({ status: "succeeded", page_count: info.page_count });

    const issued = await service.issueDownload({ export_id: requested.exportId });
    expect(issued.expiresInSeconds).toBe(300);
    expect(signedUrlTtlSeconds(issued.url)).toBeLessThanOrEqual(305);
    // The browser gets a URL and a lifetime only; there is no separate object key field (the signed path is the URL).
    expect(Object.keys(issued).sort()).toEqual(["expiresInSeconds", "url"]);
    const response = await fetch(issued.url);
    expect(response.status).toBe(200);
    const downloaded = new Uint8Array(await response.arrayBuffer());
    expect(Buffer.from(downloaded.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    expect(downloaded.byteLength).toBe(info.byte_size);

    // The same revision again returns the finished export instead of a second job.
    const again = await service.requestExport({ expected_revision: revision, idempotency_key: newKey() });
    expect(again).toMatchObject({ exportId: requested.exportId, status: "succeeded", reused: true });
    expect(exportCount(account.id)).toBe(1);
  }, LONG_TIMEOUT);

  it("release scenario: an edited source blocks export until Keep saved wording, a deleted source blocks until the item is removed", async () => {
    const { account, achievement, itemId, bullet } = await readyAccount("release", { clientCount: 2 });
    const service = account.exports[0]!;
    await account.cv[0]!.saveEdits({ expected_revision: await cvRevision(account), item_overrides: [{ item_id: itemId, override_text: `Wording saya ${SENTINEL}` }] });
    expect((await service.getReadiness()).ready).toBe(true);

    await editBullet(account, achievement.id, "Kalimat sumber versi dua");
    const blocked = await service.getReadiness();
    expect(blocked).toMatchObject({ ready: false, blockers: [{ code: "ITEM_CHANGED", item_id: itemId }] });
    const before = cvFingerprint(account.id);
    const error = await expectExportError(request(account), "EXPORT_BLOCKED");
    expect(error.blockers).toEqual([{ code: "ITEM_CHANGED", item_id: itemId }]);
    expect(exportCount(account.id)).toBe(0);
    expect(cvFingerprint(account.id)).toBe(before);

    // Keep saved wording is an explicit acknowledgement of that exact revision.
    const freshness = (await account.cv[0]!.getFreshness()).find((row) => row.target === "item" && row.item_id === itemId);
    await account.cv[0]!.resolveFreshness({
      expected_revision: await cvRevision(account),
      resolutions: [{ target: "item", item_id: itemId, source_revision: required(freshness?.live_revision, null, "live revision"), action: "keep" }],
    });
    expect((await service.getReadiness()).ready).toBe(true);
    const kept = await request(account);
    expect((await drain()).succeeded).toBe(1);
    const keptPdf = await pdfOf(kept.exportId);
    expect(keptPdf.text).toContain(`Wording saya ${SENTINEL}`);
    expect(keptPdf.text).not.toContain("Kalimat sumber versi dua");
    expect(keptPdf.text).not.toContain(bullet);

    // Deleting the selected source blocks export again, until the item is removed from the CV.
    const row = await achievementRow(account, achievement.id);
    const deleted = await account.clients[1]!.rpc("delete_achievement", { p_achievement_id: achievement.id, p_expected_revision: row.revision });
    expect(deleted.error).toBeNull();
    expect(await service.getReadiness()).toMatchObject({ ready: false, blockers: [{ code: "ITEM_DELETED", item_id: itemId }] });
    const deletedError = await expectExportError(request(account), "EXPORT_BLOCKED");
    expect(deletedError.blockers).toEqual([{ code: "ITEM_DELETED", item_id: itemId }]);

    await account.cv[0]!.remove({ expected_revision: await cvRevision(account), item_id: itemId, remove_children: false });
    expect((await service.getReadiness()).ready).toBe(true);
    const finalExport = await request(account);
    expect(finalExport.exportId).not.toBe(kept.exportId);
    expect((await drain()).succeeded).toBe(1);
    const finalPdf = await pdfOf(finalExport.exportId);
    expect(finalPdf.text).not.toContain(`Wording saya ${SENTINEL}`);
    expect(exportCount(account.id)).toBe(2);
  }, LONG_TIMEOUT);

  it("graduate scenario: no employment still exports a useful CV; skills alone are blocked", async () => {
    const graduate = await createAccount("graduate");
    await graduate.cv[0]!.ensure();
    const education = await createEducation(graduate, "Universitas Akademik");
    await select(graduate, "education", education);
    const project = await createProject(graduate, "Skripsi Akademik");
    await select(graduate, "project", project.projectId);
    const achievement = await createAchievement(graduate, "Hasil Skripsi", { projectId: project.projectId, cvBullet: "Menyelesaikan skripsi tepat waktu" });
    await select(graduate, "achievement", achievement.id);
    expect((await graduate.exports[0]!.getReadiness()).ready).toBe(true);
    const graduateExport = await request(graduate);
    expect((await drain()).succeeded).toBe(1);
    const pdf = await pdfOf(graduateExport.exportId);
    expect(pdf.text).toContain("Universitas Akademik");
    expect(pdf.text).toContain("Skripsi Akademik");
    expect(pdf.text).toContain("Menyelesaikan skripsi tepat waktu");
    expect(pdf.text).not.toContain("Experience");

    const skillsOnly = await createAccount("skills-only");
    await skillsOnly.cv[0]!.ensure();
    await select(skillsOnly, "skill", await createSkill(skillsOnly, "SQL"));
    expect(await skillsOnly.exports[0]!.getReadiness()).toMatchObject({ ready: false, blockers: [{ code: "CONTENT_REQUIRED" }] });
    const error = await expectExportError(request(skillsOnly), "EXPORT_BLOCKED");
    expect(error.blockers).toEqual([{ code: "CONTENT_REQUIRED" }]);
    expect(exportCount(skillsOnly.id)).toBe(0);
    // A nameless CV cannot be built through the RPCs (onboarding requires a name); pgTAP proves NAME_REQUIRED.
  }, LONG_TIMEOUT);

  it("exports selected skills, certifications and an achievement with skills; the credential URL is never printed (gate review N1)", async () => {
    const { account } = await readyAccount("skills-certs");
    await select(account, "skill", await createSkill(account, "Analisis Data"));
    const certification = await account.clients[0]!.rpc("create_certification_idempotent", {
      p_operation_key: randomUUID(), p_name: "Sertifikasi Uji", p_issuer: "Lembaga Uji",
      p_credential_url: "https://credentials.example.org/abc", p_issued_date: "2025-03-01", p_issued_precision: "month",
    });
    await select(account, "certification", required(certification.data?.[0]?.id, certification.error, "certification"));
    const service = account.achievements[0]!;
    const created = await service.createAchievement({ operationKey: randomUUID(), activityId: null, projectId: null, experienceId: null });
    const changes = { title: "Capaian Berskill", contribution: "Kontribusi uji", scope: "", outcome: "Hasil uji", cvBullet: "Bullet berskill uji", achievedOn: "2026-09-20", metrics: [] };
    const draft = await service.saveAchievement({ achievementId: created.achievementId, expectedRevision: 1, action: "save_draft", changes, skillNames: ["Kepemimpinan"] });
    await service.saveAchievement({ achievementId: created.achievementId, expectedRevision: draft.revision, action: "confirm", changes, skillNames: ["Kepemimpinan"] });
    await select(account, "achievement", created.achievementId);

    expect((await account.exports[0]!.getReadiness()).ready).toBe(true);
    const requested = await request(account);
    expect(await drain()).toMatchObject({ succeeded: 1, failed: {} });
    const pdf = await pdfOf(requested.exportId);
    expect(pdf.text).toContain("Analisis Data");
    expect(pdf.text).toContain("Sertifikasi Uji");
    expect(pdf.text).toContain("Bullet berskill uji");
    expect(pdf.text).not.toContain("credentials.example.org");
  }, LONG_TIMEOUT);

  it("renders the snapshot, not the career rows: an edit after the request does not reach the PDF", async () => {
    const { account, achievement, bullet } = await readyAccount("snapshot");
    const requested = await request(account);
    const later = `WP-LATER-EDIT-${randomUUID().slice(0, 8)}`;
    await editBullet(account, achievement.id, later);
    await account.cv[0]!.saveEdits({ expected_revision: await cvRevision(account), title: `Judul baru ${later}` });
    expect((await drain()).succeeded).toBe(1);
    const pdf = await pdfOf(requested.exportId);
    expect(pdf.text).toContain(bullet);
    expect(pdf.text).not.toContain(later);
    expect(exportInfo(requested.exportId).cv_revision).toBeLessThan(await cvRevision(account));
  }, LONG_TIMEOUT);

  it("is not affected by a source edit that lands after rendering but before completion", async () => {
    const { account, achievement, bullet } = await readyAccount("after-render");
    const requested = await request(account);
    const later = `WP-AFTER-RENDER-${randomUUID().slice(0, 8)}`;
    await drain(fake, { onRendered: async () => { await editBullet(account, achievement.id, later); } });
    expect(exportInfo(requested.exportId).status).toBe("succeeded");
    const pdf = await pdfOf(requested.exportId);
    expect(pdf.text).toContain(bullet);
    expect(pdf.text).not.toContain(later);
  }, LONG_TIMEOUT);

  describe("real concurrency of a request against a mutation (each scenario runs several rounds on fresh accounts)", () => {
    interface Scenario {
      name: string;
      allowedRequest: readonly string[];
      /** Reads whatever the mutation needs, then returns the single RPC call that races the request. */
      prepare: (ready: Ready, client: Client, round: number) => Promise<() => PromiseLike<unknown>>;
      checkExported: (ready: Ready, pdfText: string, round: number) => void;
      blocker?: string;
    }

    const scenarios: Scenario[] = [
      {
        name: "(a) edit of a selected source",
        allowedRequest: ["CV_EXPORT_BLOCKED"],
        blocker: "ITEM_CHANGED",
        async prepare(ready, client, round) {
          const row = await achievementRow(ready.account, ready.achievement.id);
          return () => client.rpc("save_achievement", {
            p_achievement_id: ready.achievement.id, p_expected_revision: row.revision, p_action: "save_changes",
            p_changes: { title: row.title, contribution: row.contribution, outcome: row.outcome, achieved_on: row.achieved_on, cv_bullet: `NEW-A-${round}` },
            p_skill_names: [],
          });
        },
        checkExported(ready, text, round) {
          expect(text).toContain(ready.bullet);
          expect(text).not.toContain(`NEW-A-${round}`);
        },
      },
      {
        name: "(b) deletion of a selected source",
        allowedRequest: ["STALE_REVISION", "CV_EXPORT_BLOCKED"],
        async prepare(ready, client) {
          const row = await achievementRow(ready.account, ready.achievement.id);
          return () => client.rpc("delete_achievement", { p_achievement_id: ready.achievement.id, p_expected_revision: row.revision });
        },
        checkExported(ready, text) {
          expect(text).toContain(ready.bullet);
        },
      },
      {
        name: "(c) reopening a confirmed achievement to draft",
        allowedRequest: ["CV_EXPORT_BLOCKED"],
        blocker: "ITEM_UNCONFIRMED",
        async prepare(ready, client) {
          const row = await achievementRow(ready.account, ready.achievement.id);
          return () => client.rpc("save_achievement", {
            p_achievement_id: ready.achievement.id, p_expected_revision: row.revision, p_action: "reopen", p_changes: {}, p_skill_names: [],
          });
        },
        checkExported(ready, text) {
          expect(text).toContain(ready.bullet);
        },
      },
      {
        name: "(d) saving CV edits",
        allowedRequest: ["STALE_REVISION"],
        async prepare(ready, client, round) {
          const revision = await cvRevision(ready.account);
          return () => client.rpc("save_cv_edits", {
            p_expected_revision: revision,
            p_edits: { item_overrides: [{ item_id: ready.itemId, override_text: `OVR-D-${round}` }] },
          });
        },
        checkExported(ready, text, round) {
          expect(text).toContain(ready.bullet);
          expect(text).not.toContain(`OVR-D-${round}`);
        },
      },
      {
        name: "(e) renaming the profile",
        allowedRequest: ["CV_EXPORT_BLOCKED"],
        blocker: "PROFILE_CHANGED",
        async prepare(ready, client, round) {
          const profile = await client.from("profiles").select("revision").eq("id", ready.account.id).single();
          const revision = required(profile.data?.revision, profile.error, "profile revision");
          return () => client.rpc("update_profile", { p_expected_revision: revision, p_changes: { display_name: `Nama Baru ${round}` } });
        },
        checkExported(ready, text, round) {
          expect(text).toContain(ready.account.name);
          expect(text).not.toContain(`Nama Baru ${round}`);
        },
      },
    ];

    it.each(scenarios.map((scenario) => [scenario.name, scenario] as const))("%s never deadlocks and ends consistent", async (_name, scenario) => {
      for (let round = 0; round < RACE_ROUNDS; round += 1) {
        const ready = await readyAccount(`race-${scenario.name.slice(1, 2)}-${round}`, { clientCount: 2 });
        const revision = await cvRevision(ready.account);
        const fire = await scenario.prepare(ready, ready.account.clients[1]!, round);
        // Round 0 sends the request first; later rounds send the mutation first and the request a few milliseconds
        // after it, so that the request can arrive while the mutation holds its row lock.
        const delayMs = START_DELAYS_MS[round % START_DELAYS_MS.length]!;
        const mutationFirst = delayMs > 0;
        const requestCall = async () => {
          if (mutationFirst) await new Promise((resolve) => setTimeout(resolve, delayMs));
          return ready.account.clients[0]!.rpc("request_cv_export", { p_expected_revision: revision, p_idempotency_key: newKey() });
        };
        const mutationCall = async () => fire();
        const settled = (await Promise.allSettled(mutationFirst ? [mutationCall(), requestCall()] : [requestCall(), mutationCall()])).map(outcomeOf);
        const requestOutcome = settled[mutationFirst ? 1 : 0]!;
        const mutationOutcome = settled[mutationFirst ? 0 : 1]!;
        expectOutcomes([requestOutcome], scenario.allowedRequest);
        // The mutation always wins its own race: it only ever waits for the export lock to be released.
        expect(mutationOutcome, `mutation outcome of ${scenario.name} round ${round}`).toEqual({ code: null, message: null, details: null });

        if (requestOutcome.message === null) {
          const found = sql(`select id from public.cv_exports where user_id = '${ready.account.id}'::uuid`);
          expect(found).toMatch(/^[0-9a-f-]{36}$/);
          expect((await drain()).succeeded).toBe(1);
          scenario.checkExported(ready, (await pdfOf(found)).text, round);
          raceLog.push(`${scenario.name} round ${round} (${mutationFirst ? "mutation" : "request"} sent first): exported (snapshot before the mutation)`);
        } else {
          expect(exportCount(ready.account.id)).toBe(0);
          if (requestOutcome.message === "CV_EXPORT_BLOCKED" && scenario.blocker) {
            expect(requestOutcome.details ?? "").toContain(scenario.blocker);
          }
          raceLog.push(`${scenario.name} round ${round} (${mutationFirst ? "mutation" : "request"} sent first): ${requestOutcome.message}`);
        }
        collectedErrors.push(requestOutcome);
      }
    }, LONG_TIMEOUT);
  });
  it("never creates a second job: parallel requests, reused keys and a newer revision while one is active", async () => {
    const { account } = await readyAccount("dedup", { clientCount: 2 });
    const revision = await cvRevision(account);
    const [first, second] = await Promise.all([
      account.exports[0]!.requestExport({ expected_revision: revision, idempotency_key: newKey() }),
      account.exports[1]!.requestExport({ expected_revision: revision, idempotency_key: newKey() }),
    ]);
    expect(first.exportId).toBe(second.exportId);
    expect([first.reused, second.reused].sort()).toEqual([false, true]);
    expect(exportCount(account.id)).toBe(1);
    // Only the request that created the export owns its key; the other one was answered with the active export.
    const keyA = sql(`select idempotency_key from public.cv_exports where id = '${first.exportId}'::uuid`);

    // The same key with another revision is a different payload.
    const education = await createEducation(account, "Kampus Dua");
    await select(account, "education", education);
    const newer = await cvRevision(account);
    expect(newer).toBeGreaterThan(revision);
    const reused = outcomeOf(await Promise.allSettled([account.clients[0]!.rpc("request_cv_export", { p_expected_revision: newer, p_idempotency_key: keyA })]).then((r) => r[0]!));
    expect(reused.message).toBe("IDEMPOTENCY_KEY_REUSED");
    // The same key and revision as before still answers with the original export.
    expect(await account.exports[0]!.requestExport({ expected_revision: revision, idempotency_key: keyA })).toMatchObject({ exportId: first.exportId, reused: true });
    // A different key at the newer revision is refused while the old export is still active.
    await expectExportError(account.exports[0]!.requestExport({ expected_revision: newer, idempotency_key: newKey() }), "EXPORT_IN_PROGRESS");
    expect(exportCount(account.id)).toBe(1);

    expect((await drain()).succeeded).toBe(1);
    // After it finished, the newer revision gets its own export.
    const next = await account.exports[0]!.requestExport({ expected_revision: newer, idempotency_key: newKey() });
    expect(next.exportId).not.toBe(first.exportId);
    expect(next.reused).toBe(false);
    expect((await drain()).succeeded).toBe(1);
    expect(exportCount(account.id)).toBe(2);
  }, LONG_TIMEOUT);

  it("lease: a worker that loses its lease cannot complete and removes its own object; the job times out and a retry succeeds with the same snapshot", async () => {
    const { account } = await readyAccount("lease");
    const requested = await request(account);
    const hashBefore = exportInfo(requested.exportId).snapshot_hash;

    const stale = await drain(fake, {
      onRendered: () => { sql(`update public.cv_exports set lease_expires_at = clock_timestamp() - interval '1 second' where id = '${requested.exportId}'::uuid`); },
    });
    expect(stale).toMatchObject({ claimed: 1, succeeded: 0 });
    // The next pass first expires the lease, then there is nothing queued.
    await drain();
    expect(exportInfo(requested.exportId)).toMatchObject({ status: "failed", error_code: "EXPORT_TIMEOUT", attempt_count: 1 });
    expect(await objectNames(account.id)).toEqual([]);

    const retried = await account.exports[0]!.retryExport({ export_id: requested.exportId });
    expect(retried).toMatchObject({ exportId: requested.exportId, status: "queued", attemptCount: 1 });
    expect((await drain()).succeeded).toBe(1);
    const info = exportInfo(requested.exportId);
    expect(info).toMatchObject({ status: "succeeded", attempt_count: 2, snapshot_hash: hashBefore });
    expect(info.object_key).toBe(`${account.id}/export/${info.attempt_token}`);
    expect(await objectNames(account.id)).toEqual([info.attempt_token]);
  }, LONG_TIMEOUT);

  it("render failures keep the CV, retry the same snapshot, stop after three attempts and allow a new request", async () => {
    const { account } = await readyAccount("render-fail");
    const fingerprint = cvFingerprint(account.id);
    const revision = await cvRevision(account);
    const requested = await request(account);
    const snapshotHash = exportInfo(requested.exportId).snapshot_hash;

    const first = await drain(failingRenderer("RENDERER_UNAVAILABLE"));
    expect(first).toMatchObject({ claimed: 1, succeeded: 0, failed: { RENDERER_UNAVAILABLE: 1 } });
    expect(exportInfo(requested.exportId)).toMatchObject({ status: "failed", error_code: "RENDERER_UNAVAILABLE", attempt_count: 1, object_key: null });
    expect(cvFingerprint(account.id)).toBe(fingerprint);
    expect(await cvRevision(account)).toBe(revision);
    expect(await objectNames(account.id)).toEqual([]);

    await account.exports[0]!.retryExport({ export_id: requested.exportId });
    expect((await drain(failingRenderer("RENDERER_TIMEOUT"))).failed).toEqual({ RENDERER_TIMEOUT: 1 });
    await account.exports[0]!.retryExport({ export_id: requested.exportId });
    expect((await drain(failingRenderer("EXPORT_RENDER_INVALID"))).failed).toEqual({ EXPORT_RENDER_INVALID: 1 });
    expect(exportInfo(requested.exportId)).toMatchObject({ status: "failed", attempt_count: 3, snapshot_hash: snapshotHash });
    await expectExportError(account.exports[0]!.retryExport({ export_id: requested.exportId }), "EXPORT_NOT_RETRYABLE");
    expect(cvFingerprint(account.id)).toBe(fingerprint);

    // A new request after the third failure revalidates and builds a fresh export.
    const fresh = await account.exports[0]!.requestExport({ expected_revision: revision, idempotency_key: newKey() });
    expect(fresh.exportId).not.toBe(requested.exportId);
    expect((await drain()).succeeded).toBe(1);
    expect(exportInfo(fresh.exportId)).toMatchObject({ status: "succeeded", attempt_count: 1 });
    expect(exportInfo(requested.exportId).status).toBe("failed");
  }, LONG_TIMEOUT);

  it("a permanent failure is not retryable: an over-long document ends in EXPORT_TOO_LONG", async () => {
    const { account } = await readyAccount("too-long");
    const requested = await request(account);
    const lines = Array.from({ length: 1100 }, (_, n) => `<p>Baris ${n}</p>`).join("");
    const longRenderer: PdfRenderer = {
      kind: "fake",
      async render(html, signal) { return fake.render(`${html}${lines}`, signal); },
    };
    expect((await drain(longRenderer)).failed).toEqual({ EXPORT_TOO_LONG: 1 });
    expect(exportInfo(requested.exportId)).toMatchObject({ status: "failed", error_code: "EXPORT_TOO_LONG", object_key: null });
    expect(await objectNames(account.id)).toEqual([]);
    await expectExportError(account.exports[0]!.retryExport({ export_id: requested.exportId }), "EXPORT_NOT_RETRYABLE");
  }, LONG_TIMEOUT);

  it("expires after 24 hours: the object is deleted, the download is refused, a new request builds a new export, the CV stays", async () => {
    const { account } = await readyAccount("expiry");
    const requested = await request(account);
    expect((await drain()).succeeded).toBe(1);
    expect(await objectNames(account.id)).toHaveLength(1);
    const revision = await cvRevision(account);
    const fingerprint = cvFingerprint(account.id);

    sql(`update public.cv_exports set expires_at = clock_timestamp() - interval '1 minute' where id = '${requested.exportId}'::uuid`);
    await expectExportError(account.exports[0]!.issueDownload({ export_id: requested.exportId }), "EXPORT_EXPIRED");
    const housekeeping = await drain();
    expect(housekeeping).toMatchObject({ expired: 1, cleanupCompleted: 1 });
    expect(exportInfo(requested.exportId).purged_at).not.toBeNull();
    expect(await objectNames(account.id)).toEqual([]);
    await expectExportError(account.exports[0]!.issueDownload({ export_id: requested.exportId }), "EXPORT_EXPIRED");

    expect(cvFingerprint(account.id)).toBe(fingerprint);
    expect(await cvRevision(account)).toBe(revision);
    const regenerated = await account.exports[0]!.requestExport({ expected_revision: revision, idempotency_key: newKey() });
    expect(regenerated.exportId).not.toBe(requested.exportId);
    expect(regenerated).toMatchObject({ status: "queued", reused: false });
    expect((await drain()).succeeded).toBe(1);
    expect(exportCount(account.id)).toBe(2);
  }, LONG_TIMEOUT);

  it("queues old orphan export objects for deletion and leaves new ones alone", async () => {
    const account = await createAccount("orphan");
    const oldKey = `${account.id}/export/${randomUUID()}`;
    const newObjectKey = `${account.id}/export/${randomUUID()}`;
    const bytes = new TextEncoder().encode("%PDF-1.4\n%%EOF");
    for (const key of [oldKey, newObjectKey]) {
      const { error } = await getAdmin().storage.from(BUCKET).upload(key, bytes, { contentType: "application/pdf", upsert: false });
      expect(error).toBeNull();
    }
    sql(`update storage.objects set created_at = now() - interval '2 hours' where bucket_id = '${BUCKET}' and name = '${oldKey}'`);
    const run = await drain();
    expect(run.orphansQueued).toBeGreaterThanOrEqual(1);
    expect(run.cleanupCompleted).toBeGreaterThanOrEqual(1);
    const left = await objectNames(account.id);
    expect(left).toEqual([newObjectKey.split("/")[2]]);
  }, LONG_TIMEOUT);

  it("isolates owners, fails jobs of a deleting account without an object, and never echoes private text", async () => {
    const owner = await readyAccount("owner-a", { bullet: `Bullet ${SENTINEL}`, displayName: `Siti ${SENTINEL}` });
    const other = await readyAccount("owner-b");
    const ownerExport = await request(owner.account);
    expect((await drain()).succeeded).toBe(1);

    // Another account cannot see, retry or download it, and cannot tell it from a random id.
    const strangerErrors = [
      await expectExportError(other.account.exports[0]!.retryExport({ export_id: ownerExport.exportId }), "EXPORT_NOT_FOUND"),
      await expectExportError(other.account.exports[0]!.retryExport({ export_id: randomUUID() }), "EXPORT_NOT_FOUND"),
      await expectExportError(other.account.exports[0]!.issueDownload({ export_id: ownerExport.exportId }), "EXPORT_NOT_FOUND"),
      await expectExportError(other.account.exports[0]!.issueDownload({ export_id: randomUUID() }), "EXPORT_NOT_FOUND"),
    ];
    expect(new Set(strangerErrors.map((error) => error.messageKey)).size).toBe(1);
    expect(await other.account.exports[0]!.listExports()).toEqual([]);
    const direct = await other.account.clients[0]!.from("cv_exports").select("*");
    expect(direct.data).toEqual([]);
    const writes = await Promise.all([
      other.account.clients[0]!.from("cv_exports").update({ status: "queued" }).eq("id", ownerExport.exportId),
      other.account.clients[0]!.from("cv_exports").delete().eq("id", ownerExport.exportId),
      owner.account.clients[0]!.from("cv_exports").update({ snapshot: {} }).eq("id", ownerExport.exportId),
    ]);
    for (const result of writes) expect(result.error).not.toBeNull();
    expect(exportInfo(ownerExport.exportId).status).toBe("succeeded");

    // A deleting account: queued work fails without rendering, and no new request is accepted.
    const deleting = await readyAccount("deleting");
    const queued = await request(deleting.account);
    sql(`update public.profiles set deleting_at = now() where id = '${deleting.account.id}'::uuid`);
    await drain();
    expect(exportInfo(queued.exportId)).toMatchObject({ status: "failed", error_code: "ACCOUNT_DELETING", object_key: null });
    await expectExportError(deleting.account.exports[0]!.requestExport({ expected_revision: 1, idempotency_key: newKey() }), "UNAUTHENTICATED");
    expect(await objectNames(deleting.account.id)).toEqual([]);

    // The account starts deleting while its job is being rendered: completion fails and the object is removed.
    const midway = await readyAccount("deleting-midway");
    const midwayExport = await request(midway.account);
    const run = await drain(fake, { onRendered: () => { sql(`update public.profiles set deleting_at = now() where id = '${midway.account.id}'::uuid`); } });
    expect(run.failed).toEqual({ ACCOUNT_DELETING: 1 });
    expect(exportInfo(midwayExport.exportId)).toMatchObject({ status: "failed", error_code: "ACCOUNT_DELETING", object_key: null });
    expect(await objectNames(midway.account.id)).toEqual([]);
  }, LONG_TIMEOUT);

  it("keeps private text out of every error, detail, summary and worker output", () => {
    const text = JSON.stringify({ errors: collectedErrors, summaries: allSummaries, races: raceLog });
    expect(text).not.toContain(SENTINEL);
    expect(text).not.toContain("Kontribusi");
    expect(text).not.toContain("/export/");
    expect(allSummaries.length).toBeGreaterThan(0);
    for (const summary of allSummaries) {
      expect(Object.keys(summary).sort()).toEqual([
        "exportCleanupClaimed", "exportCleanupCompleted", "exportCleanupRetried", "exportErrored", "exportExpired", "exportFailed",
        "exportJobsClaimed", "exportOrphansQueued", "exportSnapshotsRedacted", "exportStale", "exportSucceeded",
      ]);
    }
  });

  it("uses only workers' RPC surface: no export or CV table is readable with the service key", async () => {
    for (const table of ["cv_exports", "cv_documents", "cv_items", "achievements"] as const) {
      const result = await getAdmin().from(table).select("id").limit(1);
      expect(result.error, `${table} must not be readable by the worker credential`).not.toBeNull();
    }
    expect(getAdminConfig().url).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):/);
  });
});
