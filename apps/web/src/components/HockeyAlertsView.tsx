import { EmptyState } from "@/components/EmptyState";
import { TeamForm, dayLabel } from "@/components/HockeyDailyViews";
import type { DecisionQuery } from "@/components/HockeyDecisionViews";
import { HockeyInjuryDigestButton } from "@/components/HockeyInjuryDigestButton";
import type { LeagueSnapshot } from "@/lib/data";
import {
  alertDay,
  espnNewsUrl,
  injuryDiscordEnabled,
  injuryNews,
  lineupAlerts,
  type AlertSeverity,
  type HockeyInjuryLog,
} from "@/lib/hockey-alerts";
import type { HockeyBioIndex, HockeyLinesSnapshot } from "@/lib/hockey-nhl";
import { canAccessAdmin, parseAllowedEmailsEnv } from "@/lib/hub-members";
import { readHubMembers } from "@/lib/hub-members-store";
import { devBypassEnabled } from "@/lib/session";
import { getViewer } from "@/lib/viewer";

/** Status never rides on color alone: icon + word. */
const SEVERITY: Record<AlertSeverity, { icon: string; label: string }> = {
  high: { icon: "⛔", label: "Fix" },
  medium: { icon: "⚠️", label: "Check" },
  low: { icon: "ℹ️", label: "FYI" },
};

const CHANGE: Record<string, string> = {
  hurt: "Hurt",
  nearing_return: "Nearing return",
  back: "Back",
};

export async function HockeyAlertsView({
  league,
  log,
  lines,
  bios,
  query,
  viewerTeamId,
}: {
  league: LeagueSnapshot;
  log: HockeyInjuryLog | null | undefined;
  lines: HockeyLinesSnapshot | null | undefined;
  bios: HockeyBioIndex;
  query: DecisionQuery;
  viewerTeamId?: number;
}) {
  const day = alertDay(lines, log);
  const alerts = lineupAlerts(league, query.teamId, log, lines, bios, day);
  const news = injuryNews(log, league);
  const viewer = await getViewer();
  const members = await readHubMembers().catch(() => null);
  const isAdmin =
    devBypassEnabled() ||
    canAccessAdmin(viewer.email, members, {
      envAllowlist: parseAllowedEmailsEnv(process.env.ALLOWED_EMAILS),
      adminEmailsEnv: parseAllowedEmailsEnv(process.env.ADMIN_EMAILS),
    });
  const teamName = league.teams.find((t) => t.team_id === query.teamId)?.name ?? "this team";

  return (
    <section style={{ marginTop: "0.75rem" }}>
      <TeamForm league={league} view="alerts" query={query} viewerTeamId={viewerTeamId} />
      <h3 className="roster-group-title">Lineup alerts — {teamName}</h3>
      <p className="league-meta" style={{ marginTop: 0 }}>
        As of the last sync ({dayLabel(day)}): ESPN lineup slots, ESPN and Daily Faceoff injury statuses, and
        Daily Faceoff&rsquo;s starting goalies. Set the lineup on ESPN.
      </p>
      {alerts.length ? (
        <ul className="alert-list">
          {alerts.map((a) => (
            <li key={a.id} className={`alert-item alert-${a.severity}`}>
              <span className="alert-badge">
                <span aria-hidden="true">{SEVERITY[a.severity].icon}</span> {SEVERITY[a.severity].label}
              </span>{" "}
              <a href={a.newsUrl} target="_blank" rel="noreferrer">
                {a.name}
              </a>{" "}
              {a.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="lede">No lineup alerts for {teamName}.</p>
      )}

      <h3 className="roster-group-title">Injury news — last 14 days</h3>
      {!log ? (
        <EmptyState title="No injury log yet">
          The hockey sync writes <code>nhl/injury_log.json</code>; the first sync records a baseline and later
          syncs log who got hurt, who is nearing a return, and who is back.
        </EmptyState>
      ) : news.length ? (
        <div className="panel table-scroll">
          <table className="table-cards">
            <thead>
              <tr>
                <th>Date</th>
                <th>Player</th>
                <th>Team</th>
                <th>Change</th>
                <th>Now</th>
              </tr>
            </thead>
            <tbody>
              {news.map((n) => (
                <tr key={n.id} className={n.team_id === query.teamId ? "is-viewer" : undefined}>
                  <td data-label="Date">{dayLabel(n.at.slice(0, 10))}</td>
                  <td data-label="Player">
                    <a href={espnNewsUrl(n.espn_id)} target="_blank" rel="noreferrer">
                      {n.name ?? "Player"}
                    </a>
                    <span className="league-meta"> · {n.nhl_team ?? "—"}</span>
                  </td>
                  <td data-label="Team">{n.teamName ?? "—"}</td>
                  <td data-label="Change">
                    {CHANGE[n.kind]}{" "}
                    <span className="league-meta">
                      ({n.from} → {n.to})
                    </span>
                  </td>
                  <td data-label="Now">
                    {[n.espn ? `ESPN ${n.espn.replace(/_/g, " ").toLowerCase()}` : null, n.dfo ? `DFO ${n.dfo.toUpperCase()}` : null]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="lede">No injury changes for rostered players in the last 14 days.</p>
      )}
      <p className="league-meta">Player names open their ESPN news page.</p>

      {isAdmin ? (
        <HockeyInjuryDigestButton leagueId={league.league_id} season={league.season} enabled={injuryDiscordEnabled()} />
      ) : null}
    </section>
  );
}
