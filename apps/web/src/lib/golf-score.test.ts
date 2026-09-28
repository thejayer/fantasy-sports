import { describe, expect, it } from "vitest";

import { DEFAULT_GOLF_SETTINGS } from "./golf";
import {
  applyMatchupsFromScoreboard,
  applyStandingsFromScoreboard,
  buildScoreboardPayload,
  compareH2h,
  scoreTeamWeek,
  toParPoints,
  fixtureEventRounds,
} from "./golf-score";
import { buildLineupsPayload } from "./golf-lineup";
import type { Team } from "./data";

describe("golf score", () => {
  it("maps to-par to fantasy points", () => {
    expect(toParPoints(-3)).toBe(3);
    expect(toParPoints(2)).toBe(-2);
    expect(toParPoints(null)).toBe(0);
  });

  it("applies weekend alt for MC starters", () => {
    const rounds = {
      event_id: "t",
      grain: "end_of_day",
      rounds: [
        { player_id: 1, round: 3, to_par: null, status: "mc" },
        { player_id: 2, round: 3, to_par: -1, status: "active" },
        { player_id: 3, round: 3, to_par: 0, status: "active" },
        { player_id: 4, round: 3, to_par: 1, status: "active" },
        { player_id: 5, round: 3, to_par: 2, status: "active" },
        { player_id: 6, round: 3, to_par: -4, status: "active" },
        // midweek placeholders so week scorer has all rounds
        ...[1, 2, 3, 4, 5, 6].flatMap((pid) =>
          [1, 2, 4].map((rnd) => ({
            player_id: pid,
            round: rnd,
            to_par: 0,
            status: "active",
          })),
        ),
      ],
    };
    const scored = scoreTeamWeek(
      { starters: [1, 2, 3, 4, 5], captain: 2, alt1: 6 },
      rounds,
      DEFAULT_GOLF_SETTINGS,
      1,
    );
    const sat = scored.by_round["3"];
    expect(sat?.slots.find((s) => s.starter_id === 1)?.source).toBe("alt1");
    expect(sat?.slots.find((s) => s.starter_id === 1)?.points).toBe(4);
  });

  it("builds scoreboard for drafted teams", () => {
    const teams = [
      {
        team_id: 1,
        name: "A",
        abbrev: "A",
        owners: [],
        wins: 0,
        losses: 0,
        ties: 0,
        points_for: 0,
        points_against: 0,
        standing: 1,
        division: "",
        roster: Array.from({ length: 15 }, (_, i) => ({
          id: i + 1,
          name: `G${i + 1}`,
          position: "G",
          slot: i < 5 ? "GS" : "BE",
          pro_team: "USA",
          injury_status: null,
          total_points: 0,
          projected_total_points: null,
          avg_points: null,
        })),
      },
      {
        team_id: 2,
        name: "B",
        abbrev: "B",
        owners: [],
        wins: 0,
        losses: 0,
        ties: 0,
        points_for: 0,
        points_against: 0,
        standing: 2,
        division: "",
        roster: Array.from({ length: 15 }, (_, i) => ({
          id: i + 16,
          name: `G${i + 16}`,
          position: "G",
          slot: i < 5 ? "GS" : "BE",
          pro_team: "USA",
          injury_status: null,
          total_points: 0,
          projected_total_points: null,
          avg_points: null,
        })),
      },
    ] as Team[];
    const lineups = buildLineupsPayload(teams, 2026, DEFAULT_GOLF_SETTINGS, {
      savedAt: "2026-07-27T00:00:00+00:00",
      nowIso: "2026-03-12T14:00:00+00:00",
    });
    const board = buildScoreboardPayload(
      teams,
      lineups,
      DEFAULT_GOLF_SETTINGS,
      "2026-07-27T00:00:00+00:00",
    );
    expect(board.events).toHaveLength(2);
    expect(board.events[0]?.pairings).toHaveLength(1);
    expect(board.events[0]?.teams["1"]?.week_total).toBe(
      (board.events[0]?.teams["1"]?.week_raw ?? 0) * 1.5,
    );
    const home = board.events[0]!.teams["1"]!;
    const away = board.events[0]!.teams["2"]!;
    expect(["W", "L", "T"]).toContain(compareH2h(home, away));
    expect(fixtureEventRounds("x", [1]).rounds).toHaveLength(4);

    applyStandingsFromScoreboard(teams, board, "h2h");
    applyMatchupsFromScoreboard(teams, board);
    expect(teams.map((t) => t.team_id)).toEqual([1, 2]);
    expect(Math.min(...teams.map((t) => t.standing ?? 99))).toBe(1);
    expect(
      teams.some((t) => t.wins + t.losses + t.ties > 0),
    ).toBe(true);
    expect(teams[0]!.schedule).toHaveLength(board.events.length);
    expect(
      teams[0]!.outcomes!.every((o) => ["W", "L", "T"].includes(o)),
    ).toBe(true);
    expect(board.events[0]?.status).toBe("final");
    expect(board.events[0]?.through_round).toBe(4);
  });

  it("projects remaining rounds when through_round < 4", () => {
    const lineup = {
      starters: [1, 2, 3, 4, 5],
      captain: 1,
      alt1: 6,
      alt2: null,
    };
    const rounds = fixtureEventRounds("e", [1, 2, 3, 4, 5, 6]);
    const partial = scoreTeamWeek(
      lineup,
      rounds,
      DEFAULT_GOLF_SETTINGS,
      1,
      2,
    );
    expect(partial.status).toBe("in_progress");
    expect(partial.through_round).toBe(2);
    expect(partial.week_projected ?? 0).toBeCloseTo(partial.week_total * 2, 5);
    expect(Object.keys(partial.by_round)).toEqual(["1", "2"]);
  });

  it("auto-picks missing lineups when scoring", () => {
    const teams = [
      {
        team_id: 1,
        name: "A",
        abbrev: "A",
        owners: [],
        wins: 0,
        losses: 0,
        ties: 0,
        points_for: 0,
        points_against: 0,
        standing: 1,
        division: null,
        roster: [1, 2, 3, 4, 5, 6].map((id) => ({
          id,
          name: `G${id}`,
          position: "G",
          slot: id <= 5 ? "GS" : "BE",
          pro_team: "USA",
          injury_status: null,
          total_points: 0,
          projected_total_points: null,
          avg_points: null,
        })),
      },
    ] as unknown as Team[];
    const lineups = buildLineupsPayload(teams, 2026, DEFAULT_GOLF_SETTINGS, {
      savedAt: "2026-07-27T00:00:00+00:00",
    });
    delete lineups.teams["1"]![lineups.events[0]!.event_id];
    const board = buildScoreboardPayload(
      teams,
      lineups,
      DEFAULT_GOLF_SETTINGS,
      "2026-07-27T00:00:00+00:00",
    );
    expect(board.events[0]?.teams["1"]).toBeTruthy();
  });
});
