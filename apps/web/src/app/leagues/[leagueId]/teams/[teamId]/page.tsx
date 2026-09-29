import Link from "next/link";
import { notFound } from "next/navigation";
import { BaseballRosterView } from "@/components/BaseballRosterView";
import { DroppedPlayersPanel } from "@/components/DroppedPlayersPanel";
import { EmptyState } from "@/components/EmptyState";
import { GameLogPanel } from "@/components/GameLogPanel";
import { GolfRosterView } from "@/components/GolfRosterView";
import { KeeperBadge } from "@/components/KeeperBadge";
import { SeasonSwitcher } from "@/components/SeasonSwitcher";
import { formatValue, hockeyValueIndex } from "@/lib/hockey-values";
import {
  getHockeyNhl,
  getHockeyValues,
  getLeagueSeasons,
  getPlayerMap,
  getProjectionSnapshot,
  getTeam,
} from "@/lib/data";
import {
  formatHeight,
  formatMinutes,
  formatWhole,
  hockeyBioIndex,
  ppLabel,
  roleLabel,
  teamLabel,
  toiTitle,
} from "@/lib/hockey-nhl";
import { ViewerBadge } from "@/components/ViewerBadge";
import {
  isKeeperPlayer,
  keeperPlayerIds,
} from "@/lib/draft-results";
import { injuryTone, recordLabel, winPctLabel } from "@/lib/league";
import { getViewerTeamId } from "@/lib/viewer";
import {
  attachPlayerProjections,
  formatProjectionPoints,
  indexPlayerMap,
  indexProjections,
  projectionSeasonCandidates,
  scoringSlugFromLeague,
} from "@/lib/projection-join";

// See app/page.tsx. Already dynamic today, but declared so adding
// generateStaticParams later cannot silently freeze snapshot data.
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ leagueId: string; teamId: string }>;
  searchParams: Promise<{ season?: string }>;
};

export default async function TeamPage({ params, searchParams }: Props) {
  const { leagueId, teamId } = await params;
  const { season: seasonParam } = await searchParams;
  const parsedId = Number(teamId);
  if (Number.isNaN(parsedId)) {
    notFound();
  }
  const season = seasonParam ? Number(seasonParam) : undefined;
  const seasons = await getLeagueSeasons(leagueId);

  const result = await getTeam(
    leagueId,
    parsedId,
    season && !Number.isNaN(season) ? season : undefined,
  );
  if (!result) {
    notFound();
  }

  const { league, team } = result;
  const seasonHref = (year: number) =>
    `/leagues/${leagueId}/teams/${team.team_id}?season=${year}`;
  const isViewerTeam = (await getViewerTeamId(leagueId)) === team.team_id;

  if (league.sport === "baseball") {
    return (
      <BaseballRosterView
        league={league}
        team={team}
        seasons={seasons}
        isViewerTeam={isViewerTeam}
      />
    );
  }

  if (league.sport === "golf") {
    return (
      <GolfRosterView league={league} team={team} seasons={seasons} />
    );
  }

  const isHockey = league.sport === "hockey";
  let projectionSnapshot = null;
  let playerMap = null;
  const scoring = scoringSlugFromLeague(league);
  // NFL projections are football-only; hockey reads its NHL sidecars instead.
  for (const year of isHockey ? [] : projectionSeasonCandidates(league.season)) {
    const snap = await getProjectionSnapshot(scoring, year);
    const map = await getPlayerMap(year);
    if (map && !playerMap) playerMap = map;
    if (snap) {
      projectionSnapshot = snap;
      if (map) playerMap = map;
      break;
    }
  }
  const hockeyBios = isHockey
    ? hockeyBioIndex(
        await getHockeyNhl(league.league_id, league.season),
        team.roster.map((p) => p.id),
      )
    : {};
  const hockeyValues = isHockey
    ? hockeyValueIndex(
        await getHockeyValues(league.league_id, league.season),
        team.roster.map((p) => p.id),
      )
    : {};
  const roster = attachPlayerProjections(
    team.roster,
    indexPlayerMap(playerMap),
    indexProjections(projectionSnapshot),
  );
  const mapped = roster.filter((p) => p.projection).length;
  const keepers = keeperPlayerIds(league.draft, team.team_id);

  return (
    <main className="section league-view sport-football">
      <div className="league-kicker">
        <Link
          className="league-meta"
          href={`/leagues/${leagueId}?season=${league.season}`}
        >
          {league.name}
        </Link>
        <span className="league-meta">season {league.season}</span>
      </div>
      <h2>
        {team.name}
        {isViewerTeam ? <ViewerBadge label="Your team" /> : null}
      </h2>
      <p className="lede">
        {team.owners.join(", ") || "Owner TBD"} · {recordLabel(team)} (
        {winPctLabel(team)}) · {team.roster.length} rostered
        {projectionSnapshot
          ? ` · ${mapped}/${team.roster.length} with season projections (${scoring.toUpperCase()})`
          : ""}
      </p>

      <SeasonSwitcher
        seasons={seasons}
        current={league.season}
        hrefFor={seasonHref}
      />

      <GameLogPanel league={league} team={team} />

      <DroppedPlayersPanel league={league} team={team} />

      <h3 className="roster-group-title" style={{ marginTop: "1.5rem" }}>
        Roster
      </h3>
      {!team.roster.length ? (
        <EmptyState title="No roster players in this snapshot">
          Rosters appear after sync when ESPN returns lineup data for this
          season.
        </EmptyState>
      ) : (
        <div className="panel table-scroll">
          <table className="table-cards">
            <thead>
              <tr>
                <th></th>
                <th>Player</th>
                <th>Pos</th>
                <th>Slot</th>
                <th>Pro</th>
                <th>Status</th>
                <th>Points</th>
                {isHockey ? (
                  <>
                    <th>Value</th>
                    <th>ROS</th>
                    <th>Age</th>
                    <th>Ht</th>
                    <th>Wt</th>
                    <th>Team</th>
                    <th>Role</th>
                    <th>PP</th>
                    <th>Linemates</th>
                    <th>EV min</th>
                    <th>PP min</th>
                  </>
                ) : (
                  <>
                    <th>Floor</th>
                    <th>Med</th>
                    <th>Ceil</th>
                    <th>Tier</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {roster.map((player) => {
                const label = player.injury_status || player.status || "OK";
                const proj = player.projection;
                const kept = isKeeperPlayer(player.id, keepers);
                const bio =
                  player.id != null ? hockeyBios[String(player.id)] : undefined;
                const team = teamLabel(bio);
                const worth =
                  player.id != null ? hockeyValues[String(player.id)] : undefined;
                return (
                  <tr key={`${player.id}-${player.name}`}>
                    <td data-label="Status">
                      <span
                        className={`status-dot ${injuryTone(player)}`}
                        title={label}
                      />
                    </td>
                    <td data-label="Player">
                      {player.name}
                      {kept ? <KeeperBadge /> : null}
                    </td>
                    <td data-label="Pos">{player.position ?? "—"}</td>
                    <td data-label="Slot">{player.slot ?? "—"}</td>
                    <td data-label="Pro">{player.pro_team ?? "—"}</td>
                    <td data-label="Injury">{player.injury_status ?? "—"}</td>
                    <td data-label="Points">
                      {player.total_points?.toFixed?.(1) ?? "—"}
                    </td>
                    {isHockey ? (
                      <>
                        <td data-label="Value">{formatValue(worth?.value)}</td>
                        <td data-label="ROS">{formatValue(worth?.ros, 1)}</td>
                        <td data-label="Age">{formatWhole(bio?.age)}</td>
                        <td data-label="Ht">{formatHeight(bio?.heightIn)}</td>
                        <td data-label="Wt">{formatWhole(bio?.weightLb)}</td>
                        <td data-label="Team" title={team.title}>
                          {team.text}
                        </td>
                        <td data-label="Role" title={roleLabel(bio).title}>
                          {roleLabel(bio).text}
                        </td>
                        <td data-label="PP">
                          {ppLabel(bio).href ? (
                            <a
                              href={ppLabel(bio).href}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Daily Faceoff lines"
                            >
                              {ppLabel(bio).text}
                            </a>
                          ) : (
                            ppLabel(bio).text
                          )}
                        </td>
                        <td data-label="Linemates">
                          {bio?.linemates.join(", ") || "—"}
                        </td>
                        <td data-label="EV min" title={toiTitle(bio)}>
                          {formatMinutes(bio?.evMin)}
                        </td>
                        <td data-label="PP min" title={toiTitle(bio)}>
                          {formatMinutes(bio?.ppMin)}
                        </td>
                      </>
                    ) : (
                      <>
                        <td data-label="Floor">
                          {formatProjectionPoints(proj?.floor)}
                        </td>
                        <td data-label="Med">
                          {formatProjectionPoints(proj?.median)}
                        </td>
                        <td data-label="Ceil">
                          {formatProjectionPoints(proj?.ceiling)}
                        </td>
                        <td data-label="Tier">
                          {proj?.tier != null ? String(proj.tier) : "—"}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
