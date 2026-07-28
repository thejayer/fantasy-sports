import Link from "next/link";
import type { LeagueSnapshot } from "@/lib/data";
import {
  formatMatchupScore,
  gamesForPeriod,
  outcomeTone,
  periodCount,
  playoffPeriods,
  playoffSeeds,
  projectedFirstRound,
  resolvePeriod,
  seasonSchedule,
  type MatchupGame,
  type MatchupSide,
  type PeriodBundle,
} from "@/lib/matchups";

export type MatchupsView = "week" | "schedule" | "playoffs";

function OutcomePill({ outcome }: { outcome: string }) {
  const tone = outcomeTone(outcome);
  if (tone === "open") return null;
  return <span className={`outcome-pill outcome-${tone}`}>{outcome}</span>;
}

function TeamLine({
  side,
  leagueId,
  season,
  align = "left",
}: {
  side: MatchupSide;
  leagueId: string;
  season: number;
  align?: "left" | "right";
}) {
  return (
    <div className={`matchup-team matchup-team-${align}`}>
      <div className="matchup-team-meta">
        {side.standing != null ? (
          <span className="matchup-seed">#{side.standing}</span>
        ) : null}
        <Link href={`/leagues/${leagueId}/teams/${side.teamId}?season=${season}`}>
          {side.name}
        </Link>
        <OutcomePill outcome={side.outcome} />
      </div>
      <div className="matchup-score">{formatMatchupScore(side.score)}</div>
    </div>
  );
}

function MatchupCard({
  game,
  leagueId,
  season,
}: {
  game: MatchupGame;
  leagueId: string;
  season: number;
}) {
  return (
    <article className={`matchup-card${game.projected ? " projected" : ""}`}>
      <TeamLine side={game.left} leagueId={leagueId} season={season} align="left" />
      <div className="matchup-vs" aria-hidden>
        vs
      </div>
      <TeamLine side={game.right} leagueId={leagueId} season={season} align="right" />
    </article>
  );
}

function ByeList({ byes }: { byes: MatchupSide[] }) {
  if (!byes.length) return null;
  return (
    <p className="matchup-byes">
      Bye: {byes.map((team) => team.name).join(", ")}
    </p>
  );
}

function WeekChips({
  leagueId,
  season,
  view,
  max,
  active,
  periodLabel,
  regSeasonCount,
}: {
  leagueId: string;
  season: number;
  view: MatchupsView;
  max: number;
  active: number;
  periodLabel: string;
  regSeasonCount: number | null | undefined;
}) {
  if (max <= 0) return null;
  const chips = Array.from({ length: max }, (_, i) => i + 1);
  return (
    <div className="week-switch" aria-label={`${periodLabel} selector`}>
      {chips.map((period) => {
        const playoff =
          regSeasonCount != null && period > regSeasonCount ? " playoff" : "";
        return (
          <Link
            key={period}
            href={`/leagues/${leagueId}?season=${season}&tab=matchups&view=${view}&week=${period}`}
            className={`week-chip${period === active ? " active" : ""}${playoff}`}
          >
            {period}
          </Link>
        );
      })}
    </div>
  );
}

function ViewSwitcher({
  leagueId,
  season,
  week,
  view,
}: {
  leagueId: string;
  season: number;
  week: number;
  view: MatchupsView;
}) {
  const views: Array<{ id: MatchupsView; label: string }> = [
    { id: "week", label: "This week" },
    { id: "schedule", label: "Schedule" },
    { id: "playoffs", label: "Playoffs" },
  ];
  return (
    <div className="tabs matchups-subtabs" style={{ marginTop: "0.5rem" }}>
      {views.map((item) => (
        <Link
          key={item.id}
          href={`/leagues/${leagueId}?season=${season}&tab=matchups&view=${item.id}&week=${week}`}
          className={`tab${view === item.id ? " active" : ""}`}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}

function PeriodSection({
  bundle,
  leagueId,
  season,
  periodLabel,
  heading,
}: {
  bundle: PeriodBundle;
  leagueId: string;
  season: number;
  periodLabel: string;
  heading?: string;
}) {
  return (
    <section className="matchup-period">
      <h3 className="matchup-period-title">
        {heading ?? `${periodLabel} ${bundle.period}`}
      </h3>
      {bundle.games.length === 0 && bundle.byes.length === 0 ? (
        <p className="league-meta">No matchups for this {periodLabel}.</p>
      ) : (
        <div className="matchup-grid">
          {bundle.games.map((game) => (
            <MatchupCard
              key={`${game.period}-${game.left.teamId}-${game.right.teamId}`}
              game={game}
              leagueId={leagueId}
              season={season}
            />
          ))}
        </div>
      )}
      <ByeList byes={bundle.byes} />
    </section>
  );
}

export function MatchupsPanel({
  league,
  week,
  view = "week",
}: {
  league: LeagueSnapshot;
  week?: number;
  view?: MatchupsView;
}) {
  const leagueId = league.league_id;
  const periodLabel = league.period_label || (league.sport === "baseball" ? "period" : "week");
  const max = periodCount(league.teams);
  const activeWeek = resolvePeriod(week, league.current_week, max);
  const activeView: MatchupsView = ["week", "schedule", "playoffs"].includes(view)
    ? view
    : "week";
  const regSeasonCount = league.settings?.reg_season_count;
  const playoffTeamCount = league.settings?.playoff_team_count;

  return (
    <div className="matchups-panel">
      <ViewSwitcher
        leagueId={leagueId}
        season={league.season}
        week={activeWeek}
        view={activeView}
      />

      {activeView === "week" ? (
        <>
          <WeekChips
            leagueId={leagueId}
            season={league.season}
            view="week"
            max={max}
            active={activeWeek}
            periodLabel={periodLabel}
            regSeasonCount={regSeasonCount}
          />
          {max === 0 ? (
            <p className="league-meta">
              No matchup data in this snapshot yet. Sync or seed to populate
              schedule/scores/outcomes.
            </p>
          ) : (
            <PeriodSection
              bundle={gamesForPeriod(league.teams, activeWeek)}
              leagueId={leagueId}
              season={league.season}
              periodLabel={periodLabel}
            />
          )}
        </>
      ) : null}

      {activeView === "schedule" ? (
        max === 0 ? (
          <p className="league-meta">No schedule data in this snapshot.</p>
        ) : (
          <div className="matchup-schedule">
            {seasonSchedule(league.teams).map((bundle) => (
              <PeriodSection
                key={bundle.period}
                bundle={bundle}
                leagueId={leagueId}
                season={league.season}
                periodLabel={periodLabel}
                heading={
                  regSeasonCount != null && bundle.period > regSeasonCount
                    ? `Playoffs · ${periodLabel} ${bundle.period}`
                    : `${periodLabel} ${bundle.period}`
                }
              />
            ))}
          </div>
        )
      ) : null}

      {activeView === "playoffs" ? (
        <PlayoffsView
          league={league}
          periodLabel={periodLabel}
          regSeasonCount={regSeasonCount}
          playoffTeamCount={playoffTeamCount}
          max={max}
        />
      ) : null}
    </div>
  );
}

function PlayoffsView({
  league,
  periodLabel,
  regSeasonCount,
  playoffTeamCount,
  max,
}: {
  league: LeagueSnapshot;
  periodLabel: string;
  regSeasonCount: number | null | undefined;
  playoffTeamCount: number | null | undefined;
  max: number;
}) {
  const seeds = playoffSeeds(league.teams, playoffTeamCount);
  const poPeriods = playoffPeriods(regSeasonCount, max);
  const projected = poPeriods.length === 0 ? projectedFirstRound(seeds) : [];

  return (
    <div className="playoffs-view">
      <div className="playoff-meta panel">
        <p className="league-meta" style={{ margin: 0, padding: "0.85rem 1rem" }}>
          {playoffTeamCount != null ? `${playoffTeamCount}-team playoffs` : "Playoffs"}
          {regSeasonCount != null ? ` · regular season ${regSeasonCount} ${periodLabel}s` : ""}
          {league.settings?.playoff_matchup_period_length
            ? ` · ${league.settings.playoff_matchup_period_length}-${periodLabel} rounds`
            : ""}
          . Box scores are not synced yet.
        </p>
      </div>

      {seeds.length ? (
        <section className="matchup-period">
          <h3 className="matchup-period-title">Seeds</h3>
          <div className="panel table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Seed</th>
                  <th>Team</th>
                  <th>Record</th>
                </tr>
              </thead>
              <tbody>
                {seeds.map((team) => (
                  <tr key={team.team_id}>
                    <td>{team.standing ?? "—"}</td>
                    <td>
                      <Link
                        href={`/leagues/${league.league_id}/teams/${team.team_id}?season=${league.season}`}
                      >
                        {team.name}
                      </Link>
                    </td>
                    <td>
                      {team.ties
                        ? `${team.wins}-${team.losses}-${team.ties}`
                        : `${team.wins}-${team.losses}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <p className="league-meta">
          No playoff team count in league settings — cannot build a seed list.
        </p>
      )}

      {poPeriods.length ? (
        <div className="matchup-schedule">
          {poPeriods.map((period) => (
            <PeriodSection
              key={period}
              bundle={gamesForPeriod(league.teams, period)}
              leagueId={league.league_id}
              season={league.season}
              periodLabel={periodLabel}
              heading={`Playoffs · ${periodLabel} ${period}`}
            />
          ))}
        </div>
      ) : projected.length ? (
        <section className="matchup-period">
          <h3 className="matchup-period-title">Projected first round</h3>
          <p className="league-meta">
            Snapshot has no periods after the regular season yet — pairing seeds
            1 vs {seeds.length}, 2 vs {seeds.length - 1}, …
          </p>
          <div className="matchup-grid">
            {projected.map((game) => (
              <MatchupCard
                key={`proj-${game.left.teamId}-${game.right.teamId}`}
                game={game}
                leagueId={league.league_id}
                season={league.season}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
