import Link from "next/link";

import { EmptyState } from "@/components/EmptyState";
import { RecapGenerateButton } from "@/components/RecapGenerateButton";
import type { LeagueSnapshot } from "@/lib/data";
import { buildWeeklyDigest, latestDigestPeriod } from "@/lib/digest";
import {
  recapFactsFromLeague,
  recapSport,
  type RecapArticle,
} from "@/lib/recap";
import { listRecapPeriods, readRecap } from "@/lib/recap-store";
import {
  canAccessAdmin,
  parseAllowedEmailsEnv,
} from "@/lib/hub-members";
import { readHubMembers } from "@/lib/hub-members-store";
import { getViewer } from "@/lib/viewer";
import { devBypassEnabled } from "@/lib/session";

function RecapArticleView({
  article,
  factsNames,
}: {
  article: RecapArticle;
  factsNames: Map<number, { name: string; rank: number; record: string }>;
}) {
  return (
    <article className="recap-article">
      <p className="recap-kicker">
        {article.sport === "baseball" ? "Period" : "Week"} {article.period} ·{" "}
        {article.model.startsWith("template") || article.model === "fixture"
          ? "House column"
          : "AI column"}
      </p>
      <h2 className="recap-headline">{article.headline}</h2>
      <p className="recap-dek">{article.dek}</p>
      <div className="recap-body">
        {article.body.map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>
      <h3 className="recap-rank-heading">Power rankings</h3>
      <ol className="recap-rankings">
        {[...article.ranking_copy]
          .filter(
            (row, index, rows) =>
              rows.findIndex((other) => other.team_id === row.team_id) ===
              index,
          )
          .sort(
            (a, b) =>
              (factsNames.get(a.team_id)?.rank ?? 99) -
              (factsNames.get(b.team_id)?.rank ?? 99),
          )
          .map((row) => {
            const meta = factsNames.get(row.team_id);
            return (
              <li key={row.team_id}>
                <div className="recap-rank-head">
                  <span className="recap-rank-num">{meta?.rank ?? "–"}</span>
                  <strong>{meta?.name ?? `Team ${row.team_id}`}</strong>
                  {meta?.record ? (
                    <span className="league-meta">{meta.record}</span>
                  ) : null}
                </div>
                <p>{row.blurb}</p>
              </li>
            );
          })}
      </ol>
    </article>
  );
}

export async function RecapPanel({
  league,
  week,
}: {
  league: LeagueSnapshot;
  week?: number;
}) {
  const sport = recapSport(league.sport);
  if (!sport) {
    return (
      <EmptyState title="No recap desk for this sport">
        Weekly columns run on football and baseball. Golf stays on the
        scoreboard.
      </EmptyState>
    );
  }

  const stored = await listRecapPeriods(league.league_id, league.season);
  const digestPeriod = latestDigestPeriod(league);
  const decided: number[] = [];
  if (digestPeriod != null) {
    for (let period = 1; period <= digestPeriod; period++) {
      if (buildWeeklyDigest(league, period)) decided.push(period);
    }
  }
  const chips = [...new Set([...stored, ...decided])].sort((a, b) => a - b);
  const fallback = stored.at(-1) ?? digestPeriod ?? null;
  const active =
    week != null && chips.includes(week) ? week : (fallback ?? week ?? null);

  const article =
    active != null
      ? await readRecap(league.league_id, league.season, active)
      : null;
  const facts = active != null ? recapFactsFromLeague(league, active) : null;
  const factsNames = new Map(
    (facts?.rankings ?? []).map((row) => [
      row.teamId,
      { name: row.name, rank: row.rank, record: row.record },
    ]),
  );

  const viewer = await getViewer();
  const members = await readHubMembers().catch(() => null);
  const canWrite =
    devBypassEnabled() ||
    canAccessAdmin(viewer.email, members, {
      envAllowlist: parseAllowedEmailsEnv(process.env.ALLOWED_EMAILS),
      adminEmailsEnv: parseAllowedEmailsEnv(process.env.ADMIN_EMAILS),
    });

  const periodLabel = league.period_label || (sport === "baseball" ? "period" : "week");

  return (
    <section className="recap-panel" aria-labelledby="recap-heading">
      <h2 id="recap-heading" className="section-title">
        Weekly recap
      </h2>
      <p className="lede">
        Funny power rankings from the week that just closed — scores stay
        honest; the takes do not.
      </p>

      {chips.length ? (
        <div className="week-strip recap-weeks" aria-label="Recap weeks">
          {chips.map((period) => (
            <Link
              key={period}
              className={`week-chip${period === active ? " active" : ""}`}
              href={`/leagues/${league.league_id}?season=${league.season}&tab=recap&week=${period}`}
            >
              {periodLabel} {period}
            </Link>
          ))}
        </div>
      ) : null}

      {canWrite && active != null && facts ? (
        <RecapGenerateButton
          leagueId={league.league_id}
          season={league.season}
          period={active}
          hasArticle={article != null}
        />
      ) : null}

      {article ? (
        <RecapArticleView article={article} factsNames={factsNames} />
      ) : facts ? (
        <EmptyState title={`No column for ${periodLabel} ${active} yet`}>
          {canWrite
            ? "Admins can write this week’s recap. Roast (default), mild, or savage — jokes still have to hang on the digest scores."
            : "The commissioner has not run the columnist for this week."}
        </EmptyState>
      ) : (
        <EmptyState title="Nothing to recap yet">
          Recaps land after a {periodLabel} has decided games. Check Matchups.
        </EmptyState>
      )}
    </section>
  );
}
