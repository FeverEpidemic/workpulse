import { expect, test } from "@playwright/test";

test("anonymous root request routes to sign-in", async ({ page }) => {
  const response = await page.goto("/");

  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("heading", { level: 1, name: "Your work deserves to be remembered." })).toBeVisible();
  expect(await page.title()).toBe("WorkPulse");
});

test("GET /api/health keeps its public contract", async ({ request }) => {
  const response = await request.get("/api/health");

  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(response.headers()["content-type"]).toContain("application/json");
  await expect(response.json()).resolves.toEqual({
    status: "ok",
    service: "workpulse-web",
    version: "0.1.0",
  });
});
