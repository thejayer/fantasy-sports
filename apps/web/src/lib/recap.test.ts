import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { LeagueSnapshot, Team } from "@/lib/data";
import { buildWeeklyDigest } from "@/lib/digest";
import { generateAndStoreRecap } from "@/lib/recap-generate";
import {
  formatTemplateGameLine,
  parseRecapArticle,
  recapFactsFromDigest,
  recapFactsFromLeague,
  recapFactsHash,
  recapSport,
  validateRecapAgainstFacts,
  writeTemplateRecap,
} from "@/lib/recap";
import {
  DEFAULT_ANTHROPIC_RECAP_MODEL,
  DEFAULT_OPENAI_RECAP_MODEL,
  isCheapRecapModel,
  openaiRecapRequestBody,
  recapArticleFromModelJson,
  recapExpensiveModelError,
  recapLlmConfigFromEnv,
} from "@/lib/recap-llm";
import { listRecapPeriods, readRecap, writeRecap } from "@/lib/recap-store";
import {
  DEFAULT_RECAP_DAILY_LIMIT,
  readRecapUsage,
  recapBudgetError,
  recapUsageLimitsFromEnv,
  recordRecapLlmCall,
  reserveRecapLlmCall,
} from "@/lib/recap-usage";

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
    expect(article.facts_hash).toBe(recapFactsHash(facts!));
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

  it("rejects duplicate ranking_copy rows", () => {
    const facts = recapFactsFromLeague(league, 1)!;
    const article = writeTemplateRecap(facts);
    article.ranking_copy.push({ ...article.ranking_copy[0] });
    expect(validateRecapAgainstFacts(article, facts)).toMatch(/duplicate team_id/);
  });

  it("narrates ties as ties, not a win for the right side", () => {
    const line = formatTemplateGameLine({
      leftName: "Alpha",
      leftTeamId: 1,
      leftScore: 100,
      rightName: "Beta",
      rightTeamId: 2,
      rightScore: 100,
      outcome: "T-T",
    });
    expect(line).toContain("tied");
    expect(line).not.toMatch(/over/);
    const article = writeTemplateRecap({
      ...recapFactsFromLeague(league, 1)!,
      games: [
        {
          leftName: "Alpha",
          leftTeamId: 1,
          leftScore: 100,
          rightName: "Beta",
          rightTeamId: 2,
          rightScore: 100,
          outcome: "T-T",
        },
      ],
    });
    expect(article.body[0]).toContain("tied");
    expect(article.body[0]).not.toMatch(/over/);
  });
});

describe("recapArticleFromModelJson", () => {
  it("keeps trusted model and generated_at over model JSON", () => {
    const facts = recapFactsFromLeague(league, 1)!;
    const template = writeTemplateRecap(facts);
    const article = recapArticleFromModelJson(
      facts,
      {
        headline: template.headline,
        dek: template.dek,
        body: template.body,
        ranking_copy: template.ranking_copy,
        league_id: "spoofed",
        season: 1999,
        period: 99,
        sport: "baseball",
        generated_at: "1999-01-01T00:00:00.000Z",
        model: "evil/model",
      },
      "anthropic/claude-sonnet-4-5",
      new Date("2026-09-08T12:00:00.000Z"),
    );
    expect(article.league_id).toBe("recap-test");
    expect(article.season).toBe(2026);
    expect(article.period).toBe(1);
    expect(article.sport).toBe("football");
    expect(article.model).toBe("anthropic/claude-sonnet-4-5");
    expect(article.generated_at).toBe("2026-09-08T12:00:00.000Z");
    expect(article.facts_hash).toBe(recapFactsHash(facts));
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
        SJ_RECAP_PROVIDER: "anthropic",
        OPENAI_API_KEY: "sk-test",
        ANTHROPIC_API_KEY: "ant-test",
      }),
    ).toMatchObject({ provider: "anthropic", apiKey: "ant-test" });
  });

  it("prefers OpenAI Luna when both keys are set", () => {
    expect(
      recapLlmConfigFromEnv({
        OPENAI_API_KEY: "sk-test",
        ANTHROPIC_API_KEY: "ant-test",
      }),
    ).toMatchObject({
      provider: "openai",
      apiKey: "sk-test",
      model: DEFAULT_OPENAI_RECAP_MODEL,
    });
  });

  it("defaults to Haiku when only Anthropic is set", () => {
    expect(
      recapLlmConfigFromEnv({ ANTHROPIC_API_KEY: "ant-test" }),
    ).toMatchObject({
      provider: "anthropic",
      model: DEFAULT_ANTHROPIC_RECAP_MODEL,
    });
  });

  it("returns null without keys", () => {
    expect(recapLlmConfigFromEnv({})).toBeNull();
  });

  it("allowlists Luna and rejects Sol unless unlocked", () => {
    expect(isCheapRecapModel("openai", "gpt-5.6-luna")).toBe(true);
    expect(isCheapRecapModel("openai", "gpt-5.6-luna-2026-02-16")).toBe(true);
    expect(isCheapRecapModel("openai", "gpt-5.6-sol")).toBe(false);
    expect(isCheapRecapModel("anthropic", "claude-3-5-haiku-latest")).toBe(true);
    expect(isCheapRecapModel("anthropic", "claude-sonnet-4-5")).toBe(false);
    const sol = recapLlmConfigFromEnv({
      OPENAI_API_KEY: "sk-test",
      SJ_RECAP_MODEL: "gpt-5.6-sol",
    })!;
    expect(recapExpensiveModelError(sol, {})).toMatch(/allowlist/);
    expect(
      recapExpensiveModelError(sol, { SJ_RECAP_ALLOW_EXPENSIVE: "1" }),
    ).toBeNull();
  });

  it("sends Luna with reasoning off and a completion cap", () => {
    const body = openaiRecapRequestBody(
      { provider: "openai", apiKey: "sk", model: "gpt-5.6-luna" },
      "{}",
    );
    expect(body.reasoning_effort).toBe("none");
    expect(body.max_completion_tokens).toBe(900);
    expect(body.temperature).toBeUndefined();
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
    expect(loaded?.facts_hash).toBe(article.facts_hash);
    expect(await listRecapPeriods("recap-test", 2026)).toEqual([1]);
  });
});

describe("recap cost guardrails", () => {
  const prevHub = process.env.SJ_HUB_DIR;
  let tmp = "";

  afterEach(async () => {
    if (prevHub == null) delete process.env.SJ_HUB_DIR;
    else process.env.SJ_HUB_DIR = prevHub;
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  async function withHub() {
    tmp = await mkdtemp(path.join(os.tmpdir(), "sj-recap-"));
    process.env.SJ_HUB_DIR = tmp;
  }

  it("defaults daily limit to 12 and blocks when the UTC day is full", () => {
    expect(recapUsageLimitsFromEnv({}).daily).toBe(DEFAULT_RECAP_DAILY_LIMIT);
    const now = new Date("2026-08-12T18:00:00Z");
    const error = recapBudgetError(
      { schema_version: 1, daily: { "2026-08-12": { calls: 12 } }, periods: {} },
      "recap-test",
      2026,
      1,
      now,
      recapUsageLimitsFromEnv({}),
    );
    expect(error).toMatch(/today's cap/);
  });

  it("skips the LLM when facts_hash is unchanged", async () => {
    await withHub();
    const facts = recapFactsFromLeague(league, 1)!;
    await writeRecap(writeTemplateRecap(facts));
    let calls = 0;
    const result = await generateAndStoreRecap(league, 1, {
      env: { OPENAI_API_KEY: "sk-test" },
      generateWithLlm: async () => {
        calls += 1;
        throw new Error("should not call the model");
      },
    });
    expect(result.ok).toBe(true);
    expect(calls).toBe(0);
  });

  it("refuses a rewrite after the per-week cap", async () => {
    await withHub();
    const now = new Date("2026-08-12T18:00:00Z");
    await recordRecapLlmCall("recap-test", 2026, 1, now);
    await recordRecapLlmCall("recap-test", 2026, 1, now);
    let calls = 0;
    const result = await generateAndStoreRecap(league, 1, {
      force: true,
      now,
      env: { OPENAI_API_KEY: "sk-test", SJ_RECAP_PERIOD_LIMIT: "2" },
      generateWithLlm: async (facts) => {
        calls += 1;
        return writeTemplateRecap(facts);
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(429);
      expect(result.error).toMatch(/already has 2/);
    }
    expect(calls).toBe(0);
  });

  it("records a successful Luna write against the daily cap", async () => {
    await withHub();
    const now = new Date("2026-08-12T18:00:00Z");
    const result = await generateAndStoreRecap(league, 1, {
      now,
      env: { OPENAI_API_KEY: "sk-test" },
      generateWithLlm: async (facts) => writeTemplateRecap(facts, now),
    });
    expect(result.ok).toBe(true);
    const blocked = await generateAndStoreRecap(league, 1, {
      force: true,
      now,
      env: { OPENAI_API_KEY: "sk-test", SJ_RECAP_DAILY_LIMIT: "1" },
      generateWithLlm: async (facts) => writeTemplateRecap(facts, now),
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.status).toBe(429);
  });

  it("lets only one of two concurrent writes take the last daily slot", async () => {
    await withHub();
    const now = new Date("2026-08-12T18:00:00Z");
    let llmCalls = 0;
    const env = { OPENAI_API_KEY: "sk-test", SJ_RECAP_DAILY_LIMIT: "1" };
    const run = () =>
      generateAndStoreRecap(league, 1, {
        force: true,
        now,
        env,
        generateWithLlm: async (facts) => {
          llmCalls += 1;
          return writeTemplateRecap(facts, now);
        },
      });
    const [first, second] = await Promise.all([run(), run()]);
    const statuses = [first, second].map((row) =>
      row.ok ? 200 : row.status,
    );
    expect(statuses.sort()).toEqual([200, 429]);
    expect(llmCalls).toBe(1);
    const usage = await readRecapUsage();
    expect(usage.daily["2026-08-12"]?.calls).toBe(1);
  });

  it("keeps a reserved slot when the model fails so a retry cannot double-bill", async () => {
    await withHub();
    const now = new Date("2026-08-12T18:00:00Z");
    const failed = await generateAndStoreRecap(league, 1, {
      now,
      env: { OPENAI_API_KEY: "sk-test", SJ_RECAP_DAILY_LIMIT: "1" },
      generateWithLlm: async () => {
        throw new Error("OpenAI 500");
      },
    });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.status).toBe(502);
    const retry = await generateAndStoreRecap(league, 1, {
      now,
      env: { OPENAI_API_KEY: "sk-test", SJ_RECAP_DAILY_LIMIT: "1" },
      generateWithLlm: async (facts) => writeTemplateRecap(facts, now),
    });
    expect(retry.ok).toBe(false);
    if (!retry.ok) expect(retry.status).toBe(429);
  });

  it("reserveRecapLlmCall is serialized so two callers cannot both pass a limit of 1", async () => {
    await withHub();
    const now = new Date("2026-08-12T18:00:00Z");
    const limits = recapUsageLimitsFromEnv({ SJ_RECAP_DAILY_LIMIT: "1" });
    const [a, b] = await Promise.all([
      reserveRecapLlmCall("recap-test", 2026, 1, now, limits),
      reserveRecapLlmCall("recap-test", 2026, 1, now, limits),
    ]);
    const okCount = [a, b].filter((row) => row.ok).length;
    expect(okCount).toBe(1);
    expect([a, b].some((row) => !row.ok && row.error.includes("today's cap"))).toBe(
      true,
    );
  });
});
