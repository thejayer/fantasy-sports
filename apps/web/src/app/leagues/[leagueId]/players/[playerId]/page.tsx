import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/EmptyState";
import { PlayerWeekLogPanel } from "@/components/PlayerWeekLogPanel";
import { SeasonSwitcher } from "@/components/SeasonSwitcher";
import { StatChips } from "@/components/StatChips";
import { buildPlayerWeekGameLog } from "@/lib/box-score";
import {
  getLeagueSeasons,
  getLeagueSnapshot,
  getPlayerMap,
  getProjectionSnapshot,
  getWeekBoxScore,
  getWeeklyProjectionSnapshot,
  listWeekBoxScoreWeeks,
  type WeekBoxScoreSnapshot,
} from "@/lib/data";
import { espnPlayerUrl } from "@/lib/espn-links";
import { injuryTone } from "@/lib/league";
import { buildGolferProfileBoard } from "@/lib/golf-player";
import {
  findPlayerInLeague,
  playerRosterLabel,
  playerStatLines,
  projectionStatLines,
} from "@/lib/player-profile";
import {
  indexPlayerMap,
  indexProjections,
  projectionForEspnId,
  projectionSeasonCandidates,
  scoringSlugFromLeague,
} from "@/lib/projection-join";

// See app/page.tsx — snapshots only exist at runtime.
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ leagueId: string; playerId: string }>;
  searchParams: Promise<{ season?: string }>;
};

export default async function PlayerPage({ params, searchParams }: Props) {
  const { leagueId, playerId } = await params;
  const { season: seasonParam } = await searchParams;
  const season = seasonParam ? Number(seasonParam) : undefined;
  const seasons = await getLeagueSeasons(leagueId);

  const league = await getLeagueSnapshot(
    leagueId,
    season && !Number.isNaN(season) ? season : undefined,
  );
  if (!league) notFound();

  const profile = findPlayerInLeague(league, playerId);
  if (!profile) notFound();

  const { player, team, draftPick, transactions } = profile;
  const isFootball = league.sport === "football";
  const isGolf = league.sport === "golf";
  const golfBoard = isGolf
    ? buildGolferProfileBoard(league, player, team)
    : null;

  let seasonProjection = null;
  let weeklyProjection = null;
  let weekLog = null;
  if (isFootball) {
    const scoring = scoringSlugFromLeague(league);
    for (const year of projectionSeasonCandidates(league.season)) {
      const map = await getPlayerMap(year);
      if (!map) continue;
      const espnToGsis = indexPlayerMap(map);
      const snap = await getProjectionSnapshot(scoring, year);
      if (snap) {
        seasonProjection = projectionForEspnId(
          player.id,
          espnToGsis,
          indexProjections(snap),
        );
      }
      const weekly = await getWeeklyProjectionSnapshot(scoring, year);
      if (weekly) {
        weeklyProjection = projectionForEspnId(
          player.id,
          espnToGsis,
          indexProjections(weekly),
        );
      }
      if (seasonProjection || weeklyProjection) break;
    }

    const weekNums = await listWeekBoxScoreWeeks(
      league.league_id,
      league.season,
    );
    const weekSnaps: WeekBoxScoreSnapshot[] = [];
    for (const week of weekNums) {
      const snap = await getWeekBoxScore(
        league.league_id,
        league.season,
        week,
      );
      if (snap) weekSnaps.push(snap);
    }
    weekLog = buildPlayerWeekGameLog(weekSnaps, player.id ?? playerId);
  }

  const statusLabel = player.injury_status || player.status || "Healthy";
  const espnUrl = espnPlayerUrl(league.sport, player.id);
  const chips = [
    ...playerStatLines(player, league.sport),
    ...projectionStatLines(seasonProjection, "season"),
    ...projectionStatLines(weeklyProjection, "week"),
  ];

  return (
    <main className={`section league-view sport-${league.sport}`}>
      <div className="league-kicker">
        <Link
          className="league-meta"
          href={
            isGolf
              ? `/leagues/${leagueId}?season=${league.season}&tab=teams`
              : `/leagues/${leagueId}?season=${league.season}&tab=players`
          }
        >
          {league.name}
        </Link>
        <span className="league-meta">season {league.season}</span>
      </div>

      <h2>{player.name ?? `Player ${playerId}`}</h2>
      <p className="lede">
        <span className={`status-dot ${injuryTone(player)}`} title={statusLabel} />{" "}
        {player.position ?? "—"}
        {player.pro_team ? ` · ${player.pro_team}` : ""} ·{" "}
        {team ? (
          <Link href={`/leagues/${leagueId}/teams/${team.team_id}?season=${league.season}`}>
            {playerRosterLabel(profile)}
          </Link>
        ) : (
          playerRosterLabel(profile)
        )}
        {statusLabel !== "Healthy" ? ` · ${statusLabel}` : ""}
      </p>

      <SeasonSwitcher
        seasons={seasons}
        current={league.season}
        hrefFor={(year) => `/leagues/${leagueId}/players/${playerId}?season=${year}`}
      />

      {chips.length ? (
        <StatChips lines={chips} />
      ) : (
        <EmptyState title="No stat line in this snapshot">
          This season has no scoring data for the player yet.
        </EmptyState>
      )}

      {isFootball && !seasonProjection ? (
        <p className="muted">
          No engine projection joined for this player — the ESPN↔nflverse map has
          no entry for id {String(player.id)}. Committed fixtures use synthetic
          ESPN ids, so offline coverage is expected to be near zero.
        </p>
      ) : null}

      {isFootball && weekLog ? (
        <PlayerWeekLogPanel league={league} log={weekLog} />
      ) : null}

      {golfBoard ? (
        <section className="player-section">
          <h3 className="roster-group-title">Golfer card</h3>
          <p className="league-meta">{golfBoard.disclaimer}</p>
          <div className="panel">
            <dl className="settings-grid">
              <div className="settings-row">
                <dt>Ownership</dt>
                <dd>{golfBoard.ownershipPct.toFixed(0)}%</dd>
              </div>
              <div className="settings-row">
                <dt>Starts</dt>
                <dd>
                  {golfBoard.startsUsedBySegment.length
                    ? golfBoard.startsUsedBySegment
                        .map(
                          (row) =>
                            `${row.segmentId}: ${row.used}${
                              row.max != null ? `/${row.max}` : ""
                            }`,
                        )
                        .join(" · ")
                    : "None yet"}
                </dd>
              </div>
            </dl>
          </div>
          <h3 className="roster-group-title">Lineup usage</h3>
          {!golfBoard.starts.length ? (
            <EmptyState title="No lineup starts yet">
              Starts and alts appear after weekly lineups include this golfer.
            </EmptyState>
          ) : (
            <div className="panel table-scroll">
              <table className="table-cards">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Segment</th>
                    <th>Slot</th>
                    <th>Team</th>
                  </tr>
                </thead>
                <tbody>
                  {golfBoard.starts.map((row) => (
                    <tr key={`${row.eventId}-${row.slot}-${row.teamId}`}>
                      <td data-label="Event">{row.eventName}</td>
                      <td data-label="Segment">{row.segmentId ?? "—"}</td>
                      <td data-label="Slot">{row.slot}</td>
                      <td data-label="Team">{row.teamName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h3 className="roster-group-title">Round results</h3>
          {!golfBoard.results.length ? (
            <EmptyState title="No scored rounds yet">
              EOD scoreboard slots for this golfer show up after an event is
              scored.
            </EmptyState>
          ) : (
            <div className="panel table-scroll">
              <table className="table-cards">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Round</th>
                    <th>Status</th>
                    <th className="numeric">To-par</th>
                    <th className="numeric">Pts</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {golfBoard.results.map((row) => (
                    <tr key={`${row.eventId}-${row.round}-${row.source}`}>
                      <td data-label="Event">{row.eventName}</td>
                      <td data-label="Round">{row.label}</td>
                      <td data-label="Status">{row.status}</td>
                      <td data-label="To-par" className="numeric">
                        {row.toPar == null
                          ? "—"
                          : row.toPar > 0
                            ? `+${row.toPar}`
                            : String(row.toPar)}
                      </td>
                      <td data-label="Pts" className="numeric">
                        {row.points}
                      </td>
                      <td data-label="Source">{row.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      <section className="player-section">
        <h3 className="roster-group-title">Eligibility</h3>
        <div className="panel">
          <dl className="settings-grid">
            <div className="settings-row">
              <dt>Lineup slot</dt>
              <dd>{player.slot ?? "—"}</dd>
            </div>
            <div className="settings-row">
              <dt>Eligible slots</dt>
              <dd>{player.eligible_slots?.join(", ") || "—"}</dd>
            </div>
            <div className="settings-row">
              <dt>Acquired</dt>
              <dd>{player.acquisition_type ?? "—"}</dd>
            </div>
            {draftPick ? (
              <div className="settings-row">
                <dt>Drafted</dt>
                <dd>
                  Round {draftPick.round ?? "—"}, pick{" "}
                  {draftPick.round_pick ?? "—"}
                  {draftPick.bid_amount ? ` · $${draftPick.bid_amount}` : ""}
                  {draftPick.keeper ? " · keeper" : ""}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
      </section>

      <section className="player-section">
        <h3 className="roster-group-title">League transactions</h3>
        {!transactions.length ? (
          <EmptyState title="No transactions for this player">
            Adds, drops, and trades appear here once ESPN reports them for this
            season (activity is empty before 2019).
          </EmptyState>
        ) : (
          <div className="panel table-scroll">
            <table className="table-cards">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Team</th>
                  <th>Action</th>
                  <th className="numeric">Bid</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((row) => (
                  <tr key={row.key}>
                    <td data-label="Date">{row.dateLabel}</td>
                    <td data-label="Team">
                      {row.teamId != null ? (
                        <Link
                          href={`/leagues/${leagueId}/teams/${row.teamId}?season=${league.season}`}
                        >
                          {row.teamName}
                        </Link>
                      ) : (
                        row.teamName
                      )}
                    </td>
                    <td data-label="Action">{row.action}</td>
                    <td data-label="Bid" className="numeric">
                      {row.bidAmount ? row.bidAmount : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {espnUrl ? (
        <p className="muted">
          <a href={espnUrl} rel="noreferrer noopener" target="_blank">
            Open on ESPN ↗
          </a>{" "}
          {isFootball
            ? "for news and splits beyond the synced week box scores."
            : "for news, game logs, and splits the hub does not sync."}
        </p>
      ) : null}
    </main>
  );
}
