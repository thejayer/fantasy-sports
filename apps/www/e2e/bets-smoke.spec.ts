import { expect, test } from "@playwright/test";

/**
 * Signed-in /bets (AUTH_DEV_BYPASS=1) against committed fixture data.
 */
test.describe("bets fixture board", () => {
  test("renders data-driven cards, tabs, caveats, and the feed", async ({ page }) => {
    await page.goto("/bets");
    await expect(page.getByRole("heading", { name: "Bets", exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Bet tracker sections" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Parlay legs" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Public fade" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Record splits" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Tail legs" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Options" })).toBeVisible();
    await expect(page.getByRole("article").filter({ hasText: "All bettors" })).toBeVisible();
    await expect(page.getByRole("article").filter({ hasText: "@BookitWithTrent" })).toBeVisible();
    await expect(page.getByRole("article").filter({ hasText: "@stevewilldoit" })).toBeVisible();
    await expect(page.getByRole("article").filter({ hasText: "@btidy216" })).toBeVisible();
    await expect(page.getByRole("article").filter({ hasText: "@chellgod" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent bets" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: /Caveats/i })).toBeVisible();
    await expect(page.getByText(/Last synced/i)).toBeVisible();
    await expect(page.getByRole("link", { name: "Since NFL start" })).toBeVisible();
    await expect(page.locator(".bets-feed-item").first()).toBeVisible();
  });

  test("parlay legs and public fade tabs render", async ({ page }) => {
    await page.goto("/bets?tab=parlays");
    await expect(page.getByRole("heading", { name: "Recent legs" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Props vs team picks" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Parlay filters" })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Parlay filters" }).getByRole("link", { name: "Since NFL start" }),
    ).toBeVisible();
    await page.goto("/bets?tab=splits");
    await expect(page.getByRole("heading", { name: "All bettors" }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Record splits" }).first()).toBeVisible();
    await expect(page.getByText(/1u fade/i).first()).toBeVisible();
    await expect(page.getByText(/Fade edge/i).first()).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Record split filters" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sheet checks" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Bets tab record" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Bets check" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Legs check" })).toBeVisible();
    await page.goto("/bets?tab=tail");
    await expect(page.getByRole("navigation", { name: "Tail-leg filters" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "By sport" })).toBeVisible();
    await expect(page.getByText(/Tail @/).first()).toBeVisible();
    await expect(page.getByText(/Priced sportsbook legs/i).first()).toBeVisible();
    await expect(page.getByText(/approximate/i).first()).toBeVisible();
    await page.goto("/bets?tab=options");
    await expect(page.getByRole("navigation", { name: "Options filters" })).toBeVisible();
    await expect(page.getByRole("article").filter({ hasText: "Sample Trader A" })).toBeVisible();
    await expect(page.getByRole("article").filter({ hasText: "Sample Trader B" })).toBeVisible();
    await expect(page.getByText("not posted").first()).toBeVisible();
    await expect(page.getByRole("img", { name: /Cumulative posted P\/L/i }).first()).toBeVisible();
    await expect(page.getByText(/posted screenshots and fills/i)).toBeVisible();
    await page.goto("/bets?tab=warnings");
    await expect(page.getByRole("heading", { name: "Fade the public" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent warnings" })).toBeVisible();
    await expect(page.getByText(/assumes -110/i)).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Public warning filters" })).toBeVisible();
    await expect(
      page
        .getByRole("navigation", { name: "Public warning filters" })
        .getByRole("link", { name: "Since NFL start" }),
    ).toBeVisible();
  });
});
