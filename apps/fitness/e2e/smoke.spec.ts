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

  test("first look is a short editorial dashboard", async ({ page }) => {
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

    const appNav = page.getByRole("navigation", { name: "App sections" });
    await expect(appNav.getByRole("button", { name: "Dashboard" })).toBeVisible();
    await expect(appNav.getByRole("button", { name: "Log", exact: true })).toBeVisible();
    await expect(appNav.getByRole("button", { name: "Planner" })).toBeVisible();
    await expect(appNav.getByRole("button", { name: "Progress" })).toBeVisible();
    await expect(appNav.getByRole("button", { name: "More" })).toBeVisible();
    await expect(page.locator("#navMore")).toBeHidden();
    await expect(page.locator("#navMoreToggle")).toHaveAttribute("aria-expanded", "false");
    for (const room of ["Calendar", "Goals", "Profile", "Sports", "Golf GPS", "Library", "Programs", "Compare"]) {
      await expect(appNav.getByRole("button", { name: room })).toBeHidden();
    }
    await expect(page.getByRole("heading", { name: "Hybrid training cockpit" })).toHaveCount(0);

    const viewport = page.viewportSize();
    const logSession = page.getByRole("button", { name: /Log session/ }).first();
    await expect(logSession).toBeVisible();
    const logBox = await logSession.boundingBox();
    expect(logBox).toBeTruthy();
    expect(logBox.y + logBox.height).toBeLessThan(viewport.height);

    const checkin = page.getByRole("heading", { name: /how you feel today/i });
    const checkinBox = await checkin.boundingBox();
    expect(checkinBox).toBeTruthy();
    expect(checkinBox.y).toBeGreaterThan(viewport.height);
  });

  test("1024px first viewport is one primary row with More closed", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/");
    const appNav = page.getByRole("navigation", { name: "App sections" });
    const more = page.locator("#navMore");
    await expect(more).toBeHidden();
    await expect(more).not.toHaveClass(/is-open/);
    expect(await more.evaluate((el) => getComputedStyle(el).display)).toBe("none");
    for (const room of ["Golf GPS", "Library", "Compare", "Calendar", "Sports"]) {
      await expect(appNav.getByRole("button", { name: room })).toBeHidden();
    }
    const labels = ["Dashboard", "Log", "Planner", "Progress", "More"] as const;
    const boxes = [];
    for (const label of labels) {
      const name = label === "Log" ? { name: "Log", exact: true } : { name: label };
      const box = await appNav.getByRole("button", name).boundingBox();
      expect(box, `${label} should be on the first viewport`).toBeTruthy();
      boxes.push(box);
    }
    const tops = boxes.map((box) => box!.y);
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(8);
    expect(boxes).toHaveLength(5);
  });

  test("More reveals secondary rooms without deleting them", async ({ page }) => {
    await page.goto("/");
    const appNav = page.getByRole("navigation", { name: "App sections" });
    await page.locator("#navMoreToggle").click();
    await expect(page.locator("#navMore")).toBeVisible();
    await expect(appNav.getByRole("button", { name: "Sports" })).toBeVisible();
    await expect(appNav.getByRole("button", { name: "Golf GPS" })).toBeVisible();
    await expect(appNav.getByRole("button", { name: "Library" })).toBeVisible();
    await expect(appNav.getByRole("button", { name: "Programs" })).toBeVisible();
    await expect(appNav.getByRole("button", { name: "Compare" })).toBeVisible();
    await expect(appNav.getByRole("button", { name: "Profile" })).toBeVisible();
    await appNav.getByRole("button", { name: "Sports" }).click();
    await expect(page.locator("#sports")).toBeVisible();
  });

  test("log workout view still exposes sport templates", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Log session/ }).first().click();
    await expect(page.locator("#log")).toBeVisible();
    await expect(page.locator("#sessionType")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Fitness", exact: true })).toBeHidden();
    await expect(page.getByRole("button", { name: /Log session/ }).first()).toBeVisible();
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
