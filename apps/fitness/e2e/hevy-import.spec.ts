import { expect, test } from "@playwright/test";
import path from "node:path";

test.describe("Hevy CSV import", () => {
  test("imports workouts for the signed-in member and skips a re-import", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("body[data-fitness-ready='1']")).toBeVisible({
      timeout: 15_000,
    });

    await page.locator("#navMoreToggle").click();
    await page.getByRole("navigation", { name: "App sections" }).getByRole("button", {
      name: "Profile",
    }).click();
    await expect(page.locator("#profile")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Import Hevy workouts" })).toBeVisible();

    await page.locator("#hevyCsvFile").setInputFiles(
      path.join(__dirname, "../tests/fixtures/hevy_workouts.csv"),
    );
    await expect(page.locator("#hevyCsvText")).toHaveValue(/Push Day/);
    await page.getByRole("button", { name: "Import Hevy CSV" }).click();
    await expect(page.locator("#hevyImportStatus")).toHaveText(
      "2 workouts imported, 0 skipped",
    );

    const prefix = await page.evaluate(() => {
      const identity = (
        window as Window & { __sjFitness?: { storagePrefix?: string } }
      ).__sjFitness;
      return identity?.storagePrefix ?? null;
    });
    expect(prefix).toMatch(/^athleteLog\.[a-f0-9]{32}$/);
    const anon = await page.evaluate(() => localStorage.getItem("athleteLog.sessions.v1"));
    expect(anon).toBeNull();
    const stored = await page.evaluate(
      (key) => localStorage.getItem(`${key}.sessions.v1`),
      prefix,
    );
    expect(stored).toContain("hevy:ts:push-day");
    expect(stored).toContain("Bench Press (Barbell)");

    await expect
      .poll(async () => {
        const response = await page.request.get("/api/me");
        if (!response.ok()) return 0;
        const body = (await response.json()) as {
          document: { slices: { sessions: Array<{ importKey?: string }> } };
        };
        return body.document.slices.sessions.filter((session) =>
          String(session.importKey || "").startsWith("hevy:"),
        ).length;
      })
      .toBe(2);

    await page.getByRole("button", { name: "Import Hevy CSV" }).click();
    await expect(page.locator("#hevyImportStatus")).toHaveText(
      "0 workouts imported, 2 skipped",
    );

    const after = await page.request.get("/api/me");
    const afterBody = (await after.json()) as {
      user: { email: string };
      document: { slices: { sessions: Array<{ importKey?: string }> } };
    };
    expect(afterBody.user.email).toBe("demo@example.com");
    expect(
      afterBody.document.slices.sessions.filter((session) =>
        String(session.importKey || "").startsWith("hevy:"),
      ),
    ).toHaveLength(2);
  });
});
