import Link from "next/link";

import { PortfolioTable } from "@/components/PortfolioTable";
import { SeasonSwitcher } from "@/components/SeasonSwitcher";
import { TeamAvatar } from "@/components/TeamAvatar";
import { ThisDayInSj } from "@/components/ThisDayInSj";
import {
  dashboardActions,
  syncedLabel,
  type HomeLeagueCard,
} from "@/lib/member-home";
import { formatMatchupScore, outcomeTone } from "@/lib/matchups";
import { sportFormatLabel } from "@/lib/league";
import type { OnThisDayMoment } from "@/lib/on-this-day";

function formatSeasonFp(value: number | null | undefined): string {
  return value != null && Number.isFinite(value) ? value.toFixed(1) : "—";
}

function MatchupLine({ card }: { card: HomeLeagueCard }) {
  if (card.seasonPoints && card.team) {
    return (
      <p className="home-matchup">
        <span className="muted">Season FP</span>{" "}
        <span className="home-score">{formatSeasonFp(card.team.pointsFor)}</span>
      </p>
    );
  }
  const { matchup } = card;
  if (!matchup) {
    return (
      <p className="home-matchup muted">
        No {card.periodLabel} matchup in this snapshot.
      </p>
    );
  }
  if (matchup.bye) {
    return (
      <p className="home-matchup">
        {matchup.periodLabel} {matchup.period} · <strong>Bye</strong>
      </p>
    );
  }
  const tone = outcomeTone(matchup.outcome);
  return (
    <p className="home-matchup">
      <span className="muted">
        {matchup.periodLabel} {matchup.period}
      </span>{" "}
      <span className="home-score">{formatMatchupScore(matchup.score)}</span>
      <span className="muted"> vs </span>
      <span className="home-score">
        {formatMatchupScore(matchup.opponentScore)}
      </span>{" "}
      {matchup.opponentId != null ? (
        <Link
          href={`/leagues/${card.leagueId}/teams/${matchup.opponentId}?season=${card.season}`}
        >
          {matchup.opponentName}
        </Link>
      ) : (
        matchup.opponentName
      )}
      {tone !== "open" ? (
        <span className={`outcome-pill outcome-${tone}`}>{matchup.outcome}</span>
      ) : (
        <span className="pill home-live-pill">In progress</span>
      )}
    </p>
  );
}

function LeagueCard({ card }: { card: HomeLeagueCard }) {
  const synced = syncedLabel(card.syncedAt);
  return (
    <article className="home-card">
      <div className="home-card-head">
        <span className="pill sport-pill">
          {sportFormatLabel(card.sport, card.format)}
        </span>
        <span className="league-meta">
          {card.season}
          {synced ? ` · synced ${synced}` : ""}
        </span>
      </div>

      <h3 className="home-card-title">
        <Link href={card.href}>{card.name}</Link>
      </h3>

      {card.team ? (
        <>
          <div className="home-team">
            <TeamAvatar
              name={card.team.name}
              logoUrl={card.team.logoUrl}
              size="md"
            />
            <div>
              <Link
                className="home-team-name"
                href={`/leagues/${card.leagueId}/teams/${card.team.teamId}?season=${card.season}`}
              >
                {card.team.name}
              </Link>
              <div className="league-meta">
                {card.team.record} ({card.team.winPct})
                {card.team.standing != null
                  ? ` · ${card.team.standing} of ${card.team.teamCount}`
                  : ""}
              </div>
            </div>
          </div>
          <MatchupLine card={card} />
          {card.next && !card.matchup?.bye && !card.seasonPoints ? (
            <p className="league-meta home-next">
              Next: {card.periodLabel} {card.next.period}
              {card.next.opponentName ? ` vs ${card.next.opponentName}` : ""}
            </p>
          ) : null}
        </>
      ) : (
        <p className="muted home-unlinked">
          No franchise linked here yet, so this card cannot show your record.{" "}
          <Link href="/admin">Link one in the admin center</Link>.
        </p>
      )}

      {card.actions.length ? (
        <ul className="home-actions">
          {card.actions.map((action) => (
            <li key={action.id} className={`home-action tone-${action.tone}`}>
              {action.href ? (
                <Link href={action.href}>{action.label}</Link>
              ) : (
                action.label
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

/** The signed-in landing surface (roadmap 7.2 / 9.4 / 7.14). */
export function MemberDashboard({
  cards,
  seasons,
  currentSeason,
  memberName,
  onThisDay = [],
  onThisDayLabel,
}: {
  cards: HomeLeagueCard[];
  /** Union of on-disk seasons for the home year filter; chips hide when ≤1. */
  seasons: number[];
  currentSeason: number;
  memberName?: string | null;
  onThisDay?: OnThisDayMoment[];
  onThisDayLabel?: string;
}) {
  const todo = dashboardActions(cards);
  const linkedCards = cards.filter((card) => card.team);
  const linked = linkedCards.length;
  const pulse = linkedCards[0] ?? cards[0];

  return (
    <main className="section home-dashboard">
      <div className="section-head">
        <div>
          <h2>{memberName ? `Welcome back, ${memberName}` : "Your leagues"}</h2>
          <p className="lede">
            {linked
              ? `${linked} of ${cards.length} leagues linked to your franchise.`
              : "No franchises linked yet — the admin center connects your email to a team in each league."}
          </p>
        </div>
        <div className="home-head-actions">
          <SeasonSwitcher
            seasons={seasons}
            current={currentSeason}
            hrefFor={(year) => `/?season=${year}`}
          />
          <Link className="button secondary" href="/leagues">
            All leagues
          </Link>
        </div>
      </div>

      {cards.length > 1 ? (
        <nav className="league-switch" aria-label="League switcher">
          {cards.map((card) => (
            <Link
              key={card.leagueId}
              href={card.href}
              className={`season-chip${card.team ? " is-viewer" : ""}`}
            >
              {card.name}
            </Link>
          ))}
        </nav>
      ) : null}

      {pulse?.team ? (
        <section className="league-pulse" aria-label="League pulse">
          <p className="league-pulse-kicker">{pulse.name}</p>
          <div className="league-pulse-grid">
            <div>
              <span className="muted">Standing</span>
              <strong>
                {pulse.team.standing != null
                  ? `${pulse.team.standing} of ${pulse.team.teamCount}`
                  : "—"}
              </strong>
            </div>
            <div>
              <span className="muted">
                {pulse.seasonPoints ? "Season FP" : "This period"}
              </span>
              <strong>
                {pulse.seasonPoints
                  ? formatSeasonFp(pulse.team.pointsFor)
                  : pulse.matchup
                    ? pulse.matchup.bye
                      ? "Bye"
                      : `${pulse.matchup.opponentName ?? "Matchup"}`
                    : "—"}
              </strong>
            </div>
            <div>
              <span className="muted">
                {pulse.seasonPoints ? "Record" : "Next"}
              </span>
              <strong>
                {pulse.seasonPoints
                  ? pulse.team.record
                  : pulse.next
                    ? `${pulse.periodLabel} ${pulse.next.period}`
                    : "—"}
              </strong>
            </div>
          </div>
        </section>
      ) : null}

      <PortfolioTable cards={cards} season={currentSeason} />

      <ThisDayInSj
        moments={onThisDay}
        dayLabel={onThisDayLabel ?? "Today"}
      />

      {todo.length ? (
        <section className="panel home-todo">
          <h3 className="roster-group-title">Needs attention</h3>
          <ul className="home-actions">
            {todo.map((action) => (
              <li
                key={`${action.leagueName}-${action.id}`}
                className={`home-action tone-${action.tone}`}
              >
                <span className="league-meta">{action.leagueName}</span>{" "}
                {action.href ? (
                  <Link href={action.href}>{action.label}</Link>
                ) : (
                  action.label
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="home-grid">
        {cards.map((card) => (
          <LeagueCard key={card.leagueId} card={card} />
        ))}
      </div>
    </main>
  );
}
