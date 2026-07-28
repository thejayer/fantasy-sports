import { expect, test } from "@playwright/test";

/**
 * Fixture-backed smoke paths (roadmap 1.2). Requires AUTH_DEV_BYPASS=1 and
 * committed fixtures/sj (forced via SJ_DATA_DIR in playwright.config.ts).
 */
test.describe("hub smoke", () => {
  test("leagues list shows the three Strictly Jayers leagues", async ({
    page,
  }) => {
    await page.goto("/leagues");
    await expect(page.getByRole("heading", { name: /leagues/i })).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Strictly Jayers Football(?! Dynasty)/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Strictly Jayers Football Dynasty/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Strictly Jayers Baseball/ }),
    ).toBeVisible();
  });

  test("football standings render fixture team names", async ({ page }) => {
    await page.goto("/leagues/football-main");
    await expect(page.getByText("Gridiron Goons")).toBeVisible();
    await expect(page.getByText("End Zone Enforcers")).toBeVisible();
    await expect(page.getByRole("link", { name: "Standings" })).toBeVisible();
  });

  test("team roster page lists players", async ({ page }) => {
    await page.goto("/leagues/football-main/teams/1");
    await expect(page.getByRole("heading", { name: "Gridiron Goons" })).toBeVisible();
    // First roster player on team_id 1 in committed football-main/2026.json.
    await expect(page.getByText("Juan Phillips")).toBeVisible();
  });

  test("unknown league and team return the not-found panel", async ({
    page,
  }) => {
    await page.goto("/leagues/no-such-league");
    await expect(page.getByText("That page is not here.")).toBeVisible();

    await page.goto("/leagues/football-main/teams/999");
    await expect(page.getByText("That page is not here.")).toBeVisible();
  });

  test("login redirects home when AUTH_DEV_BYPASS is on", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveURL(/\/($|\?)/);
  });

  test("projections tab shows season VOR board", async ({ page }) => {
    await page.goto("/leagues/football-main?tab=projections");
    await expect(page.getByText(/Season projections/i)).toBeVisible();
    await expect(page.getByText("Patrick Mahomes")).toBeVisible();
  });

  test("tools playoff-odds board renders fixture make probs", async ({
    page,
  }) => {
    await page.goto("/leagues/football-main?tab=tools&view=playoff-odds");
    await expect(page.getByText(/Make-playoffs Monte Carlo/i)).toBeVisible();
    await expect(page.getByText("Hail Mary Heroes")).toBeVisible();
  });

  test("tools draft slot 1 shows exported snapshot chips only", async ({
    page,
  }) => {
    await page.goto("/leagues/football-main?tab=tools&view=draft&slot=1");
    await expect(page.getByRole("heading", { name: "Who you land" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Slot 1", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Slot 2", exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("cell", { name: "QB Fixture 1", exact: true }).first(),
    ).toBeVisible();
  });

  test("tools waivers board lists ESPN free agents", async ({ page }) => {
    await page.goto("/leagues/football-main?tab=tools&view=waivers");
    await expect(page.getByText(/ESPN free agents/i)).toBeVisible();
    await expect(page.getByText("Alexander White")).toBeVisible();
  });

  test("tools start/sit uses typical-week posteriors", async ({ page }) => {
    await page.goto("/leagues/football-main?tab=tools&view=start-sit");
    await expect(page.getByText(/Typical-week posteriors/i)).toBeVisible();
    // Fixture overlay maps roster ESPN id → weekly Mahomes GSIS; UI keeps roster name.
    await expect(page.getByText("Roy Thompson")).toBeVisible();
  });

  test("draft results tab shows ESPN picks", async ({ page }) => {
    await page.goto("/leagues/football-main?tab=draft");
    await expect(page.getByText(/ESPN draft results/i)).toBeVisible();
    await expect(page.getByText("Juan Phillips")).toBeVisible();
  });

  test("activity tab lists transactions", async ({ page }) => {
    await page.goto("/leagues/football-main?tab=activity");
    await expect(page.getByText(/League activity from ESPN/i)).toBeVisible();
    await expect(page.getByText("FA ADDED")).toBeVisible();
  });

  test("baseball waivers tab lists free agents", async ({ page }) => {
    await page.goto("/leagues/baseball-dynasty?tab=waivers");
    await expect(page.getByText(/ESPN free agents/i)).toBeVisible();
    await expect(page.getByText("Wayne Morales")).toBeVisible();
  });
});
