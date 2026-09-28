import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/EmptyState";
import { StatChips } from "@/components/StatChips";
import { TeamAvatar } from "@/components/TeamAvatar";
import { ViewerBadge } from "@/components/ViewerBadge";
import { getLeagueHistoryArchive, getLeagueSnapshot } from "@/lib/data";
import { espnTeamUrl } from "@/lib/espn-links";
import {
  formatPoints,
  formatWinPct,
  franchiseCareer,
  recordLabelFromCounts,
} from "@/lib/history";
import { getViewerTeamId } from "@/lib/viewer";

// See app/page.tsx — snapshots only exist at runtime.
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ leagueId: string; teamId: string }>;
};

export default async function FranchisePage({ params }: Props) {
  const { leagueId, teamId } = await params;
  const parsedId = Number(teamId);
  if (!Number.isInteger(parsedId)) notFound();

  const archive = await getLeagueHistoryArchive(leagueId);
  if (!archive) notFound();

  const career = franchiseCareer(archive, parsedId);
  if (!career) notFound();

  const latest = await getLeagueSnapshot(leagueId);
  const logoUrl =
    latest?.teams.find((team) => team.team_id === parsedId)?.logo_url ?? null;
  const isViewer = (await getViewerTeamId(leagueId)) === parsedId;
  const currentSeason = career.seasons[0]?.season ?? latest?.season;
  const espnUrl = latest
    ? espnTeamUrl(
        {
          sport: latest.sport,
          espnLeagueId: latest.espn_league_id,
          season: currentSeason ?? latest.season,
        },
        parsedId,
      )
    : null;

  const totals = career.totals;
  const chips = totals
    ? [
        { label: "Seasons", value: String(totals.seasons) },
        {
          label: "Record",
          value: recordLabelFromCounts(totals.wins, totals.losses, totals.ties),
        },
        { label: "Win%", value: formatWinPct(totals.winPct) },
        { label: "Points for", value: formatPoints(totals.pointsFor) },
        { label: "Points against", value: formatPoints(totals.pointsAgainst) },
        { label: "#1 finishes", value: String(totals.championships) },
      ]
    : [];

  return (
    <main className={`section league-view sport-${archive.sport}`}>
      <div className="league-kicker">
        <Link className="league-meta" href={`/leagues/${leagueId}?tab=history`}>
          {archive.name}
        </Link>
        <span className="league-meta">franchise history</span>
      </div>

      <h2>
        <TeamAvatar name={career.name} logoUrl={logoUrl} size="lg" />
        {career.name}
        {isViewer ? <ViewerBadge label="Your team" /> : null}
      </h2>
      <p className="lede">
        {career.owners.join(", ") || "Owner TBD"} · keyed by franchise id{" "}
        {career.teamId}, so a rename or a new owner keeps the same history.
      </p>

      <StatChips lines={chips} />

      <section className="player-section">
        <h3 className="roster-group-title">Season by season</h3>
        <div className="panel table-scroll">
          <table className="table-cards">
            <thead>
              <tr>
                <th>Season</th>
                <th>Team name</th>
                <th>Finish</th>
                <th>Record</th>
                <th className="numeric">Win%</th>
                <th className="numeric">PF</th>
                <th className="numeric">PA</th>
                <th className="numeric">High</th>
                <th className="numeric">Low</th>
              </tr>
            </thead>
            <tbody>
              {career.seasons.map((row) => (
                <tr key={row.season}>
                  <td data-label="Season">
                    <Link
                      href={`/leagues/${leagueId}/teams/${career.teamId}?season=${row.season}`}
                    >
                      {row.season}
                    </Link>
                  </td>
                  <td data-label="Team name">{row.name}</td>
                  <td data-label="Finish">
                    {row.standing == null
                      ? "—"
                      : row.standing === 1
                        ? "1st"
                        : `#${row.standing}`}
                  </td>
                  <td data-label="Record">
                    {recordLabelFromCounts(row.wins, row.losses, row.ties)}
                  </td>
                  <td data-label="Win%" className="numeric">
                    {formatWinPct(row.winPct)}
                  </td>
                  <td data-label="PF" className="numeric">
                    {formatPoints(row.pointsFor)}
                  </td>
                  <td data-label="PA" className="numeric">
                    {formatPoints(row.pointsAgainst)}
                  </td>
                  <td data-label="High" className="numeric">
                    {formatPoints(row.high)}
                  </td>
                  <td data-label="Low" className="numeric">
                    {formatPoints(row.low)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="player-section">
        <h3 className="roster-group-title">Rivalries</h3>
        {!career.rivals.length ? (
          <EmptyState title="No completed head-to-head games">
            Series records appear once this franchise has played decided
            matchups in a synced season.
          </EmptyState>
        ) : (
          <div className="panel table-scroll">
            <table className="table-cards">
              <thead>
                <tr>
                  <th>Opponent</th>
                  <th>Series</th>
                  <th className="numeric">Win%</th>
                  <th className="numeric">Games</th>
                  <th className="numeric">PF</th>
                  <th className="numeric">PA</th>
                </tr>
              </thead>
              <tbody>
                {career.rivals.map((rival) => (
                  <tr key={rival.opponentId}>
                    <td data-label="Opponent">
                      <Link
                        href={`/leagues/${leagueId}/franchises/${rival.opponentId}`}
                      >
                        {rival.name}
                      </Link>
                    </td>
                    <td data-label="Series">
                      {recordLabelFromCounts(rival.wins, rival.losses, rival.ties)}
                    </td>
                    <td data-label="Win%" className="numeric">
                      {formatWinPct(rival.winPct)}
                    </td>
                    <td data-label="Games" className="numeric">
                      {rival.games.length}
                    </td>
                    <td data-label="PF" className="numeric">
                      {formatPoints(rival.pointsFor)}
                    </td>
                    <td data-label="PA" className="numeric">
                      {formatPoints(rival.pointsAgainst)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted">
          Full game logs live on the league{" "}
          <Link
            href={`/leagues/${leagueId}?tab=history&view=h2h&a=${career.teamId}`}
          >
            head-to-head view
          </Link>
          .
        </p>
      </section>

      {espnUrl ? (
        <p className="muted">
          <a href={espnUrl} rel="noreferrer noopener" target="_blank">
            Open this team on ESPN ↗
          </a>
        </p>
      ) : null}
    </main>
  );
}
