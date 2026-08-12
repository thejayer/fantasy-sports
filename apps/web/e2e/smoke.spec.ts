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
    await expect(page.getByText(/Starts \/ segment/i)).toBeVisible();
    await expect(page.getByText(/Auto-pick default lineup/i)).toBeVisible();
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
    // Lobby → nominate → bid → pass is chatty against 1s polling; give CI room.
    test.setTimeout(60_000);
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

    // Create already POSTs auction_room.json before navigation. The panel
    // briefly renders "Open auction room" while the initial GET is in flight —
    // do not race a click on that button (it detaches when the room arrives).
    const live = page.getByText(/Live OWGR auction/i);
    await expect(async () => {
      if (await live.isVisible()) return;
      const openRoom = page.getByRole("button", { name: /Open auction room/i });
      if (await openRoom.isVisible()) {
        await Promise.race([
          openRoom.click({ timeout: 2_000 }),
          live.waitFor({ state: "visible", timeout: 2_000 }),
        ]).catch(() => undefined);
      }
      await expect(live).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });

    await page.getByRole("button", { name: /Start auction/i }).click();
    await expect(
      page.getByRole("heading", { name: /Nominate/i }),
    ).toBeVisible({ timeout: 10_000 });

    // Act as the nominating franchise (first team after start).
    const acting = page.getByLabel(/Acting team/i);
    if (
      await acting
        .evaluate((el) => el.tagName === "SELECT")
        .catch(() => false)
    ) {
      await acting.selectOption({ index: 0 });
    }
    const player = page.getByLabel(/^Player$/i);
    await expect(player).toBeVisible({ timeout: 10_000 });
    await player.selectOption({ index: 1 });
    const nominateBtn = page.getByRole("button", { name: /^Nominate$/i });
    await expect(nominateBtn).toBeEnabled();
    await nominateBtn.click();
    await expect(
      page.getByRole("heading", { name: /^Bidding/i }),
    ).toBeVisible({ timeout: 15_000 });

    // Switch acting team to team 2 and bid, then pass others via timer/pass.
    await acting.selectOption({ index: 1 });
    await page.getByRole("button", { name: /\+\$1/i }).click();
    await expect(page.getByText(/high bid/i)).toBeVisible();
    // Remaining teams pass until sold (skip high bidder — cannot pass).
    for (const idx of [0, 2, 3, 4, 5]) {
      await acting.selectOption({ index: idx });
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
    await expect(page.getByText(/\bFinal\b/i).first()).toBeVisible();
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
    await expect(page.getByRole("heading", { name: /Start usage/i })).toBeVisible();
  });

  test("golf golfer detail shows ownership and starts (roadmap 8.3)", async ({
    page,
  }) => {
    await page.goto("/leagues/golf-main/players/1");
    await expect(page.getByRole("heading", { name: /Golfer card/i })).toBeVisible();
    await expect(page.getByText(/Ownership/i).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: /Lineup usage/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Round results/i })).toBeVisible();
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

  test("history trophies view shows playoff and seed champions (7.13)", async ({
    page,
  }) => {
    await page.goto("/leagues/football-main?tab=history&view=trophies");
    await expect(page.getByRole("link", { name: "Trophies" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Trophy case" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Playoff champions" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Regular-season #1" })).toBeVisible();
    await expect(page.getByText(/Only one season is on disk/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Record shelf" })).toBeVisible();
  });

  test("golf team roster shows starters section and event alts", async ({ page }) => {
    await page.goto("/leagues/golf-main/teams/1");
    await expect(page.getByRole("heading", { name: /Starters \(GS\)/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Bench \(BE\)/i })).toBeVisible();
    await expect(page.getByText(/Current event lineup/i)).toBeVisible();
    await expect(page.getByText(/Alt1/i).first()).toBeVisible();
  });

  test("member profile shows trophy chips and feed activity (7.12)", async ({
    page,
  }) => {
    const membersPath = path.join(HUB_DIR, "hub_members.json");
    const feedDir = path.join(HUB_DIR, "football-main", "2026");
    const feedPath = path.join(feedDir, "feed.json");
    fs.mkdirSync(HUB_DIR, { recursive: true });
    fs.mkdirSync(feedDir, { recursive: true });
    fs.writeFileSync(
      membersPath,
      `${JSON.stringify(
        {
          schema_version: 1,
          updated_at: new Date().toISOString(),
          members: [
            {
              email: "profile.demo@example.com",
              role: "member",
              display_name: "Trophy Case",
              bio: "Always drafting RBs.",
              teams: [
                {
                  // Standing #1 in football-main fixtures → trophy chip.
                  league_id: "football-main",
                  team_id: 4,
                  team_name: "Hail Mary Heroes",
                  league_name: "Strictly Jayers Football",
                },
              ],
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        },
        null,
        2,
      )}\n`,
    );
    fs.writeFileSync(
      feedPath,
      `${JSON.stringify(
        {
          schema_version: 1,
          league_id: "football-main",
          season: 2026,
          updated_at: new Date().toISOString(),
          revision: 1,
          comments: [
            {
              id: "c-profile-demo",
              target_id: "league",
              body: "Trophy shelf check.",
              author_email: "profile.demo@example.com",
              author_name: "Trophy Case",
              team_id: 4,
              created_at: "2026-08-01T12:00:00.000Z",
              deleted_at: null,
            },
          ],
          reactions: [],
          polls: [],
        },
        null,
        2,
      )}\n`,
    );
    try {
      await page.goto("/u/trophy-case");
      await expect(page.getByRole("heading", { name: "Trophy Case" })).toBeVisible();
      await expect(page.getByText("@trophy-case")).toBeVisible();
      await expect(page.getByText("Always drafting RBs.")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Trophy shelf" })).toBeVisible();
      await expect(page.getByRole("link", { name: /1× #1/i })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Franchises" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Recent activity" })).toBeVisible();
      await expect(page.getByText("Trophy shelf check.")).toBeVisible();
    } finally {
      fs.rmSync(membersPath, { force: true });
      fs.rmSync(feedPath, { force: true });
    }
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

      // Link a franchise in each remaining league so the portfolio strip
      // covers the four-sport set (roadmap 9.4).
      for (const label of [
        /Team for Strictly Jayers Football Dynasty/i,
        /Team for Strictly Jayers Baseball/i,
        /Team for Strictly Jayers Golf/i,
      ]) {
        const select = page.getByLabel(label);
        await expect(select).toBeEnabled();
        await select.selectOption({ index: 1 });
        await expect(select).not.toHaveValue("");
      }

      // Roadmap 7.1/7.2/9.4: franchise links drive the member dashboard,
      // portfolio table, and the "You" marker. Asserted here because this
      // test owns hub_members.json and the specs run in parallel locally.
      await page.goto("/");
      await expect(
        page.getByRole("heading", { name: /Welcome back/i }),
      ).toBeVisible();
      await expect(page.getByText(/leagues linked to your franchise/i)).toBeVisible();
      await expect(
        page.getByRole("heading", { name: /Your portfolio/i }),
      ).toBeVisible();
      await expect(
        page.getByRole("columnheader", { name: "Standing" }),
      ).toBeVisible();
      // Track Q 7.14 — frozen clock (SJ_ON_THIS_DAY_NOW) lands on Week 1's Sep 8.
      await expect(
        page.getByRole("heading", { name: /This day in SJ/i }),
      ).toBeVisible();
      await expect(page.getByText(/Week 1 · 2026/i).first()).toBeVisible();
      await expect(
        page.getByRole("link", { name: /Strictly Jayers Football(?! Dynasty)/i }).first(),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: /Strictly Jayers Baseball/i }).first(),
      ).toBeVisible();
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
    // Server-side search (roadmap 7.11) — q= filters before render.
    await page.goto(
      "/leagues/football-main?tab=players&q=Juan%20Phillips",
    );
    const link = page.getByRole("link", { name: "Juan Phillips" });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page.getByRole("heading", { name: "Juan Phillips" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Eligibility/i })).toBeVisible();
    await expect(page.getByText(/Lineup slot/i)).toBeVisible();
  });

  test("football player page shows multi-week game log (roadmap 8.1)", async ({
    page,
  }) => {
    await page.goto("/leagues/football-main/players/202600001");
    await expect(page.getByRole("heading", { name: "Juan Phillips" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Game log/i })).toBeVisible();
    await expect(page.getByText(/18\.7/)).toBeVisible();
    await expect(page.getByText(/12\.3/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Box" }).first()).toBeVisible();
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

  test("football matchup box score shows league points (roadmap 8.1)", async ({
    page,
  }) => {
    await page.goto(
      "/leagues/football-main?tab=matchups&view=week&week=14&box=1-2",
    );
    await expect(page.getByText(/Week 14 box score/i)).toBeVisible();
    await expect(page.getByText("Juan Phillips").first()).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Pts" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Week 14 matchups/i })).toBeVisible();
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
    // Pin ?team=1 so this does not depend on SJ_DEV_VIEWER_EMAIL / admin links
    // (those default Start/Sit onto standing #1, currently Hail Mary Heroes).
    await page.goto(
      "/leagues/football-main?tab=tools&view=start-sit&team=1",
    );
    await expect(page.getByText(/Typical-week posteriors/i)).toBeVisible();
    // Fixture overlay maps roster ESPN id → weekly Mahomes GSIS; UI keeps roster name.
    await expect(page.getByText("Juan Phillips")).toBeVisible();
  });

  test("draft results tab shows ESPN picks", async ({ page }) => {
    await page.goto("/leagues/football-main?tab=draft");
    await expect(page.getByText(/ESPN draft results/i)).toBeVisible();
    await expect(page.getByText("Juan Phillips")).toBeVisible();
  });

  test("dynasty roster and draft show keeper badges (7.9b)", async ({ page }) => {
    await page.goto("/leagues/football-dynasty/teams/1");
    await expect(page.getByText("Gregory Rivera")).toBeVisible();
    await expect(page.getByText("Keeper", { exact: true }).first()).toBeVisible();
    await page.goto("/leagues/football-dynasty?tab=draft");
    await expect(page.getByRole("columnheader", { name: "Keeper", exact: true })).toBeVisible();
    await expect(page.getByText("Keeper", { exact: true }).first()).toBeVisible();
  });

  test("feed tab shows system events from transactions", async ({ page }) => {
    await page.goto("/leagues/football-main?tab=activity");
    await expect(
      page.getByText(/Transactions, results, and digests/i),
    ).toBeVisible();
    await expect(page.getByText(/FA ADDED/i).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Feed" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Newest first" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Oldest first" })).toBeVisible();
    await expect(page.getByLabel("Feed from date")).toBeVisible();
    await expect(page.getByLabel("Feed to date")).toBeVisible();
  });

  test("tools landing cards name each decision tool", async ({ page }) => {
    await page.goto("/leagues/football-main?tab=tools");
    await expect(page.getByRole("heading", { name: "Trade Desk" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Playoff Odds" })).toBeVisible();
  });

  test("baseball waivers tab lists free agents", async ({ page }) => {
    await page.goto("/leagues/baseball-dynasty?tab=waivers");
    await expect(page.getByText(/ESPN free agents/i)).toBeVisible();
    await expect(page.getByText("Jonathan Ward")).toBeVisible();
  });

  test("baseball Season Points hides category board (roadmap 8.2)", async ({
    page,
  }) => {
    await page.goto("/leagues/baseball-dynasty?tab=tools");
    await expect(page.getByRole("heading", { name: "Usage Caps" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Category Board" }),
    ).toHaveCount(0);
    await page.goto("/leagues/baseball-dynasty?tab=tools&view=categories");
    await expect(
      page.getByText(/Category Board is for H2H \/ roto leagues/i),
    ).toBeVisible();
  });

  test("baseball Season Points standings show points without H2H record", async ({
    page,
  }) => {
    await page.goto("/leagues/baseball-dynasty");
    await expect(page.getByText(/Season Points/i).first()).toBeVisible();
    await expect(
      page.getByText(/standings by cumulative fantasy points/i),
    ).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Points" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Record" })).toHaveCount(
      0,
    );
  });

  test("baseball tools usage caps show team IP (roadmap 8.2)", async ({
    page,
  }) => {
    await page.goto("/leagues/baseball-dynasty?tab=tools&view=usage");
    await expect(page.getByText(/Season IP vs/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: /Team IP/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Team GS vs/i })).toBeVisible();
    await expect(page.getByText(/Period 24 IP vs/i)).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Curveball Crew" }),
    ).toBeVisible();
  });

  test("baseball tools trailing windows show PR splits (roadmap 8.2)", async ({
    page,
  }) => {
    await page.goto("/leagues/baseball-dynasty?tab=tools&view=trailing&window=15");
    await expect(page.getByText(/Hot streaks from ESPN PR15/i)).toBeVisible();
    await expect(page.getByRole("link", { name: "30 days" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Batters" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Pitchers" })).toBeVisible();
  });

  test("baseball tools schedule counts matchup-period games (roadmap 8.2)", async ({
    page,
  }) => {
    await page.goto("/leagues/baseball-dynasty?tab=tools&view=schedule");
    await expect(page.getByText(/Games per fantasy team in matchup period 24/i)).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Player games" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Two-start pitchers/i })).toBeVisible();
    await expect(page.getByText("Douglas Price")).toBeVisible();
  });

  test("baseball tools daily locks show today's slate (roadmap 8.2)", async ({
    page,
  }) => {
    await page.goto("/leagues/baseball-dynasty?tab=tools&view=locks");
    await expect(page.getByText(/Today's lineup locks for 2026-07-27/i)).toBeVisible();
    await expect(page.getByText("HOU @ ARI")).toBeVisible();
    await expect(page.getByRole("cell", { name: "17:05 UTC" }).first()).toBeVisible();
  });

  test("baseball Season Points matchups explain no H2H (roadmap 8.2)", async ({
    page,
  }) => {
    await page.goto("/leagues/baseball-dynasty?tab=matchups");
    await expect(page.getByText(/No head-to-head matchups/i)).toBeVisible();
    await expect(page.getByText(/Season Points/i).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Category box" })).toHaveCount(
      0,
    );
  });
});
