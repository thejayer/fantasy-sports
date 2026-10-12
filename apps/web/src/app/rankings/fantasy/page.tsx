import Link from "next/link";

import { AiRankingsBoard } from "@/components/AiRankingsBoard";
import {
  AI_RANKINGS_FANTASY_LEAGUES,
  FANTASY_LEAGUE_LABELS,
  resolveWeekLabel,
} from "@/lib/ai-rankings";
import { getAiRankingsIndex, getAiRankingsSnapshot } from "@/lib/data";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ league?: string; week?: string }>;
};

export default async function FantasyRankingsPage({ searchParams }: Props) {
  const { league: leagueParam, week: weekParam } = await searchParams;
  const leagueId = AI_RANKINGS_FANTASY_LEAGUES.includes(
    leagueParam as (typeof AI_RANKINGS_FANTASY_LEAGUES)[number],
  )
    ? (leagueParam as string)
    : "football-main";

  const boards = await Promise.all(
    AI_RANKINGS_FANTASY_LEAGUES.map(async (id) => {
      const index = await getAiRankingsIndex("fantasy", id);
      return { id, index };
    }),
  );
  const current = boards.find((row) => row.id === leagueId) ?? boards[0];
  const week = resolveWeekLabel(current.index, weekParam);
  const snapshot = week
    ? await getAiRankingsSnapshot("fantasy", week, current.id)
    : null;

  return (
    <main className="section">
      <div className="section-head">
        <div>
          <p className="ai-rank-crumb">
            <Link href="/rankings">AI Rankings</Link>
            {" · "}
            <Link href="/rankings/cfb">College football</Link>
          </p>
          <h2>Fantasy power rankings</h2>
          <p className="lede">
            One model ranks each in-season (or offseason) league from records,
            points, recent form, and roster strength in the ESPN snapshot.
          </p>
        </div>
      </div>
      <div className="season-switch" aria-label="League">
        {boards.map(({ id }) => (
          <Link
            key={id}
            href={`/rankings/fantasy?league=${id}`}
            className={`season-chip${id === current.id ? " active" : ""}`}
          >
            {FANTASY_LEAGUE_LABELS[id] ?? id}
          </Link>
        ))}
      </div>
      <AiRankingsBoard
        snapshot={snapshot}
        index={current.index}
        hrefForWeek={(label) =>
          `/rankings/fantasy?league=${encodeURIComponent(current.id)}&week=${encodeURIComponent(label)}`
        }
        emptyTitle="No fantasy ballot this week"
        emptyBody="The Monday job reads ESPN snapshots in the shared store and needs SJ_RANKINGS_API_KEY. Until a week is written, this board stays empty."
      />
    </main>
  );
}
