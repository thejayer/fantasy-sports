import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { LeagueSnapshot, Team } from "@/lib/data";
import { buildWeeklyDigest } from "@/lib/digest";
import {
  parseRecapArticle,
  recapFactsFromDigest,
  recapFactsFromLeague,
  recapSport,
  validateRecapAgainstFacts,
  writeTemplateRecap,
} from "@/lib/recap";
import { recapLlmConfigFromEnv } from "@/lib/recap-llm";
import { listRecapPeriods, readRecap, writeRecap } from "@/lib/recap-store";

function team(
  id: number,
  name: string,
  schedule: number[],
  scores: number[],
  outcomes: string[],
  pointsFor: number,
): Team {
  return {
    team_id: id,
    name,
    abbrev: name.slice(0, 3).toUpperCase(),
    owners: [],
    wins: outcomes.filter((o) => o === "W").length,
    losses: outcomes.filter((o) => o === "L").length,
    ties: 0,
    points_for: pointsFor,
    points_against: 0,
    standing: id,
    division: "",
    schedule,
    scores,
    outcomes,
    roster: [],
  };
}

const league: LeagueSnapshot = {
  schema_version: 1,
  league_id: "recap-test",
  espn_league_id: 1,
  name: "Recap Bowl",
  season: 2026,
  sport: "football",
  format: "redraft",
  team_count: 4,
  current_week: 2,
  synced_at: "2026-09-20T00:00:00Z",
  teams: [
    team(1, "Alpha", [2, 3], [120, 95], ["W", "W"], 215),
    team(2, "Beta", [1, 4], [90, 100], ["L", "W"], 190),
    team(3, "Gamma", [4, 1], [88, 80], ["W", "L"], 168),
    team(4, "Delta", [3, 2], [70, 85], ["L", "L"], 155),
  ],
  players: [],
  draft: [],
  transactions: [],
};

describe("recap facts (roadmap 7.15)", () => {
  it("skips golf", () => {
    expect(recapSport("golf")).toBeNull();
    expect(recapFactsFromLeague({ ...league, sport: "golf" }, 1)).toBeNull();
  });

  it("builds facts from a decided digest", () => {
    const digest = buildWeeklyDigest(league, 1);
    expect(digest).not.toBeNull();
    const facts = recapFactsFromDigest(league, digest!);
    expect(facts?.games.length).toBeGreaterThan(0);
    expect(facts?.rankings).toHaveLength(4);
    expect(facts?.awards.some((a) => a.id === "high_score")).toBe(true);
  });

  it("template copy covers every ranked team and validates", () => {
    const facts = recapFactsFromLeague(league, 1);
    expect(facts).not.toBeNull();
    const article = writeTemplateRecap(facts!, new Date("2026-09-08T12:00:00Z"));
    expect(article.model).toBe("template");
    expect(article.headline.length).toBeGreaterThan(8);
    expect(article.body.length).toBeGreaterThanOrEqual(2);
    expect(validateRecapAgainstFacts(article, facts!)).toBeNull();
  });

  it("rejects ranking_copy that invents a team", () => {
    const facts = recapFactsFromLeague(league, 1)!;
    const article = writeTemplateRecap(facts);
    article.ranking_copy[0].team_id = 99;
    expect(validateRecapAgainstFacts(article, facts)).toMatch(
      /missing ranking copy|unknown team_id/,
    );
  });
});

describe("parseRecapArticle", () => {
  it("drops empty paragraphs and unknown schema", () => {
    expect(parseRecapArticle({ schema_version: 2 })).toBeNull();
    const parsed = parseRecapArticle({
      schema_version: 1,
      league_id: "recap-test",
      season: 2026,
      period: 1,
      sport: "football",
      generated_at: "2026-09-08T12:00:00Z",
      model: "fixture",
      headline: "Alpha ate",
      dek: "Beta watched.",
      body: ["One.", "  ", "Two."],
      ranking_copy: [{ team_id: 1, blurb: "Still first." }],
    });
    expect(parsed?.body).toEqual(["One.", "Two."]);
  });
});

describe("recapLlmConfigFromEnv", () => {
  it("prefers explicit provider", () => {
    expect(
      recapLlmConfigFromEnv({
        SJ_RECAP_PROVIDER: "openai",
        OPENAI_API_KEY: "sk-test",
        ANTHROPIC_API_KEY: "ant-test",
      }),
    ).toMatchObject({ provider: "openai", apiKey: "sk-test" });
  });

  it("defaults to Anthropic when that key is set", () => {
    expect(
      recapLlmConfigFromEnv({ ANTHROPIC_API_KEY: "ant-test" }),
    ).toMatchObject({ provider: "anthropic" });
  });

  it("returns null without keys", () => {
    expect(recapLlmConfigFromEnv({})).toBeNull();
  });
});

describe("recap store", () => {
  const prevHub = process.env.SJ_HUB_DIR;
  let tmp = "";

  afterEach(async () => {
    if (prevHub == null) delete process.env.SJ_HUB_DIR;
    else process.env.SJ_HUB_DIR = prevHub;
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it("writes to the hub root and reads it back", async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "sj-recap-"));
    process.env.SJ_HUB_DIR = tmp;
    const facts = recapFactsFromLeague(league, 1)!;
    const article = writeTemplateRecap(facts);
    await writeRecap(article);
    const loaded = await readRecap("recap-test", 2026, 1);
    expect(loaded?.headline).toBe(article.headline);
    expect(await listRecapPeriods("recap-test", 2026)).toEqual([1]);
  });
});
