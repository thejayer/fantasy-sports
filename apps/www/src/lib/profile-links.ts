/**
 * Team linking on /profile: types for the casino's link endpoints (served
 * through this site's /casino/api/links*) and the pure helpers the screen uses.
 * The server side (link, unlink, sync, mod review) is unchanged and decides
 * everything; this only lays out what it sends.
 */

export type LinkTeam = { team: string; label: string; owner: string };
export type LinkLeague = { league: string; name: string; teams: LinkTeam[] };
export type MyLink = {
  league: string;
  leagueName: string;
  team: string;
  label: string;
  owner: string;
  since: number;
};
export type LinksView = {
  mod: boolean;
  links: MyLink[];
  /** Claimed teams as opaque keys; `mine` marks the viewer's own. Who holds one is never sent. */
  taken: { league: string; team: string; mine: boolean }[];
  /** Absent when the team list can't be read right now. */
  leagues?: LinkLeague[];
};
export type ModLinkRow = {
  name: string;
  league: string;
  leagueName: string;
  team: string;
  label: string;
  owner: string;
  at: number;
};

/**
 * mine: linked by the viewer. taken: someone else has it. open: free to link.
 * locked: free, but the viewer already has a team in this league (one per league).
 */
export type TeamState = "mine" | "taken" | "open" | "locked";

export type LeagueRows = {
  league: string;
  name: string;
  mine: MyLink | null;
  openCount: number;
  teams: (LinkTeam & { state: TeamState })[];
};

export function leagueRows(view: LinksView): LeagueRows[] {
  return (view.leagues ?? []).map((lg) => {
    const mine = view.links.find((l) => l.league === lg.league) ?? null;
    const takenBy = new Map(
      view.taken.filter((t) => t.league === lg.league).map((t) => [t.team, t.mine] as const),
    );
    const teams = lg.teams.map((t) => {
      const taken = takenBy.get(t.team);
      const state: TeamState =
        taken === undefined ? (mine ? "locked" : "open") : taken || mine?.team === t.team ? "mine" : "taken";
      return { ...t, state };
    });
    return {
      league: lg.league,
      name: lg.name,
      mine,
      openCount: teams.filter((t) => t.state === "open" || t.state === "locked").length,
      teams,
    };
  });
}

/** How many teams the viewer has linked, for the section blurb. */
export function linkedCount(view: LinksView): number {
  return view.links.length;
}
