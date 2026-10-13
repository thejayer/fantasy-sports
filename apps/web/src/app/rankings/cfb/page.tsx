import Link from "next/link";

import { AiRankingsBoard } from "@/components/AiRankingsBoard";
import { resolveWeekLabel } from "@/lib/ai-rankings";
import { getAiRankingsIndex, getAiRankingsSnapshot } from "@/lib/data";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ week?: string }>;
};

export default async function CfbRankingsPage({ searchParams }: Props) {
  const { week: weekParam } = await searchParams;
  const index = await getAiRankingsIndex("cfb");
  const week = resolveWeekLabel(index, weekParam);
  const snapshot = week ? await getAiRankingsSnapshot("cfb", week) : null;

  return (
    <main className="section">
      <div className="section-head">
        <div>
          <p className="ai-rank-crumb">
            <Link href="/rankings">AI Rankings</Link>
            {" / "}
            <span>College football</span>
            {" · "}
            <Link href="/rankings/fantasy">Fantasy</Link>
          </p>
          <h2>College football</h2>
          <p className="lede">
            Weekly Top 25 from completed FBS results — margins, opponents, and
            venue. Compared to the AP poll when College Football Data has it.
          </p>
        </div>
      </div>
      <AiRankingsBoard
        snapshot={snapshot}
        index={index}
        hrefForWeek={(label) => `/rankings/cfb?week=${encodeURIComponent(label)}`}
        emptyTitle="No CFB ballot this week"
        emptyBody="The Sunday job needs a College Football Data API key (sj-cfbd-api-key) and a rankings model key. Until then this board stays empty."
        showAp
        showFull
      />
    </main>
  );
}
