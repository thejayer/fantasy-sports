import type { Metadata } from "next";

import { BetsBoard, BetsEmpty } from "@/components/BetsBoard";
import {
  bettorKpis,
  filterBets,
  parseBetWindow,
  uniqueSports,
} from "@/lib/bets";
import { getBetsDocument } from "@/lib/bets-store";
import { requireBetsActor } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Bets",
  robots: { index: false, follow: false },
  description:
    "Members-only tracker for public bets from Trent Attyah and Steve Will Do It.",
};

type Props = {
  searchParams: Promise<{ window?: string; sport?: string }>;
};

export default async function BetsPage({ searchParams }: Props) {
  const actor = await requireBetsActor("/bets");
  const params = await searchParams;
  const window = parseBetWindow(params.window);
  const sport = (params.sport || "").trim();
  const document = await getBetsDocument();
  const filtered = filterBets(document.bets, { window, sport: sport || null });
  const sports = uniqueSports(document.bets);
  const trent = bettorKpis(filtered, "Trent");
  const steve = bettorKpis(filtered, "Steve");

  return (
    <main className="bets-page">
      <section className="page-hero" aria-label="Bets">
        <p className="hero-kicker">Public slips</p>
        <h1>Bets</h1>
        <p>
          Trent Attyah (@BookitWithTrent) vs Steve Will Do It (@stevewilldoit) —
          every tracked slip since August 1, 2026. Members only.
        </p>
        <p className="page-hero-meta">
          {document.bet_count ?? document.bets.length} slips on file
        </p>
      </section>
      {!document.bets.length ? (
        <BetsEmpty />
      ) : (
        <BetsBoard
          document={document}
          bets={filtered}
          window={window}
          sport={sport}
          sports={sports}
          trent={trent}
          steve={steve}
          actor={actor}
        />
      )}
    </main>
  );
}
