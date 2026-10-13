import { expect, test } from "@playwright/test";

test.describe("vibe smoke", () => {
  test("health probe", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.ok()).toBeTruthy();
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      service: "sj-vibe",
    });
  });

  test("home shows this week's vibe board", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /coded while lifting/i })).toBeVisible();
    await expect(page.getByText(/week vibe/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /vibe split/i })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "App" }).getByRole("link", { name: "Home" }),
    ).toBeVisible();
  });

  test("workout detail has a timeline", async ({ page }) => {
    await page.goto("/");
    const first = page.locator("a.card-row").first();
    await expect(first).toBeVisible();
    await first.click();
    await expect(page.getByRole("heading", { name: /timeline/i })).toBeVisible();
    await expect(page.getByLabel("Workout timeline")).toBeVisible();
  });
});
