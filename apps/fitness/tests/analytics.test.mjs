import { describe, it, expect } from "vitest";
import { loadAnalyticsContext } from "./helpers/loadAppContext.mjs";

const balancedCheckin = {
  sleep: 6,
  energy: 6,
  motivation: 6,
  soreness: 4,
  stress: 4,
};

describe("getReadinessScoreFromCheckin", () => {
  it("returns null when no checkin is provided and no checkin exists for today", () => {
    const ctx = loadAnalyticsContext({ readinessCheckins: [] });
    expect(ctx.getReadinessScoreFromCheckin(null)).toBe(null);
  });

  it("clamps low-readiness inputs at the floor of 25", () => {
    const ctx = loadAnalyticsContext();
    const score = ctx.getReadinessScoreFromCheckin({
      sleep: 1,
      energy: 1,
      motivation: 1,
      soreness: 10,
      stress: 10,
    });
    expect(score).toBe(25);
  });

  it("returns a mid-range score for a balanced checkin", () => {
    const ctx = loadAnalyticsContext();
    const score = ctx.getReadinessScoreFromCheckin(balancedCheckin);
    expect(score).toBeGreaterThanOrEqual(60);
    expect(score).toBeLessThanOrEqual(80);
  });

  it("clamps high-readiness inputs at the ceiling of 98", () => {
    const ctx = loadAnalyticsContext();
    const score = ctx.getReadinessScoreFromCheckin({
      sleep: 10,
      energy: 10,
      motivation: 10,
      soreness: 0,
      stress: 0,
    });
    expect(score).toBe(98);
  });
});

describe("load: getWeekBuckets (input to acute-to-chronic ratio)", () => {
  it("returns four week buckets all at zero minutes when no sessions are logged", () => {
    const ctx = loadAnalyticsContext({ sessions: [] });
    const buckets = ctx.getWeekBuckets();
    expect(buckets).toHaveLength(4);
    expect(buckets.map((week) => week.minutes)).toEqual([0, 0, 0, 0]);
    expect(buckets.at(-1).label).toBe("This week");
  });

  it("attributes minutes from sessions in the last 7 days to the current week bucket", () => {
    const ctx = loadAnalyticsContext({
      sessions: [
        { id: "s1", type: "Golf Range Session", date: ctx_today(0), durationMinutes: 60 },
        { id: "s2", type: "Lifting", date: ctx_today(2), durationMinutes: 45 },
      ],
    });
    const buckets = ctx.getWeekBuckets();
    expect(buckets.at(-1).minutes).toBe(105);
    expect(buckets.at(-1).count).toBe(2);
    expect(buckets.slice(0, 3).every((week) => week.minutes === 0)).toBe(true);
  });

  it("yields a load ratio above 1.0 when current week exceeds the four-week average", () => {
    // Heavy current week (180 min), nothing in prior weeks => acute > chronic.
    const ctx = loadAnalyticsContext({
      sessions: [
        { id: "s1", type: "Golf Range Session", date: ctx_today(0), durationMinutes: 90 },
        { id: "s2", type: "Lifting", date: ctx_today(1), durationMinutes: 90 },
      ],
    });
    const buckets = ctx.getWeekBuckets();
    const currentWeek = buckets.at(-1).minutes;
    const chronicAverage =
      buckets.reduce((sum, week) => sum + week.minutes, 0) / Math.max(1, buckets.length);
    const loadRatio = chronicAverage ? currentWeek / chronicAverage : 0;
    expect(loadRatio).toBeGreaterThan(1);
  });
});

describe("getPersonalRecords", () => {
  it("marks every record as null when no sessions are logged", () => {
    const ctx = loadAnalyticsContext({ sessions: [] });
    const records = ctx.getPersonalRecords();
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((record) => record.value === null && record.session === null)).toBe(true);
  });

  it("sets a max-mode record to the value from a single matching session", () => {
    const ctx = loadAnalyticsContext({
      sessions: [
        {
          id: "s1",
          type: "Golf Range Session",
          date: "2026-05-10",
          durationMinutes: 60,
          values: { balls: 80, quality: 7, targetRate: 55 },
        },
      ],
    });
    const ballRecord = ctx
      .getPersonalRecords()
      .find((record) => record.title === "Biggest range session");
    expect(ballRecord.value).toBe(80);
    expect(ballRecord.session.id).toBe("s1");
  });

  it("picks the best value across multiple sessions, honoring max vs min mode", () => {
    const ctx = loadAnalyticsContext({
      sessions: [
        {
          id: "low",
          type: "Pickleball Match",
          date: "2026-05-08",
          values: { games: 4, kneeFatigue: 3 },
        },
        {
          id: "high",
          type: "Pickleball Match",
          date: "2026-05-09",
          values: { games: 9, kneeFatigue: 8 },
        },
      ],
    });
    const records = ctx.getPersonalRecords();
    const games = records.find((r) => r.title === "Most pickleball games");
    const knees = records.find((r) => r.title === "Lowest knee fatigue");
    expect(games.value).toBe(9);
    expect(games.session.id).toBe("high");
    expect(knees.value).toBe(3);
    expect(knees.session.id).toBe("low");
  });
});

describe("getRecommendation", () => {
  /**
   * @param {{ flag?: { area: string, score: number }, sportCounts?: Record<string, number>, checkinReadiness?: number }} [options]
   */
  function makeStats({ flag, sportCounts = { Golf: 2 }, checkinReadiness = 80 } = {}) {
    return {
      highestFlag: flag ?? { area: "Shoulder", score: 1 },
      sportCounts,
      checkinReadiness,
    };
  }

  it("returns a shoulder-focused recovery recommendation when shoulder soreness is high", () => {
    const ctx = loadAnalyticsContext();
    const rec = ctx.getRecommendation(makeStats({ flag: { area: "Shoulder", score: 8 } }));
    expect(rec.type).toBe("Recovery");
    expect(rec.title).toMatch(/shoulder care/i);
    expect(rec.text).toContain("Shoulder is at 8/10");
  });

  it("returns a lower-body recovery recommendation when knee soreness is high", () => {
    const ctx = loadAnalyticsContext();
    const rec = ctx.getRecommendation(makeStats({ flag: { area: "Knees", score: 9 } }));
    expect(rec.type).toBe("Recovery");
    expect(rec.title).toMatch(/mobility reset/i);
    expect(rec.text).toContain("Knees");
  });

  it("returns the goal-driven Golf Power recommendation for clubhead-speed when no flags are raised", () => {
    const ctx = loadAnalyticsContext({
      activeGoalId: "clubhead-speed",
      athleteProfile: {
        primarySport: "Golf",
        activeSports: ["Golf"],
        trainingStyle: "Performance",
        goalId: "clubhead-speed",
        programId: "golf-power",
      },
    });
    const rec = ctx.getRecommendation(makeStats());
    expect(rec.type).toBe("Golf Power");
    expect(rec.title).toBe("Speed intent + lower-body power");
  });
});

// Helper: build a YYYY-MM-DD string for N days ago without leaning on the
// sandbox (used inside test inputs before the sandbox is constructed).
function ctx_today(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
