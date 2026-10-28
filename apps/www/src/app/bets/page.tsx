import type { Metadata } from "next";

import { BetsBoard, BetsEmpty, BetsTabs, BetsToolbar } from "@/components/BetsBoard";
import { OptionsBoard, OptionsEmpty } from "@/components/OptionsBoard";
import { ParlayBoard, ParlayEmpty } from "@/components/ParlayBoard";
import { PublicBoard, PublicEmpty } from "@/components/PublicBoard";
import { SplitsBoard, SplitsEmpty } from "@/components/SplitsBoard";
import { TailingBoard, TailingEmpty } from "@/components/TailingBoard";
import {
  bettorKpis,
  filterBets,
  parseBetTab,
  parseBetWindow,
  parseBettor,
  uniqueBettors,
  uniqueSports,
} from "@/lib/bets";
import {
  filterParlayLegs,
  parlayKpis,
  uniqueParlayBettors,
  uniqueParlaySports,
} from "@/lib/bets-parlay";
import { filterWarnings, publicKpis, uniqueWarningSports } from "@/lib/bets-public";
import {
  filterOptionTrades,
  parseOptionFilter,
  uniqueOptionTraders,
  uniqueOptionValues,
} from "@/lib/bets-options";
import { uniqueSplitBettors } from "@/lib/bets-splits";
import { filterTailLegs, uniqueTailBettors } from "@/lib/bets-tailing";
import {
  getBetsDocument,
  getOptionsDocument,
  getParlayDocument,
  getPublicDocument,
  getSplitsDocument,
  getTailingDocument,
} from "@/lib/bets-store";
import { requireBetsActor } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Bets",
  robots: { index: false, follow: false },
  description:
    "Members-only tracker for public slips, options fills, parlay legs, tailing splits, and BetMGM public-money fades.",
};

type Props = {
  searchParams: Promise<{
    tab?: string;
    window?: string;
    sport?: string;
    who?: string;
    pick?: string;
    plat?: string;
    size?: string;
    month?: string;
    ou?: string;
    type?: string;
    status?: string;
  }>;
};

export default async function BetsPage({ searchParams }: Props) {
  const actor = await requireBetsActor("/bets");
  const params = await searchParams;
  const tab = parseBetTab(params.tab);
  const window = parseBetWindow(params.window);
  const sport = (params.sport || "").trim();
  const [betsDoc, parlayDoc, publicDoc, splitsDoc, tailingDoc, optionsDoc] =
    await Promise.all([
      getBetsDocument(),
      getParlayDocument(),
      getPublicDocument(),
      getSplitsDocument(),
      getTailingDocument(),
      getOptionsDocument(),
    ]);
  const names = uniqueBettors(betsDoc.bets);
  const who = parseBettor(params.who, [
    ...names,
    ...uniqueParlayBettors(parlayDoc.legs),
    ...uniqueSplitBettors(splitsDoc.splits),
    ...uniqueTailBettors(tailingDoc.legs),
    ...uniqueOptionTraders(optionsDoc.trades),
  ]);
  const optionType = parseOptionFilter(
    params.type,
    uniqueOptionValues(optionsDoc.trades, "type"),
  );
  const optionStatus = parseOptionFilter(
    params.status,
    uniqueOptionValues(optionsDoc.trades, "status"),
  );
  const tailFilters = {
    who: who || null,
    sport: sport || null,
    pick: (params.pick || "").trim() || null,
    plat: (params.plat || "").trim() || null,
    size: (params.size || "").trim() || null,
    month: (params.month || "").trim() || null,
    ou: (params.ou || "").trim() || null,
  };

  const filtered = filterBets(betsDoc.bets, {
    window,
    sport: sport || null,
    who: who || null,
  });
  const filteredForCards = filterBets(betsDoc.bets, {
    window,
    sport: sport || null,
  });
  const cardNames = uniqueBettors(filteredForCards);
  const kpis = cardNames.map((name) => bettorKpis(filteredForCards, name));
  const combined = bettorKpis(filteredForCards);

  const parlayFiltered = filterParlayLegs(parlayDoc.legs, {
    who: who || null,
    sport: sport || null,
    window,
  });
  const parlayForCards = filterParlayLegs(parlayDoc.legs, {
    sport: sport || null,
    window,
  });
  const parlayNames = uniqueParlayBettors(parlayForCards);
  const parlayKpiCards = parlayNames.map((name) => parlayKpis(parlayForCards, name));
  const parlayCombined = parlayKpis(parlayForCards);

  const publicFiltered = filterWarnings(publicDoc.warnings, {
    sport: sport || null,
    window,
  });

  return (
    <main className="bets-page">
      <section className="page-hero" aria-label="Bets">
        <p className="hero-kicker">Public slips</p>
        <h1>Bets</h1>
        <p>
          Tracked public posters — records, ROI, parlay-leg hit rates, tailing
          splits, record splits, John Ewing&apos;s BetMGM public-money fades,
          and posted options fills. Members only.
        </p>
        <p className="page-hero-meta">
          {betsDoc.bet_count ?? betsDoc.bets.length} slips ·{" "}
          {parlayDoc.leg_count ?? parlayDoc.legs.length} legs ·{" "}
          {publicDoc.warning_count ?? publicDoc.warnings.length} warnings ·{" "}
          {splitsDoc.split_count ?? splitsDoc.splits.length} splits ·{" "}
          {tailingDoc.settled_count ?? tailingDoc.legs.length} tail legs ·{" "}
          {optionsDoc.trade_count ?? optionsDoc.trades.length} option rows
        </p>
      </section>
      <BetsToolbar actor={actor} />
      <BetsTabs tab={tab} window={window} sport={sport} who={who} />
      {tab === "parlays" ? (
        !parlayDoc.legs.length ? (
          <ParlayEmpty />
        ) : (
          <ParlayBoard
            document={parlayDoc}
            legs={parlayFiltered}
            names={parlayNames}
            sports={uniqueParlaySports(parlayDoc.legs)}
            window={window}
            sport={sport}
            who={who}
            kpis={parlayKpiCards}
            combined={parlayCombined}
          />
        )
      ) : tab === "warnings" ? (
        !publicDoc.warnings.length ? (
          <PublicEmpty />
        ) : (
          <PublicBoard
            document={publicDoc}
            warnings={publicFiltered}
            sports={uniqueWarningSports(publicDoc.warnings)}
            window={window}
            sport={sport}
            who={who}
            kpi={publicKpis(publicFiltered)}
          />
        )
      ) : tab === "splits" ? (
        !splitsDoc.splits.length ? (
          <SplitsEmpty />
        ) : (
          <SplitsBoard
            document={splitsDoc}
            window={window}
            sport={sport}
            who={who}
          />
        )
      ) : tab === "tail" ? (
        !tailingDoc.legs.length ? (
          <TailingEmpty />
        ) : (
          <TailingBoard
            document={tailingDoc}
            legs={filterTailLegs(tailingDoc.legs, tailFilters)}
            window={window}
            who={who}
            filters={tailFilters}
          />
        )
      ) : tab === "options" ? (
        !optionsDoc.trades.length ? (
          <OptionsEmpty />
        ) : (
          <OptionsBoard
            document={optionsDoc}
            trades={filterOptionTrades(optionsDoc.trades, {
              trader: who || null,
              type: optionType || null,
              status: optionStatus || null,
            })}
            traders={optionsDoc.traders}
            who={who}
            type={optionType}
            status={optionStatus}
          />
        )
      ) : !betsDoc.bets.length ? (
        <BetsEmpty />
      ) : (
        <BetsBoard
          document={betsDoc}
          bets={filtered}
          allBets={betsDoc.bets}
          window={window}
          sport={sport}
          who={who}
          sports={uniqueSports(betsDoc.bets)}
          kpis={kpis}
          combined={combined}
        />
      )}
    </main>
  );
}
