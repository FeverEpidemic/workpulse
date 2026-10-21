import { expect, test, type Locator, type Page } from "@playwright/test";

import { createUser, removeUsers, seedCareer, signIn, type Career, type User } from "./helpers/release-fixture";

// T25 plan sections 1.9 and 1.12: the core journey and every dialog with the keyboard only, a visible focus indicator
// (3:1 against what is behind it) on every element that takes focus, and the event notice on S12.

const EVENT_NOTICE_EN = "WorkPulse records which actions happen, such as saving an activity or exporting a CV, without their content, to measure how reliably the product works.";
const EVENT_NOTICE_ID = "WorkPulse mencatat jenis aksi yang terjadi, seperti menyimpan aktivitas atau mengekspor CV, tanpa isinya, untuk mengukur keandalan produk.";

let journeyUser: User;
let richUser: User;
let indoUser: User;
let career: Career;

test.beforeAll(async () => {
  journeyUser = await createUser("kb-journey", { name: "Ani Papan Ketik" });
  richUser = await createUser("kb-rich", { name: "Budi Papan Ketik" });
  indoUser = await createUser("kb-id", { name: "Citra Papan Ketik", locale: "id" });
  career = await seedCareer(richUser);
});

test.afterAll(async () => {
  await removeUsers([journeyUser, richUser, indoUser].filter(Boolean));
});

interface Ring { kind: "outline" | "shadow" | "none"; width: number; color: [number, number, number]; background: [number, number, number] }

function luminance([r, g, b]: [number, number, number]): number {
  const [lr, lg, lb] = [r, g, b].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function ratio(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** What the browser paints around the focused element and what is behind it. */
async function ringOfFocus(page: Page): Promise<{ label: string; ring: Ring } | null> {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element || element === document.body) return null;
    // A date control has several Tab stops inside one element; only the arrival at the element is judged.
    const scope = window as unknown as { __wpLastFocus?: Element };
    if (scope.__wpLastFocus === element) return null;
    scope.__wpLastFocus = element;
    const parse = (value: string): [number, number, number, number] | null => {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      const parts = match[1]!.split(/[ ,/]+/).filter(Boolean).map(Number);
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
    };
    const style = getComputedStyle(element);
    let background: [number, number, number] = [255, 255, 255];
    const layers: [number, number, number, number][] = [];
    // An outline with an offset is drawn outside the border box, so it touches the parent; with no offset it sits on the element.
    const outsideRing = style.outlineStyle !== "none" && parseFloat(style.outlineOffset) > 0;
    for (let node: HTMLElement | null = outsideRing ? element.parentElement : element; node; node = node.parentElement) {
      const color = parse(getComputedStyle(node).backgroundColor);
      if (color && color[3] > 0) layers.push(color);
      if (color && color[3] === 1) break;
    }
    for (const layer of layers.reverse()) {
      background = [0, 1, 2].map((i) => Math.round(layer[i]! * layer[3] + background[i]! * (1 - layer[3]))) as [number, number, number];
    }
    const label = `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${element.className && typeof element.className === "string" ? `.${element.className.split(" ")[0]}` : ""}`;
    const outlineWidth = parseFloat(style.outlineWidth);
    const outline = parse(style.outlineColor);
    if (style.outlineStyle !== "none" && outlineWidth > 0 && outline) {
      return { label: `${label} [outline ${style.outlineStyle} ${style.outlineWidth} offset ${style.outlineOffset}]`, ring: { kind: "outline" as const, width: outlineWidth, color: [outline[0], outline[1], outline[2]] as [number, number, number], background } };
    }
    const shadow = style.boxShadow !== "none" ? style.boxShadow.match(/rgba?\([^)]+\)/)?.[0] : undefined;
    const shadowColor = shadow ? parse(shadow) : null;
    if (shadowColor) {
      return { label, ring: { kind: "shadow" as const, width: 2, color: [shadowColor[0], shadowColor[1], shadowColor[2]] as [number, number, number], background } };
    }
    return { label: `${label} [outline ${style.outlineStyle} ${style.outlineWidth}, shadow ${style.boxShadow}, type ${(element as HTMLInputElement).type ?? ""}, visible ${element.matches(":focus-visible")}]`, ring: { kind: "none" as const, width: 0, color: [0, 0, 0] as [number, number, number], background } };
  });
}

/** Records a finding when the focused element has no ring, a ring under 2 px, or a ring under 3:1 against its background. */
async function checkFocus(page: Page, findings: Set<string>): Promise<void> {
  const focused = await ringOfFocus(page);
  if (!focused) return;
  const { label, ring } = focused;
  if (ring.kind === "none") findings.add(`${label}: no focus indicator`);
  else if (ring.width < 2) findings.add(`${label}: focus ring ${ring.width}px`);
  else {
    const contrast = ratio(ring.color, ring.background);
    if (contrast < 3) findings.add(`${label}: focus ring contrast ${contrast.toFixed(2)}:1`);
  }
}

/** Moves focus with Tab only until the target has it, checking the ring of every element passed on the way. */
async function tabTo(page: Page, target: Locator, findings: Set<string>): Promise<void> {
  await target.waitFor({ state: "visible" });
  const handle = await target.elementHandle();
  if (!handle) throw new Error("Keyboard target disappeared.");
  for (let index = 0; index < 220; index += 1) {
    if (await handle.evaluate((element) => element === document.activeElement)) {
      await checkFocus(page, findings);
      return;
    }
    await page.keyboard.press("Tab");
    await checkFocus(page, findings);
  }
  throw new Error("Keyboard traversal did not reach the target control.");
}

/** Lets React finish the state update that follows a native close event before the next key. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function typeInto(page: Page, target: Locator, text: string, findings: Set<string>): Promise<void> {
  await tabTo(page, target, findings);
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(text);
}

async function activate(page: Page, target: Locator, findings: Set<string>, key = "Enter"): Promise<void> {
  await tabTo(page, target, findings);
  await page.keyboard.press(key);
}

test("sign in, Quick log, save an activity, confirm an achievement, add it to the CV and open the preview with the keyboard only", async ({ page }, testInfo) => {
  const findings = new Set<string>();
  const note = "Menyusun ringkasan laporan bulanan untuk tim penjualan.";

  await page.goto("/sign-in");
  await typeInto(page, page.locator('input[type="email"]'), journeyUser.email, findings);
  await typeInto(page, page.locator('input[type="password"]').first(), journeyUser.password, findings);
  await activate(page, page.getByRole("button", { name: /^(Sign in|Masuk)$/ }), findings);
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.waitForLoadState("networkidle");
  await page.keyboard.press("Tab");
  await expect(page.locator(".skip-link")).toBeFocused();
  await checkFocus(page, findings);

  await activate(page, page.locator(".workspace-topbar").getByRole("link", { name: "Quick log", exact: true }), findings);
  await expect(page).toHaveURL(/\/activity\/new/);
  await expect(page.locator("#quick-log-note")).toBeFocused();
  await checkFocus(page, findings);
  await page.keyboard.type(note);
  await activate(page, page.locator("#quick-log-note-form button[type='submit']"), findings);
  await expect(page).toHaveURL(/\/activity\/[0-9a-f-]{36}/i);

  await activate(page, page.getByRole("link", { name: "Create Achievement", exact: true }), findings);
  await expect(page).toHaveURL(/\/achievements\/new\?/);
  await activate(page, page.getByRole("button", { name: "New Achievement", exact: true }), findings);
  await expect(page).toHaveURL(/\/achievements\/[0-9a-f-]{36}/i);
  await page.waitForLoadState("networkidle");
  await typeInto(page, page.getByLabel("Title", { exact: true }), "Ringkasan laporan bulanan", findings);
  await typeInto(page, page.getByLabel("Contribution", { exact: true }), "Menyusun dan membagikan ringkasan laporan bulanan", findings);
  await typeInto(page, page.getByLabel("Outcome", { exact: true }), "Tim penjualan membaca ringkasan tanpa rapat tambahan", findings);
  const achievedOn = page.getByLabel("Achieved on", { exact: true });
  // The native date control follows the operating system's segment order; try day first, then month first.
  for (const digits of ["20092026", "09202026"]) {
    await tabTo(page, achievedOn, findings);
    await page.keyboard.type(digits);
    if (await achievedOn.inputValue() === "2026-09-20") break;
    for (let back = 0; back < 3; back += 1) await page.keyboard.press("Shift+Tab");
  }
  await expect(achievedOn).toHaveValue("2026-09-20");
  await activate(page, page.getByRole("button", { name: "Confirm Achievement", exact: true }), findings);
  await expect(page.getByText("Achievement confirmed and eligible for future CV selection.", { exact: true }).first()).toBeVisible();

  await activate(page, page.getByRole("link", { name: "Add to CV" }), findings);
  await expect(page).toHaveURL(/\/cv\?highlight=[0-9a-f-]{36}$/i);
  const add = page.getByRole("button", { name: /^Add .* to CV$/ });
  await expect(add).toBeFocused();
  await checkFocus(page, findings);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /is already on the CV$/ })).toBeVisible();

  await activate(page, page.getByTestId("cv-preview-export-link"), findings);
  await expect(page).toHaveURL(/\/cv\/preview$/);
  await expect(page.getByTestId("cv-export-revision")).toContainText("Saved revision");

  await testInfo.attach("focus-findings.json", { body: JSON.stringify([...findings], null, 2), contentType: "application/json" });
  expect([...findings], "focus indicator findings along the journey").toEqual([]);
});

test("every dialog opens with Enter or Space, closes with Escape and gives focus back to its trigger", async ({ page }, testInfo) => {
  const findings = new Set<string>();
  await signIn(page, richUser, "/dashboard");

  // T27 mobile sheets: the Quick log composer from the tab bar and the More menu on Profile.
  await page.setViewportSize({ width: 360, height: 820 });
  for (const [path, trigger, sheetName] of [
    ["/dashboard", page.getByRole("navigation", { name: "Main tabs" }).getByRole("button", { name: "Quick log", exact: true }), "Quick log"],
    ["/settings/profile", page.getByRole("button", { name: "Open more menu" }), "More"],
  ] as const) {
    await page.goto(path);
    const sheet = page.getByRole("dialog", { name: sheetName });
    for (const key of ["Enter", "Space"]) {
      await activate(page, trigger, findings, key);
      await expect(sheet, `${sheetName} opens with ${key}`).toBeVisible();
      if (sheetName === "Quick log") await expect(sheet.getByLabel("Work note"), "the note takes focus").toBeFocused();
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
      await expect(trigger, `focus returns to the ${sheetName} trigger after ${key}`).toBeFocused();
      await settle(page);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // A named delete dialog on the project detail.
  await page.goto(`/projects/${career.emptyProjectId}`);
  await page.waitForLoadState("networkidle");
  const deleteTrigger = page.locator(".ui-delete-trigger").first();
  const deleteDialog = page.getByRole("dialog", { name: /Delete/i });
  await activate(page, deleteTrigger, findings);
  await expect(deleteDialog).toBeVisible();
  await expect(deleteDialog).toContainText("Riset Pelanggan");
  await page.keyboard.press("Escape");
  await expect(deleteDialog).toBeHidden();
  await expect(deleteTrigger).toBeFocused();
  await settle(page);
  await activate(page, deleteTrigger, findings, "Space");
  await expect(deleteDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(deleteTrigger).toBeFocused();

  // The unsaved changes dialog: a dirty profile form, then a navigation link.
  await page.goto("/settings/profile");
  await page.waitForLoadState("networkidle");
  await typeInto(page, page.getByLabel("Headline"), "Analis data yang menulis laporan", findings);
  const activityLink = page.locator(".workspace-sidebar").getByRole("link", { name: "Activity", exact: true });
  await activate(page, activityLink, findings);
  const unsaved = page.getByRole("dialog", { name: "Leave without saving?" });
  await expect(unsaved).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(unsaved).toBeHidden();
  await expect(page).toHaveURL(/\/settings\/profile$/);
  await expect(activityLink).toBeFocused();

  // The account deletion dialog.
  await page.goto("/settings/profile");
  await page.waitForLoadState("networkidle");
  const deleteAccount = page.getByRole("button", { name: "Delete account", exact: true });
  const accountDialog = page.getByRole("dialog");
  await activate(page, deleteAccount, findings);
  await expect(accountDialog).toBeVisible();
  await expect(page.locator("#delete-account-password")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(accountDialog).toBeHidden();
  await expect(deleteAccount).toBeFocused();
  await settle(page);
  await activate(page, deleteAccount, findings, "Space");
  await expect(accountDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(deleteAccount).toBeFocused();

  await testInfo.attach("focus-findings.json", { body: JSON.stringify([...findings], null, 2), contentType: "application/json" });
  expect([...findings], "focus indicator findings across the dialogs").toEqual([]);
});

test("a revision conflict is announced and resolved with the keyboard", async ({ page, browser }, testInfo) => {
  const findings = new Set<string>();
  await signIn(page, richUser, `/activity/${career.activityId}`);
  await page.waitForLoadState("networkidle");

  const context = await browser.newContext({ baseURL: String(testInfo.project.use.baseURL), storageState: await page.context().storageState() });
  const other = await context.newPage();
  try {
    await other.goto(`/activity/${career.activityId}`);
    await other.waitForLoadState("networkidle");
    await other.getByRole("button", { name: "Edit activity" }).click();
    await other.locator("textarea[name='raw_text']").fill("Catatan dari tab kedua");

    await page.getByRole("button", { name: "Edit activity" }).click();
    await page.locator("textarea[name='raw_text']").fill("Catatan dari tab pertama");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.locator(".activity-detail-source").first()).toHaveText("Catatan dari tab pertama");

    await activate(other, other.getByRole("button", { name: "Save changes" }), findings);
    await expect(other.getByRole("heading", { name: "This activity changed in another tab" })).toBeVisible();
    await expect(other.locator("textarea[name='raw_text']")).toHaveValue("Catatan dari tab kedua");
    await activate(other, other.getByRole("button", { name: "Review and retry my changes" }), findings);
    await expect(other.locator(".activity-detail-source").first()).toHaveText("Catatan dari tab kedua");
  } finally {
    await context.close();
  }
  expect([...findings], "focus indicator findings on the conflict path").toEqual([]);
});

test("S12 says that actions are recorded without their content, in English and in Indonesian", async ({ browser }, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  for (const [user, sentence, lang, heading] of [
    [richUser, EVENT_NOTICE_EN, "en", "Privacy and account"],
    [indoUser, EVENT_NOTICE_ID, "id", "Privasi dan akun"],
  ] as const) {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    try {
      await signIn(page, user, "/dashboard");
      await page.goto("/settings/profile");
      await expect(page.getByRole("heading", { name: heading, level: 2 })).toBeVisible();
      await expect(page.getByText(sentence, { exact: true })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
    } finally {
      await context.close();
    }
  }
});

test("the focus check reports a missing ring, a thin ring and a ring that is hard to see", async ({ page }) => {
  const cases: [string, string, RegExp][] = [
    ["no ring", '<button style="outline: none; box-shadow: none">Simpan</button>', /no focus indicator/],
    ["thin ring", '<button style="outline: 1px solid #000">Simpan</button>', /focus ring 1px/],
    ["pale ring", '<button style="outline: 2px solid #f3f3f3; outline-offset: 2px">Simpan</button>', /focus ring contrast/],
  ];
  for (const [name, markup, expected] of cases) {
    await page.setContent(`<!doctype html><html lang="en"><body style="background:#ffffff">${markup}</body></html>`);
    await page.keyboard.press("Tab");
    const findings = new Set<string>();
    await checkFocus(page, findings);
    expect([...findings].join(" "), name).toMatch(expected);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  }
  await page.setContent('<!doctype html><html lang="en"><body style="background:#ffffff"><button style="outline: 2px solid #1a211c; outline-offset: 2px">Simpan</button></body></html>');
  await page.keyboard.press("Tab");
  const clean = new Set<string>();
  await checkFocus(page, clean);
  expect([...clean], "a dark two pixel ring is accepted").toEqual([]);
});