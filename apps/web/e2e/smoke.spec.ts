import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Fixture-backed smoke paths (roadmap 1.2). Requires AUTH_DEV_BYPASS=1 and
 * committed fixtures/sj (forced via SJ_DATA_DIR in playwright.config.ts).
 * Hub-native writes (golf create, members) go to SJ_HUB_DIR (.playwright-hub-data).
 */

const HUB_DIR = path.resolve(__dirname, "../.playwright-hub-data");
test.describe("hub smoke", () => {
  test("leagues list shows Strictly Jayers leagues including golf", async ({
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
    await expect(
      page.getByRole("link", { name: /Strictly Jayers Golf/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Create golf league/i }),
    ).toBeVisible();
  });

  test("golf league settings tab shows counting knobs", async ({ page }) => {
    await page.goto("/leagues/golf-main?tab=settings");
    await expect(page.getByRole("heading", { name: /Strictly Jayers Golf/i })).toBeVisible();
    await expect(page.getByText(/League settings/i)).toBeVisible();
    await expect(page.getByText(/Missed cut/i)).toBeVisible();
    await expect(page.getByText(/Event multipliers/i)).toBeVisible();
    await expect(page.getByText(/no live tour feed/i)).toBeVisible();
  });

  test("golf draft tab shows OWGR snake picks", async ({ page }) => {
    await page.goto("/leagues/golf-main?tab=draft");
    await expect(page.getByText(/OWGR snake draft · \d+ picks/i)).toBeVisible();
    await expect(page.getByText("Scottie Scheffler").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "All teams" })).toBeVisible();
  });

  test("live golf auction room nominate and sell", async ({ page }) => {
    const slug = `golf-live-${Date.now().toString(36).slice(-6)}`;
    await page.goto("/leagues/new");
    await page.locator('input[name="league_id"]').fill(slug);
    await page.locator('input[name="name"]').fill("Live Auction");
    await page.locator('select[name="draft_style"]').selectOption("auction");
    await page.getByText(/Live nomination room/i).click();
    await page.locator('input[name="team_count"]').fill("6");
    await page.locator('input[name="bench"]').fill("2");
    await page.getByRole("button", { name: /Create golf league/i }).click();
    await page.waitForURL(new RegExp(`/leagues/${slug}.*tab=auction`));
    const openRoom = page.getByRole("button", { name: /Open auction room/i });
    if (await openRoom.isVisible().catch(() => false)) {
      await openRoom.click();
    }
    await expect(page.getByText(/Live OWGR auction/i)).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: /Start auction/i }).click();
    await expect(page.getByText(/Nominate/i).first()).toBeVisible();
    await page.locator("select").filter({ hasText: /Scheffler|Select/ }).last().selectOption({ index: 1 });
    await page.getByRole("button", { name: /^Nominate$/i }).click();
    await expect(page.getByText(/Bidding/i).first()).toBeVisible();
    // Switch acting team to team 2 and bid, then pass others via timer/pass.
    await page.getByLabel(/Acting team/i).selectOption({ index: 1 });
    await page.getByRole("button", { name: /\+\$1/i }).click();
    await expect(page.getByText(/high bid/i)).toBeVisible();
    // Remaining teams pass until sold.
    for (const idx of [0, 2, 3, 4, 5]) {
      await page.getByLabel(/Acting team/i).selectOption({ index: idx });
      const pass = page.getByRole("button", { name: /^Pass$/i });
      if (await pass.isVisible().catch(() => false)) {
        await pass.click();
      }
    }
    await expect(page.getByRole("heading", { name: /^Sold$/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Scottie Scheffler").first()).toBeVisible();

    fs.rmSync(path.join(HUB_DIR, slug), { recursive: true, force: true });
    const indexPath = path.join(HUB_DIR, "index.json");
    try {
      const index = JSON.parse(fs.readFileSync(indexPath, "utf8")) as {
        leagues?: Array<{ league_id?: string }>;
      };
      index.leagues = (index.leagues ?? []).filter(
        (row) => row.league_id !== slug,
      );
      fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
    } catch {
      /* ignore */
    }
  });

  test("create golf auction league shows bids and keepers", async ({ page }) => {
    const slug = `golf-auc-${Date.now().toString(36).slice(-6)}`;
    await page.goto("/leagues/new");
    await page.locator('input[name="league_id"]').fill(slug);
    await page.locator('input[name="name"]').fill("Auction Demo");
    await page.locator('select[name="draft_style"]').selectOption("auction");
    await page.locator('input[name="keepers"]').check();
    await page.locator('input[name="team_count"]').fill("6");
    await page.locator('input[name="bench"]').fill("4");
    await page.getByRole("button", { name: /Create golf league/i }).click();
    await page.waitForURL(new RegExp(`/leagues/${slug}`));
    await expect(page.getByText(/OWGR auction/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: /Auction budgets/i })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Bid", exact: true })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Keeper", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Yes" }).first()).toBeVisible();

    // Create writes under SJ_HUB_DIR — remove ephemeral league.
    fs.rmSync(path.join(HUB_DIR, slug), { recursive: true, force: true });
    const indexPath = path.join(HUB_DIR, "index.json");
    try {
      const index = JSON.parse(fs.readFileSync(indexPath, "utf8")) as {
        generated_at?: string;
        leagues?: Array<{ league_id?: string }>;
      };
      index.leagues = (index.leagues ?? []).filter(
        (row) => row.league_id !== slug,
      );
      fs.writeFileSync(
        indexPath,
        `${JSON.stringify(index, null, 2)}\n`,
      );
    } catch {
      /* ignore missing index */
    }
  });

  test("golf team roster shows GS and OWGR", async ({ page }) => {
    await page.goto("/leagues/golf-main/teams/1");
    await expect(page.getByRole("heading", { name: /Fairway Phantoms/i })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Scottie Scheffler" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "OWGR" }).first()).toBeVisible();
  });

  test("golf lineup tab shows event chips and roster locks", async ({ page }) => {
    await page.goto("/leagues/golf-main?tab=lineup");
    await expect(page.getByText(/THE PLAYERS Championship/i).first()).toBeVisible();
    await expect(page.getByText(/Set five starters/i)).toBeVisible();
    await expect(page.getByText("Scottie Scheffler").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Save lineup/i })).toBeVisible();
  });

  test("golf scoreboard tab shows week totals and H2H", async ({ page }) => {
    await page.goto("/leagues/golf-main?tab=scoreboard");
    await expect(page.getByText(/Counting scoreboard/i)).toBeVisible();
    await expect(page.getByText(/THE PLAYERS Championship/i).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: /Head-to-head/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Week totals/i })).toBeVisible();
    await expect(page.getByText("Fairway Phantoms").first()).toBeVisible();
  });

  test("golf standings show H2H records from scored weeks", async ({ page }) => {
    await page.goto("/leagues/golf-main?tab=standings");
    await expect(page.getByText(/H2H record from scored event weeks/i)).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Record" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "PF" })).toBeVisible();
    await expect(page.getByText("Bogey Bandits").first()).toBeVisible();
    // Fixture leader after 6.4e derivation (2-0 from two scored events).
    await expect(page.getByText("2-0").first()).toBeVisible();
  });

  test("golf schedule tab shows multipliers and lineup links", async ({ page }) => {
    await page.goto("/leagues/golf-main?tab=schedule");
    await expect(page.getByText(/Curated FedExCup counting slate/i)).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "×" })).toBeVisible();
    await expect(page.getByText(/THE PLAYERS Championship/i).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Set lineup" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Scoreboard" }).first()).toBeVisible();
  });

  test("golf teams tab shows GS/BE roster pills", async ({ page }) => {
    await page.goto("/leagues/golf-main?tab=teams");
    await expect(page.getByText(/Season rosters are GS starters/i)).toBeVisible();
    await expect(page.getByText(/5 GS · \d+ BE/).first()).toBeVisible();
  });

  test("golf history tab shows archive meta from scored weeks", async ({ page }) => {
    await page.goto("/leagues/golf-main?tab=history");
    await expect(page.getByText(/event weeks projected from the scoreboard/i)).toBeVisible();
    await expect(page.getByRole("link", { name: "All-time" })).toBeVisible();
  });

  test("golf team roster shows starters section and event alts", async ({ page }) => {
    await page.goto("/leagues/golf-main/teams/1");
    await expect(page.getByRole("heading", { name: /Starters \(GS\)/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Bench \(BE\)/i })).toBeVisible();
    await expect(page.getByText(/Current event lineup/i)).toBeVisible();
    await expect(page.getByText(/Alt1/i).first()).toBeVisible();
  });

  test("admin center adds email and links an ESPN team", async ({ page }) => {
    const membersPath = path.join(HUB_DIR, "hub_members.json");
    fs.rmSync(membersPath, { force: true });
    try {
      await page.goto("/admin");
      await expect(page.getByRole("heading", { name: /^Admin$/i })).toBeVisible();
      await expect(page.getByRole("link", { name: /^Admin$/i })).toBeVisible();
      await page.getByPlaceholder("member@gmail.com").fill("demo@example.com");
      await page.getByRole("button", { name: /^Add$/i }).click();
      await expect(
        page.getByRole("cell", { name: "demo@example.com" }),
      ).toBeVisible();

      const footballSelect = page.getByLabel(
        /Strictly Jayers Football(?! Dynasty)/i,
      );
      // Team labels come from the mounted snapshot store (fixtures or live ESPN).
      const linkedLabel = (
        await footballSelect.locator("option").nth(1).textContent()
      )?.split("·")[0]?.trim();
      expect(linkedLabel).toBeTruthy();
      await footballSelect.selectOption({ index: 1 });
      await expect(
        page.getByRole("cell", {
          name: new RegExp(
            linkedLabel!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            "i",
          ),
        }),
      ).toBeVisible();

      // Roadmap 7.1/7.2: the same link now drives the member dashboard and the
      // "You" marker. Asserted here rather than in its own spec because this
      // test owns hub_members.json and the specs run in parallel locally.
      await page.goto("/");
      await expect(
        page.getByRole("heading", { name: /Welcome back/i }),
      ).toBeVisible();
      await expect(page.getByText(/leagues linked to your franchise/i)).toBeVisible();
      await expect(
        page.getByRole("link", { name: new RegExp(linkedLabel!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }).first(),
      ).toBeVisible();

      await page.goto("/leagues/football-main");
      await expect(page.getByText("You", { exact: true }).first()).toBeVisible();

      await page.goto("/leagues/football-main?tab=matchups");
      await expect(page.getByText(/Your matchup/i)).toBeVisible();

      // Selection is component state, so a fresh load has nothing active and no
      // Remove button — pick the row first.
      await page.goto("/admin");
      await page.getByRole("cell", { name: "demo@example.com" }).click();
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: /^Remove$/i }).click();
      await expect(
        page.getByRole("cell", { name: "demo@example.com" }),
      ).toHaveCount(0);

      // Unlinked again: the hero is the front door, not an empty dashboard.
      await page.goto("/");
      await expect(
        page.getByRole("heading", { name: /Leagues, teams, and players/i }),
      ).toBeVisible();
    } finally {
      fs.rmSync(membersPath, { force: true });
    }
  });

  test("player names link to a player page (roadmap 7.3)", async ({ page }) => {
    await page.goto("/leagues/football-main?tab=players");
    // The board pages at 25 rows, so search rather than assuming page one.
    await page.getByPlaceholder(/Search players/i).fill("Juan Phillips");
    const link = page.getByRole("link", { name: "Juan Phillips" });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page.getByRole("heading", { name: "Juan Phillips" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Eligibility/i })).toBeVisible();
    await expect(page.getByText(/Lineup slot/i)).toBeVisible();
  });

  test("franchise page shows a career and rivalries (roadmap 7.3)", async ({
    page,
  }) => {
    await page.goto("/leagues/football-main/franchises/1");
    await expect(page.getByRole("heading", { name: /Gridiron Goons/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Season by season/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Rivalries/i })).toBeVisible();
  });

  test("team page shows its own season results (roadmap 7.4)", async ({
    page,
  }) => {
    await page.goto("/leagues/football-main/teams/1");
    await expect(page.getByRole("heading", { name: /Season results/i })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Opponent" })).toBeVisible();
  });

  test("football settings tab renders synced ESPN settings (roadmap 7.9)", async ({
    page,
  }) => {
    await page.goto("/leagues/football-main?tab=settings");
    await expect(page.getByText(/As ESPN reports them/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Roster", exact: true })).toBeVisible();
    await expect(page.getByText(/Slots/i).first()).toBeVisible();
  });

  test("secondary tabs live behind the More disclosure (roadmap 7.5)", async ({
    page,
  }) => {
    await page.goto("/leagues/football-main");
    // History is not a primary tab, so it must not be in the visible row.
    await expect(page.getByRole("link", { name: "History" })).toBeHidden();
    await page.getByRole("group").filter({ hasText: "More" }).first().click();
    await expect(page.getByRole("link", { name: "History" })).toBeVisible();
  });

  test("single-season fixtures render no season chips (roadmap 3.2/7.5)", async ({
    page,
  }) => {
    // Committed fixtures are current-season only, so the switcher hides itself.
    // The 4-visible + "N more" split is unit-tested against a 12-season league.
    await page.goto("/leagues/football-main");
    await expect(page.locator(".season-switch")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Standings" })).toBeVisible();
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
    await expect(page.getByRole("cell", { name: "FA ADDED" }).first()).toBeVisible();
  });

  test("baseball waivers tab lists free agents", async ({ page }) => {
    await page.goto("/leagues/baseball-dynasty?tab=waivers");
    await expect(page.getByText(/ESPN free agents/i)).toBeVisible();
    await expect(page.getByText("Wayne Morales")).toBeVisible();
  });
});
