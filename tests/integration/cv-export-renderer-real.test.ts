import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolvePdfRenderer, type PdfRenderer } from "@/server/export/pdf-renderer";

import {
  LONG_TIMEOUT,
  allSummaries,
  createAccount,
  createAchievement,
  createEducation,
  createExperience,
  createProject,
  cvRevision,
  cvView,
  drain,
  exportInfo,
  getAdmin,
  newKey,
  objectNames,
  pdfOf,
  request,
  select,
  setupHarness,
  sql,
  teardownHarness,
  type Account,
} from "./cv-export-support";

const NAME = "Siti Nurhaliza Ç. Ñuñez";
const INDONESIAN_BULLET = "Pengelolaan anggaran Rp1,5 miliar — “tepat waktu”";
const SECOND_INDONESIAN_BULLET = "Menyusun laporan triwulan untuk 12 cabang di Yogyakarta & Surabaya";

let renderer: PdfRenderer;

const normalize = (value: string) => value.normalize("NFC").replace(/\s+/g, " ").trim();

/** A paragraph of at least `minimum` characters, unique per `seed`, made of ordinary words. */
function longBullet(seed: number, minimum = 640): string {
  const words: string[] = [];
  let length = 0;
  for (let index = 0; length < minimum; index += 1) {
    const word = `kegiatan${seed}-${index}`;
    words.push(word);
    length += word.length + 1;
  }
  return `Capaian ${seed}: ${words.join(" ")}.`;
}

async function pageBoxes(bytes: Uint8Array): Promise<{ width: number; height: number }[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, isOffscreenCanvasSupported: false, verbosity: pdfjs.VerbosityLevel.ERRORS });
  try {
    const document = await task.promise;
    const boxes: { width: number; height: number }[] = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const [x0, y0, x1, y1] = page.view;
      boxes.push({ width: x1! - x0!, height: y1! - y0! });
      page.cleanup();
    }
    return boxes;
  } finally {
    await task.destroy();
  }
}

function expectA4(boxes: { width: number; height: number }[]) {
  expect(boxes.length).toBeGreaterThanOrEqual(1);
  for (const box of boxes) {
    expect(Math.abs(box.width - 595)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.height - 842)).toBeLessThanOrEqual(1);
  }
}

async function accountWithCv(label: string, locale: "en" | "id", extraBullets: string[] = []) {
  const account = await createAccount(label, { displayName: NAME });
  await account.cv[0]!.ensure();
  await account.cv[0]!.updateLayout({ expected_revision: await cvRevision(account), locale });
  const education = await createEducation(account, "Universitas Gadjah Mada");
  await select(account, "education", education);
  const experience = await createExperience(account, "PT Contoh Nusantara");
  await select(account, "experience", experience);
  const project = await createProject(account, "Sistem Antrian Terpadu", experience);
  await select(account, "project", project.projectId);
  const achievements: { id: string; bullet: string }[] = [];
  for (const [index, bullet] of [INDONESIAN_BULLET, SECOND_INDONESIAN_BULLET, ...extraBullets].entries()) {
    const created = await createAchievement(account, `Hasil ${index + 1}`, {
      projectId: index === 0 ? project.projectId : null, experienceId: index === 0 ? experience : null, cvBullet: bullet,
    });
    await select(account, "achievement", created.id);
    achievements.push({ id: created.id, bullet });
  }
  return { account, achievements };
}

async function exportAndRead(account: Account) {
  const requested = await request(account);
  const run = await drain(renderer);
  expect(run).toMatchObject({ succeeded: 1, failed: {}, errored: 0, stale: 0 });
  const info = exportInfo(requested.exportId);
  expect(info).toMatchObject({ status: "succeeded", error_code: null, ttl_ok: true });
  const pdf = await pdfOf(requested.exportId);
  return { requested, info, pdf, boxes: await pageBoxes(pdf.bytes) };
}

describe("local CV export with the real Chromium renderer", () => {
  beforeAll(async () => {
    setupHarness();
    const url = process.env.WORKPULSE_PDF_GOTENBERG_URL;
    if (!url) throw new Error("Set WORKPULSE_PDF_GOTENBERG_URL (see docs/verification/T21-pdf-renderer-runbook.md); this suite never falls back to the fake renderer");
    const health = await fetch(`${url.replace(/\/+$/, "")}/health`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
    if (!health || !health.ok) throw new Error("The PDF renderer is not reachable: start workpulse-t21-pdf (docs/verification/T21-pdf-renderer-runbook.md); this suite never falls back to the fake renderer");
    renderer = resolvePdfRenderer({ mode: "gotenberg", baseUrl: url, nodeEnv: "test" });
    if (renderer.kind !== "gotenberg") throw new Error("The real renderer suite must use the Gotenberg renderer");
  });

  afterAll(async () => teardownHarness());

  it.each(["en", "id"] as const)("renders a searchable A4 PDF with Indonesian text, an override and a long bullet (CV language %s)", async (locale) => {
    const { account, achievements } = await accountWithCv(`real-${locale}`, locale, [longBullet(1)]);
    const view = await cvView(account);
    const standalone = view.items.find((item) => item.achievement_id === achievements[1]!.id)!;
    const override = `Wording saya untuk ${locale}: Pemberdayaan 3.500 pelaku UMKM — “berkelanjutan”`;
    await account.cv[0]!.saveEdits({
      expected_revision: await cvRevision(account),
      summary_override: `Analis data berpengalaman (${locale}) dengan karakter Indonesia: Ç, Ñ, ñ, —, “”.`,
      item_overrides: [{ item_id: standalone.id, override_text: override }],
    });

    const { requested, info, pdf, boxes } = await exportAndRead(account);
    expectA4(boxes);
    expect(boxes).toHaveLength(info.page_count!);
    const text = normalize(pdf.text);
    expect(text.length).toBeGreaterThan(200);
    expect(text).toContain(normalize(NAME));
    expect(text).toContain(locale === "id" ? "Pengalaman" : "Experience");
    expect(text).toContain(locale === "id" ? "Pendidikan" : "Education");
    expect(text).toContain(normalize(INDONESIAN_BULLET));
    expect(text).toContain(normalize(override));
    expect(text).not.toContain(normalize(SECOND_INDONESIAN_BULLET));
    expect(text).toContain(normalize(achievements[2]!.bullet));
    expect(text).toContain("Universitas Gadjah Mada");
    expect(text).toContain("Analis data berpengalaman");

    // No evidence and no internal identifier or storage path is ever printed.
    const lower = text.toLowerCase();
    expect(lower).not.toContain("evidence");
    expect(lower).not.toContain("http");
    for (const item of view.items) expect(text).not.toContain(item.id);
    expect(text).not.toContain(account.id);
    expect(text).not.toContain(requested.exportId);
    expect(text).not.toContain("/export/");
    expect(text).not.toContain(info.object_key!);
  }, LONG_TIMEOUT);

  it("paginates a long CV into several A4 pages without losing the first or the last bullet", async () => {
    const extra = Array.from({ length: 12 }, (_, index) => longBullet(index + 10));
    const { account, achievements } = await accountWithCv("real-long", "id", extra);
    const { info, pdf, boxes } = await exportAndRead(account);
    expect(pdf.pageCount).toBeGreaterThan(1);
    expect(pdf.pageCount).toBeLessThanOrEqual(20);
    expect(pdf.pageCount).toBe(info.page_count);
    expectA4(boxes);
    expect(boxes).toHaveLength(pdf.pageCount);
    const text = normalize(pdf.text);
    for (const achievement of achievements) {
      // Both ends of every bullet: nothing is clipped at a page edge.
      expect(text).toContain(normalize(achievement.bullet.slice(0, 60)));
      expect(text).toContain(normalize(achievement.bullet.slice(-60)));
    }
    expect(text.indexOf(normalize(NAME))).toBe(0);
  }, LONG_TIMEOUT);

  it("never falls back to the fake renderer: an unreachable renderer fails the job and stores nothing", async () => {
    const { account } = await accountWithCv("real-down", "en");
    const down = resolvePdfRenderer({ mode: "gotenberg", baseUrl: "http://127.0.0.1:9", nodeEnv: "test", timeoutMs: 2_000 });
    expect(down.kind).toBe("gotenberg");
    const requested = await request(account);
    const run = await drain(down);
    expect(run).toMatchObject({ succeeded: 0, failed: { RENDERER_UNAVAILABLE: 1 } });
    expect(exportInfo(requested.exportId)).toMatchObject({ status: "failed", error_code: "RENDERER_UNAVAILABLE", object_key: null });
    expect(await objectNames(account.id)).toEqual([]);
    // The real renderer then completes the same snapshot on an explicit retry.
    await account.exports[0]!.retryExport({ export_id: requested.exportId });
    expect(await drain(renderer)).toMatchObject({ succeeded: 1 });
    expect(exportInfo(requested.exportId)).toMatchObject({ status: "succeeded", attempt_count: 2 });
    expect(allSummaries.every((summary) => !("pdfRenderer" in summary))).toBe(true);
    expect(getAdmin()).toBeDefined();
    expect(sql(`select count(*) from public.cv_exports where id = '${requested.exportId}'::uuid`)).toBe("1");
    expect(newKey()).toMatch(/^[0-9a-f-]{36}$/);
  }, LONG_TIMEOUT);
});
