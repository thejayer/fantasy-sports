import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildHealthReport, staleAfterSeconds } from "./health";

const FIXED_NOW = Date.parse("2026-07-27T20:00:00.000Z");

async function writeIndex(
  root: string,
  leagues: Array<{
    league_id: string;
    name: string;
    sport: string;
    season: number;
    synced_at?: string;
  }>,
) {
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(
    path.join(root, "index.json"),
    JSON.stringify({ generated_at: "2026-07-27T00:00:00Z", leagues }),
    "utf8",
  );
}

describe("staleAfterSeconds", () => {
  afterEach(() => {
    delete process.env.SJ_HEALTH_STALE_SECONDS;
  });

  it("defaults to two hours", () => {
    delete process.env.SJ_HEALTH_STALE_SECONDS;
    expect(staleAfterSeconds()).toBe(7200);
  });

  it("honours SJ_HEALTH_STALE_SECONDS", () => {
    process.env.SJ_HEALTH_STALE_SECONDS = "900";
    expect(staleAfterSeconds()).toBe(900);
  });

  it("falls back when the env value is junk", () => {
    process.env.SJ_HEALTH_STALE_SECONDS = "nope";
    expect(staleAfterSeconds()).toBe(7200);
  });
});

describe("buildHealthReport", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sj-health-"));
    process.env.SJ_HEALTH_STALE_SECONDS = "3600";
  });

  afterEach(async () => {
    delete process.env.SJ_HEALTH_STALE_SECONDS;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("reports empty when no index is present", async () => {
    const report = await buildHealthReport(FIXED_NOW, [tmp]);
    expect(report).toMatchObject({
      ok: false,
      status: "empty",
      league_count: 0,
      source: null,
    });
  });

  it("is ok when every latest season is fresh", async () => {
    await writeIndex(tmp, [
      {
        league_id: "football-main",
        name: "Football",
        sport: "football",
        season: 2025,
        synced_at: "2026-07-27T19:30:00.000Z",
      },
      {
        league_id: "football-main",
        name: "Football",
        sport: "football",
        season: 2024,
        synced_at: "2025-01-01T00:00:00.000Z",
      },
      {
        league_id: "baseball-dynasty",
        name: "Baseball",
        sport: "baseball",
        season: 2026,
        synced_at: "2026-07-27T19:45:00.000Z",
      },
    ]);

    const report = await buildHealthReport(FIXED_NOW, [tmp]);
    expect(report.ok).toBe(true);
    expect(report.status).toBe("ok");
    expect(report.league_count).toBe(2);
    expect(report.stale_count).toBe(0);
    expect(report.leagues.map((l) => l.league_id).sort()).toEqual([
      "baseball-dynasty",
      "football-main",
    ]);
    // Historical 2024 season must not appear — only the latest per league.
    expect(report.leagues.every((l) => l.season >= 2025)).toBe(true);
    expect(report.leagues.find((l) => l.league_id === "football-main")?.age_seconds).toBe(
      30 * 60,
    );
  });

  it("marks stale when synced_at is older than the threshold", async () => {
    await writeIndex(tmp, [
      {
        league_id: "football-main",
        name: "Football",
        sport: "football",
        season: 2025,
        synced_at: "2026-07-27T10:00:00.000Z", // 10h old > 1h threshold
      },
    ]);

    const report = await buildHealthReport(FIXED_NOW, [tmp]);
    expect(report.ok).toBe(false);
    expect(report.status).toBe("stale");
    expect(report.stale_count).toBe(1);
    expect(report.leagues[0]?.stale).toBe(true);
    expect(report.oldest_age_seconds).toBe(10 * 60 * 60);
  });

  it("treats a missing synced_at as stale", async () => {
    await writeIndex(tmp, [
      {
        league_id: "football-main",
        name: "Football",
        sport: "football",
        season: 2025,
      },
    ]);

    const report = await buildHealthReport(FIXED_NOW, [tmp]);
    expect(report.ok).toBe(false);
    expect(report.leagues[0]).toMatchObject({
      synced_at: null,
      age_seconds: null,
      stale: true,
    });
  });
});

describe("health route stays outside the session gate", () => {
  it("does not import the session or data modules", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(path.resolve(__dirname, "health.ts"), "utf8");
    expect(source).not.toMatch(/from ["']@\/lib\/session["']/);
    expect(source).not.toMatch(/from ["']@\/lib\/data["']/);
    expect(source).not.toMatch(/from ["']@\/auth["']/);
  });

  it("middleware allows /api/health without a session", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      path.resolve(__dirname, "../middleware.ts"),
      "utf8",
    );
    expect(source).toMatch(/pathname === ["']\/api\/health["']/);
    expect(source).toMatch(/isHealth/);
  });
});
