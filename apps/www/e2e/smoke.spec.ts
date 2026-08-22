import { expect, test } from "@playwright/test";

/**
 * Portal smoke (roadmap P.7 / P.8): home handoffs, Watch embed, AI editor desk, People.
 */

test.describe("portal smoke", () => {
  test("home CTAs and destinations", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("link", { name: /Open fantasy hub/i }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Where to go/i }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /Leagues & tools/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /People/i }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Fitness/i }).first()).toBeVisible();
    await expect(page.getByText(/Details soon/i)).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Coming up/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Meet the crew/i }),
    ).toBeVisible();
  });

  test("watch embed and tonight framing", async ({ page }) => {
    await page.goto("/watch");
    await expect(page.getByRole("heading", { name: /^Watch$/i })).toBeVisible();
    await expect(
      page.locator('iframe[title="Strictly Jayers YouTube playlist"]'),
    ).toBeVisible();
    // Tonight's pick and its "Drop a clip" CTA need playlist RSS. The player
    // section still exposes Discord when the feed is empty.
    const tonight = page.getByRole("heading", { name: /Tonight’s pick/i });
    if (await tonight.isVisible().catch(() => false)) {
      await expect(tonight).toBeVisible();
      await expect(
        page.getByRole("link", { name: /Drop a clip in Discord/i }),
      ).toBeVisible();
    }
    await expect(
      page.getByRole("link", { name: /Discord voice/i }).first(),
    ).toBeVisible();
  });

  test("ai editor picks desk", async ({ page }) => {
    await page.goto("/ai");
    await expect(
      page.getByRole("heading", { name: "AI News", exact: true }),
    ).toBeVisible();
    const picks = page.locator("section").filter({
      has: page.getByRole("heading", { name: /Big stories/i }),
    });
    await expect(picks.getByText(/Editor desk/i)).toBeVisible();
    await expect(
      picks.getByRole("link", { name: /AMIE tries real-time/i }),
    ).toBeVisible();
    await expect(
      picks.getByRole("link", { name: /Testing ads in ChatGPT/i }),
    ).toBeVisible();
  });

  test("people directory links to X", async ({ page }) => {
    await page.goto("/people");
    await expect(
      page.getByRole("heading", { name: "People", exact: true }),
    ).toBeVisible();
    const elon = page.getByRole("link", { name: "Follow Elon Musk on X" });
    await expect(elon).toBeVisible();
    await expect(elon).toHaveAttribute("href", "https://x.com/elonmusk");
    const jensen = page.getByRole("link", { name: "Follow Jensen Huang on X" });
    await expect(jensen).toBeVisible();
    await expect(jensen).toHaveAttribute("href", "https://x.com/JensenHuang");
    const elonCard = page.locator(".people-card").filter({ hasText: "Elon Musk" });
    await expect(elonCard.locator("img")).toBeVisible();
    await expect(page.getByRole("link", { name: /Fitness/i }).first()).toBeVisible();
  });
});
