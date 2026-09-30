import Link from "next/link";

import { EmptyState } from "@/components/EmptyState";
import { PlayerName } from "@/components/HockeyDecisionViews";
import { HockeyTagEditor, type TagOption } from "@/components/HockeyTagEditor";
import type { LeagueSnapshot } from "@/lib/data";
import { decisionRow, type DecisionContext } from "@/lib/hockey-decisions";
import { formatValue } from "@/lib/hockey-values";
import type { MemberPrefs } from "@/lib/member-prefs";

/** H8 "My tags": your private tags, notes, Keep and Watch lists. */
export function HockeyTagsView({
  league,
  ctx,
  prefs,
  signedIn,
  editId,
}: {
  league: LeagueSnapshot;
  ctx: DecisionContext;
  prefs: MemberPrefs | null;
  signedIn: boolean;
  editId?: string | null;
}) {
  if (!signedIn) {
    return (
      <EmptyState title="Sign in to tag players">
        Tags and notes are saved to your hub account and only you see them.
      </EmptyState>
    );
  }
  const players = ctx.values?.players ?? {};
  const teamName = new Map(league.teams.map((t) => [t.team_id, t.abbrev || t.name]));
  const options: TagOption[] = Object.entries(players)
    .map(([id, p]) => ({
      espnId: id,
      label: `${p.name ?? id} (${p.position ?? p.group}, ${
        p.rostered ? (teamName.get(p.fantasy_team_id ?? -1) ?? "rostered") : "FA"
      })`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const tagged = Object.entries(prefs?.players ?? {})
    .filter(([id]) => players[id])
    .map(([id, pref]) => decisionRow(id, players[id]!, ctx.bios, ctx.schedule, ctx.start, pref))
    .sort((a, b) => (a.player.name ?? "").localeCompare(b.player.name ?? ""));

  return (
    <section style={{ marginTop: "0.75rem" }}>
      <p className="lede" style={{ marginTop: 0 }}>
        Your own tags — only you see them. Role and power-play tags replace the automatic role in your tools;
        <strong> Keep</strong> protects a player from drop suggestions (🔒), and <strong>Watch</strong> puts a free
        agent on your watchlist (★, Waiver board → Watchlist). Tags never change a player&rsquo;s value.
      </p>
      <HockeyTagEditor key={editId ?? "new"} leagueId={league.league_id} options={options} current={prefs?.players ?? {}} initialId={editId} />
      <h3 className="roster-group-title">Tagged players ({tagged.length})</h3>
      {tagged.length ? (
        <div className="panel table-scroll">
          <table className="table-cards">
            <thead>
              <tr>
                <th>Player</th>
                <th>Team</th>
                <th className="numeric">Value</th>
                <th>Note</th>
                <th>
                  <span className="sr-only">Edit</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {tagged.map((row) => (
                <tr key={row.espnId}>
                  <td data-label="Player">
                    <PlayerName row={row} />
                  </td>
                  <td data-label="Team">
                    {row.player.rostered ? (teamName.get(row.player.fantasy_team_id ?? -1) ?? "—") : "Free agent"}
                  </td>
                  <td className="numeric" data-label="Value">
                    {formatValue(row.value)}
                  </td>
                  <td data-label="Note">{row.note || "—"}</td>
                  <td data-label="">
                    <Link
                      href={`/leagues/${league.league_id}?season=${league.season}&tab=tools&view=tags&edit=${row.espnId}`}
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="league-meta">No tagged players yet.</p>
      )}
    </section>
  );
}
