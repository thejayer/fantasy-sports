import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { TeamAvatar } from "@/components/TeamAvatar";
import { ViewerBadge } from "@/components/ViewerBadge";
import { getLatestLeagues, getLeagueSnapshot } from "@/lib/data";
import { recordLabel, sportFormatLabel, winPctLabel } from "@/lib/league";
import { syncedLabel } from "@/lib/member-home";
import { getViewer } from "@/lib/viewer";

// See app/page.tsx: prerendering would freeze this list at the build-time
// fixtures instead of reflecting the synced snapshots.
export const dynamic = "force-dynamic";

export default async function LeaguesPage() {
  const leagues = await getLatestLeagues();
  const viewer = await getViewer();

  // One extra snapshot read per league buys the member's own standing on the
  // index — the thing every competitor puts here (roadmap 7.2). Reads are
  // cached and deduped per request.
  const rows = await Promise.all(
    leagues.map(async (league) => {
      const link = viewer.franchises.find(
        (franchise) => franchise.league_id === league.league_id,
      );
      if (!link) return { league, team: null, synced: league.synced_at };
      const snapshot = await getLeagueSnapshot(league.league_id, league.season);
      const team =
        snapshot?.teams.find((item) => item.team_id === link.team_id) ?? null;
      return { league, team, synced: snapshot?.synced_at ?? league.synced_at };
    }),
  );

  return (
    <main className="section">
      <div className="section-head">
        <div>
          <h2>Leagues</h2>
          <p className="lede">
            Strictly Jayers leagues — ESPN football/baseball snapshots plus
            hub-native golf. Open one for standings, history, and rosters.
          </p>
        </div>
        <Link className="button" href="/leagues/new">
          Create golf league
        </Link>
      </div>
      <div className="league-list">
        {rows.map(({ league, team, synced }) => {
          const age = syncedLabel(synced);
          return (
            <Link
              key={league.league_id}
              className={`league-link${team ? " is-viewer" : ""}`}
              href={`/leagues/${league.league_id}`}
            >
              <div className="league-link-body">
                <strong>
                  {league.name}
                  {team ? <ViewerBadge /> : null}
                </strong>
                <div className="league-meta">
                  {sportFormatLabel(league.sport, league.format)} · season{" "}
                  {league.season} · {league.team_count} teams
                  {age ? ` · synced ${age}` : ""}
                </div>
                {team ? (
                  <div className="league-link-team">
                    <TeamAvatar name={team.name} logoUrl={team.logo_url} />
                    <span className="league-meta">
                      {team.name} · {recordLabel(team)} ({winPctLabel(team)})
                      {team.standing != null
                        ? ` · ${team.standing} of ${league.team_count}`
                        : ""}
                    </span>
                  </div>
                ) : null}
              </div>
              <span className="pill">{league.format}</span>
            </Link>
          );
        })}
        {!leagues.length ? (
          <EmptyState title="No league snapshots yet">
            Run <code>sj sync</code> with ESPN credentials,{" "}
            <code>sj seed</code> / committed fixtures, or create a golf league.
          </EmptyState>
        ) : null}
      </div>
    </main>
  );
}
