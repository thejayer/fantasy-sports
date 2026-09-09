import Link from "next/link";

import { EmptyState } from "@/components/EmptyState";
import { TeamIdentity } from "@/components/TeamAvatar";
import { ViewerBadge } from "@/components/ViewerBadge";
import type { LeagueSnapshot } from "@/lib/data";
import {
  WORST_DROPS_LEAGUE_LIMIT,
  buildWorstDropsBoard,
  type WorstDropRow,
} from "@/lib/worst-drops";

function fpLabel(value: number | null): string {
  return value == null ? "—" : value.toFixed(1);
}

function playerHref(
  leagueId: string,
  season: number,
  playerId: number | null,
): string | null {
  if (playerId == null) return null;
  return `/leagues/${leagueId}/players/${playerId}?season=${season}`;
}

function teamHref(leagueId: string, season: number, teamId: number | null): string | null {
  if (teamId == null) return null;
  return `/leagues/${leagueId}/teams/${teamId}?season=${season}`;
}

function ClaimedCell({ row }: { row: WorstDropRow }) {
  if (!row.claimedByTeamName) return "—";
  const who =
    row.claimedByOwnerLabel && row.claimedByOwnerLabel !== "—"
      ? `${row.claimedByTeamName} (${row.claimedByOwnerLabel})`
      : row.claimedByTeamName;
  return (
    <>
      {who}
      {row.claimedAction ? (
        <span className="muted">{` · ${row.claimedAction}`}</span>
      ) : null}
    </>
  );
}

function DropTable({
  league,
  rows,
  viewerTeamId,
  showTeam,
}: {
  league: LeagueSnapshot;
  rows: WorstDropRow[];
  viewerTeamId?: number;
  showTeam: boolean;
}) {
  const leagueId = league.league_id;
  const season = league.season;
  return (
    <div className="panel table-scroll">
      <table className="table-cards">
        <thead>
          <tr>
            <th className="numeric">#</th>
            <th className="numeric">Season FP</th>
            <th>Player</th>
            {showTeam ? <th>Team / owner</th> : null}
            <th>Date cut</th>
            <th>Claimed after</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const href = playerHref(leagueId, season, row.playerId);
            const teamUrl = teamHref(leagueId, season, row.teamId);
            const team = league.teams.find((item) => item.team_id === row.teamId);
            return (
              <tr
                key={row.key}
                className={row.teamId === viewerTeamId ? "is-viewer" : undefined}
              >
                <td data-label="#" className="numeric">
                  {index + 1}
                </td>
                <td data-label="Season FP" className="numeric">
                  {fpLabel(row.seasonFp)}
                </td>
                <td data-label="Player">
                  {href ? <Link href={href}>{row.playerName}</Link> : row.playerName}
                </td>
                {showTeam ? (
                  <td data-label="Team / owner">
                    <TeamIdentity name={row.teamName} logoUrl={team?.logo_url}>
                      {teamUrl ? <Link href={teamUrl}>{row.teamName}</Link> : row.teamName}
                      {row.teamId === viewerTeamId ? <ViewerBadge /> : null}
                      <span className="league-meta">{row.ownerLabel}</span>
                    </TeamIdentity>
                  </td>
                ) : null}
                <td data-label="Date cut">{row.dateLabel}</td>
                <td data-label="Claimed after">
                  <ClaimedCell row={row} />
                </td>
                <td data-label="Note">
                  {row.reAddedBySameTeam ? "Same team re-added" : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * League + per-team worst drops (roadmap 9.5). Sandbox / read-only.
 */
export function HallOfShamePanel({
  league,
  viewerTeamId,
}: {
  league: LeagueSnapshot;
  viewerTeamId?: number;
}) {
  const board = buildWorstDropsBoard(league);
  const feedHref = `/leagues/${league.league_id}?season=${league.season}&tab=activity&view=waivers`;

  return (
    <div className="hall-of-shame">
      <h3 className="roster-group-title" style={{ marginTop: 0 }}>
        Hall of Shame
      </h3>
      <p className="lede">
        Worst drops this season, ranked by the cut player&apos;s season fantasy
        points. Sandbox only: nothing writes ESPN.
      </p>
      <p className="league-meta">{board.disclaimer}</p>
      <p className="league-meta">
        From ESPN activity labels <code>DROPPED</code>, <code>FA ADDED</code>,{" "}
        <code>WAIVER ADDED</code>, and <code>TRADED</code> (trades are listed on
        the Feed, not here).{" "}
        <Link href={feedHref}>League adds / drops</Link>
      </p>

      {!board.hasTransactions ? (
        <EmptyState title="No transactions in this snapshot">
          Hall of Shame reads synced <code>transactions.json</code>. ESPN
          recent activity is empty before 2019; older seasons need a re-sync
          after the <code>mTransactions2</code> fallback. Very active baseball
          seasons may still miss early drops if sync hit its page or period
          cap.
        </EmptyState>
      ) : !board.rows.length ? (
        <EmptyState title="No drops in the synced activity">
          Adds and drops appear after sync when ESPN returns executed
          FREEAGENT / WAIVER rows. Trades alone do not fill this board.
        </EmptyState>
      ) : (
        <>
          <section style={{ marginTop: "1rem" }}>
            <div className="game-log-head">
              <h3 className="roster-group-title">League worst drops</h3>
              <p className="league-meta" style={{ margin: 0 }}>
                {board.dropCount === 1
                  ? "1 first drop"
                  : `${board.dropCount} first drops`}
                {board.dropCount > WORST_DROPS_LEAGUE_LIMIT
                  ? ` · top ${WORST_DROPS_LEAGUE_LIMIT} by Season FP`
                  : ""}
              </p>
            </div>
            <DropTable
              league={league}
              rows={board.leagueTop}
              viewerTeamId={viewerTeamId}
              showTeam
            />
          </section>

          {board.byTeam.map((section) => (
            <section key={section.teamId} style={{ marginTop: "1.25rem" }}>
              <div className="game-log-head">
                <h3 className="roster-group-title">{section.teamName}</h3>
                <p className="league-meta" style={{ margin: 0 }}>
                  {section.ownerLabel}
                  {section.rows.length === 1
                    ? " · 1 drop"
                    : ` · ${section.rows.length} drops`}
                </p>
              </div>
              <DropTable
                league={league}
                rows={section.rows}
                viewerTeamId={viewerTeamId}
                showTeam={false}
              />
            </section>
          ))}
        </>
      )}
    </div>
  );
}
