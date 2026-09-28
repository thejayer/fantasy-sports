import { expect, test } from "@playwright/test";

/**
 * Auth gate. Run with AUTH_DEV_BYPASS=0 so guests hit the sign-in wall.
 */
test.describe("auth redirect", () => {
  test("training log redirects to login with callbackUrl", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    const url = new URL(page.url());
    expect(url.searchParams.get("callbackUrl")).toMatch(/^\//);
    await expect(
      page.getByRole("heading", { name: "Sign in to Fitness" }),
    ).toBeVisible();
    await expect(page.getByText(/same Strictly Jayers Google allowlist/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Continue with Google/i }),
    ).toBeVisible();
  });

  test("member API rejects anonymous reads", async ({ request }) => {
    const response = await request.get("/api/me", { maxRedirects: 0 });
    expect(response.status()).toBe(401);
    expect(response.headers()["content-type"] || "").toMatch(/json/);
    await expect(response.json()).resolves.toMatchObject({
      error: "sign in required",
    });
  });
});
