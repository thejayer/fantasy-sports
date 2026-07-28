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
});
