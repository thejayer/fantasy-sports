import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { LeagueSnapshot } from "@/lib/data";
import {
  formatHeight,
  formatMinutes,
  formatWhole,
  hockeyBioIndex,
  teamLabel,
  toiTitle,
  type HockeyNhlContextSnapshot,
  type HockeyNhlSnapshot,
  type HockeyPlayerMapSnapshot,
} from "@/lib/hockey-nhl";

const FIXTURES = path.resolve(process.cwd(), "../../fixtures/sj");

function loadJson<T>(rel: string): T {
  return JSON.parse(readFileSync(path.join(FIXTURES, rel), "utf8")) as T;
}

function fixtureNhl(): HockeyNhlSnapshot {
  return {
    playerMap: loadJson<HockeyPlayerMapSnapshot>("hockey-main/2027/nhl/player_map.json"),
    context: loadJson<HockeyNhlContextSnapshot>("hockey-main/2027/nhl/nhl_context.json"),
  };
}

describe("hockey NHL join (HOCKEY-PORT H1)", () => {
  it("joins every mapped roster player through player_map → nhl_context", () => {
    const league = loadJson<LeagueSnapshot>("hockey-main/2027.json");
    const nhl = fixtureNhl();
    const roster = league.teams.flatMap((team) => team.roster);
    const bios = hockeyBioIndex(nhl, roster.map((p) => p.id));
    const mapped = roster.filter((p) => nhl.playerMap!.players[String(p.id)]);
    expect(mapped.length).toBeGreaterThan(0);
    expect(Object.keys(bios).sort()).toEqual(mapped.map((p) => String(p.id)).sort());
    const unmatched = nhl.playerMap!.unmatched.filter((u) => u.rostered);
    for (const row of unmatched) {
      expect(bios[String(row.espn_id)]).toBeUndefined();
    }
    const skater = Object.values(bios).find((b) => b.evMin != null);
    expect(skater?.age).toBeGreaterThan(15);
    expect(skater?.heightIn).toBeGreaterThan(60);
    expect(skater?.toiBasis).toMatch(/season/);
  });

  it("only indexes the ids asked for", () => {
    const nhl = fixtureNhl();
    const [first] = Object.keys(nhl.playerMap!.players);
    expect(Object.keys(hockeyBioIndex(nhl, [Number(first), null, 999_999_999]))).toEqual([
      first,
    ]);
  });

  it("returns an empty index when sidecars are missing", () => {
    expect(hockeyBioIndex(null, [1])).toEqual({});
    expect(hockeyBioIndex({ playerMap: null, context: null })).toEqual({});
    const nhl = fixtureNhl();
    expect(hockeyBioIndex({ ...nhl, context: null })).toEqual({});
  });

  it("keeps missing values null instead of 0", () => {
    const nhl: HockeyNhlSnapshot = {
      playerMap: {
        ...fixtureNhl().playerMap!,
        players: { "7": { nhl_id: 70, method: "name", rostered: true } },
      },
      context: {
        ...fixtureNhl().context!,
        players: {
          "70": {
            nhl_id: 70,
            name: "Rookie Goalie",
            position: "G",
            group: "G",
            team: null,
            prior_team: null,
            birth_date: null,
            age: null,
            height_in: null,
            weight_lb: null,
            on_nhl_roster: false,
            toi: null,
          },
        },
      },
    };
    const bio = hockeyBioIndex(nhl)["7"];
    expect(bio).toMatchObject({
      age: null,
      heightIn: null,
      weightLb: null,
      team: null,
      evMin: null,
      ppMin: null,
    });
    expect(formatWhole(bio.age)).toBe("—");
    expect(formatHeight(bio.heightIn)).toBe("—");
    expect(formatMinutes(bio.evMin)).toBe("—");
    expect(teamLabel(bio)).toEqual({ text: "—" });
    expect(toiTitle(bio)).toBeUndefined();
  });

  it("formats height, minutes, team, and TOI basis", () => {
    expect(formatHeight(74)).toBe(`6'2"`);
    expect(formatHeight(72)).toBe(`6'0"`);
    expect(formatMinutes(15)).toBe("15.0");
    expect(formatMinutes(0)).toBe("0.0");
    expect(formatWhole(205.4)).toBe("205");
    const moved = {
      nhlId: 1,
      age: 28,
      heightIn: 73,
      weightLb: 195,
      team: "TOR",
      priorTeam: "BOS",
      evMin: 15,
      ppMin: 3,
      toiBasis: "last season, other team",
    };
    expect(teamLabel(moved)).toEqual({ text: "TOR", title: "Last season: BOS" });
    expect(toiTitle(moved)).toBe("Per-game ice time, last season, other team");
  });
});
