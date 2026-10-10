import { expect, test } from "@playwright/test";

/**
 * Auth gate for /bets. Run with AUTH_DEV_BYPASS=0 so guests hit sign-in.
 */
test.describe("bets auth redirect", () => {
  test("signed-out /bets redirects to sign-in", async ({ page }) => {
    await page.goto("/bets");
    await expect(page).toHaveURL(/\/login/);
    const url = new URL(page.url());
    expect(url.searchParams.get("callbackUrl")).toMatch(/^\/bets/);
    await expect(
      page.getByRole("heading", { name: "Sign in to Bets" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Continue with Google/i }),
    ).toBeVisible();
  });

  test("home stays public", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /Where to go/i }),
    ).toBeVisible();
  });
});
