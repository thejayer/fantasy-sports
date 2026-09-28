import { expect, test } from "@playwright/test";

/**
 * Auth gate smoke (roadmap 1.2). Run with AUTH_DEV_BYPASS unset/0 so middleware
 * forces unauthenticated visitors onto /login.
 */
test.describe("auth redirect", () => {
  test("protected leagues route redirects to login with callbackUrl", async ({
    page,
  }) => {
    await page.goto("/leagues");
    await expect(page).toHaveURL(/\/login/);
    const url = new URL(page.url());
    expect(url.searchParams.get("callbackUrl")).toMatch(/\/leagues/);
    await expect(
      page.getByRole("heading", { name: "Sign in to Fantasy" }),
    ).toBeVisible();
    await expect(page.getByText(/same Strictly Jayers Google allowlist/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Continue with Google/i }),
    ).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Strictly Jayers" })).toBeVisible();
  });
});
