import Link from "next/link";

import {
  AI_RANKINGS_FANTASY_LEAGUES,
  FANTASY_LEAGUE_LABELS,
  formatWeekChip,
  modelLabel,
} from "@/lib/ai-rankings";
import { getAiRankingsIndex, getAiRankingsSnapshot } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function RankingsHomePage() {
  const cfbIndex = await getAiRankingsIndex("cfb");
  const cfbWeek = cfbIndex?.latest ?? cfbIndex?.weeks.at(-1) ?? null;
  const cfb = cfbWeek
    ? await getAiRankingsSnapshot("cfb", cfbWeek)
    : null;

  const fantasy = await Promise.all(
    AI_RANKINGS_FANTASY_LEAGUES.map(async (leagueId) => {
      const index = await getAiRankingsIndex("fantasy", leagueId);
      const week = index?.latest ?? index?.weeks.at(-1) ?? null;
      const snapshot = week
        ? await getAiRankingsSnapshot("fantasy", week, leagueId)
        : null;
      return { leagueId, snapshot };
    }),
  );

  return (
    <main className="section">
      <div className="section-head">
        <div>
          <h2>AI Rankings</h2>
          <p className="lede">
            One model, one ballot a week — college football Top 25 and power
            rankings for Strictly Jayers leagues. Not an average of five
            chatbots.
          </p>
        </div>
      </div>
      <div className="league-list">
        <Link className="league-link" href="/rankings/cfb">
          <div className="league-link-body">
            <strong>College football</strong>
            <div className="league-meta">
              {cfb
                ? `${cfb.headline ?? "Top 25"} · ${formatWeekChip(cfb.week_label)} · ${modelLabel(cfb.model)}`
                : "No CFB ballot yet — Sunday morning job writes this board."}
            </div>
          </div>
          <span className="pill">FBS</span>
        </Link>
        <Link className="league-link" href="/rankings/fantasy">
          <div className="league-link-body">
            <strong>Fantasy power rankings</strong>
            <div className="league-meta">
              {fantasy
                .map(({ leagueId, snapshot }) =>
                  snapshot
                    ? `${FANTASY_LEAGUE_LABELS[leagueId] ?? leagueId} ${formatWeekChip(snapshot.week_label)}`
                    : null,
                )
                .filter(Boolean)
                .join(" · ") ||
                "Baseball, both footballs, and hockey — Monday morning job."}
            </div>
          </div>
          <span className="pill">Leagues</span>
        </Link>
      </div>
    </main>
  );
}
