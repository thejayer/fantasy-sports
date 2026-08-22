import { expect, test } from "@playwright/test";

test.describe("fitness smoke", () => {
  test("health probe", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.ok()).toBeTruthy();
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      service: "sj-fitness",
    });
  });

  test("training log chrome and dashboard", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Fitness · Strictly Jayers/);
    await expect(
      page.getByRole("link", { name: "Strictly Jayers" }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Strictly Jayers" }).getByText("Fitness"),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Fitness", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /rotational power/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Log Workout/i }),
    ).toBeVisible();
  });

  test("log workout view still exposes sport templates", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Log Workout/i }).first().click();
    await expect(page.locator("#log")).toBeVisible();
    await expect(page.locator("#sessionType")).toBeVisible();
  });

  test("PWA manifest uses Signal Red, not Texas Tech red", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest");
    expect(response.ok()).toBeTruthy();
    const manifest = await response.json();
    expect(manifest.name).toBe("Strictly Jayers Fitness");
    expect(manifest.theme_color).toBe("#ec3013");
    expect(manifest.theme_color).not.toBe("#cc0000");
  });
});
