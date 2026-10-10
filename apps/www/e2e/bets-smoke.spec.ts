import { expect, test } from "@playwright/test";

/**
 * Signed-in /bets (AUTH_DEV_BYPASS=1) against committed fixture data.
 */
test.describe("bets fixture board", () => {
  test("renders Trent/Steve cards, caveats, and the feed", async ({ page }) => {
    await page.goto("/bets");
    await expect(page.getByRole("heading", { name: "Bets", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Trent Attyah" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Steve Will Do It" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent bets" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: /Caveats/i })).toBeVisible();
    await expect(page.getByText(/Last synced/i)).toBeVisible();
    await expect(page.getByRole("link", { name: "Since NFL start" })).toBeVisible();
    await expect(page.locator(".bets-feed-item").first()).toBeVisible();
  });
});
