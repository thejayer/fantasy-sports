import Link from "next/link";
import { BoxScorePanel } from "@/components/BoxScorePanel";
import { CategoryBoxPanel } from "@/components/CategoryBoxPanel";
import { ViewerBadge } from "@/components/ViewerBadge";
import type { LeagueSnapshot, WeekBoxScoreSnapshot } from "@/lib/data";
import { boxPairKey } from "@/lib/box-score";
import {
  formatMatchupScore,
  gamesForPeriod,
  isViewerGame,
  outcomeTone,
  periodCount,
  playoffPeriods,
  playoffSeeds,
  projectedFirstRound,
  promoteViewerGame,
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
  isViewer = false,
}: {
  side: MatchupSide;
  leagueId: string;
  season: number;
  align?: "left" | "right";
  isViewer?: boolean;
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
        {isViewer ? <ViewerBadge /> : null}
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
  viewerTeamId,
  showBoxLink = false,
  boxLinkLabel = "Box score",
}: {
  game: MatchupGame;
  leagueId: string;
  season: number;
  viewerTeamId?: number;
  showBoxLink?: boolean;
  boxLinkLabel?: string;
}) {
  const mine = isViewerGame(game, viewerTeamId);
  const boxHref =
    showBoxLink && !game.projected
      ? `/leagues/${leagueId}?season=${season}&tab=matchups&view=week&week=${game.period}&box=${boxPairKey(game.left.teamId, game.right.teamId)}`
      : null;
  return (
    <article
      className={
        `matchup-card${game.projected ? " projected" : ""}` +
        (mine ? " is-viewer" : "")
      }
    >
      {mine ? <p className="matchup-card-flag">Your matchup</p> : null}
      <TeamLine
        side={game.left}
        leagueId={leagueId}
        season={season}
        align="left"
        isViewer={game.left.teamId === viewerTeamId}
      />
      <div className="matchup-vs" aria-hidden>
        vs
      </div>
      <TeamLine
        side={game.right}
        leagueId={leagueId}
        season={season}
        align="right"
        isViewer={game.right.teamId === viewerTeamId}
      />
      {boxHref ? (
        <p className="league-meta" style={{ margin: "0.5rem 0 0" }}>
          <Link href={boxHref}>{boxLinkLabel}</Link>
        </p>
      ) : null}
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
  viewerTeamId,
  showBoxLink = false,
  boxLinkLabel = "Box score",
}: {
  bundle: PeriodBundle;
  leagueId: string;
  season: number;
  periodLabel: string;
  heading?: string;
  viewerTeamId?: number;
  showBoxLink?: boolean;
  boxLinkLabel?: string;
}) {
  const games = promoteViewerGame(bundle.games, viewerTeamId);
  return (
    <section className="matchup-period">
      <h3 className="matchup-period-title">
        {heading ?? `${periodLabel} ${bundle.period}`}
      </h3>
      {games.length === 0 && bundle.byes.length === 0 ? (
        <p className="league-meta">No matchups for this {periodLabel}.</p>
      ) : (
        <div className="matchup-grid">
          {games.map((game) => (
            <MatchupCard
              key={`${game.period}-${game.left.teamId}-${game.right.teamId}`}
              game={game}
              leagueId={leagueId}
              season={season}
              viewerTeamId={viewerTeamId}
              showBoxLink={showBoxLink}
              boxLinkLabel={boxLinkLabel}
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
  viewerTeamId,
  boxPair = null,
  weekBoxScore = null,
}: {
  league: LeagueSnapshot;
  week?: number;
  view?: MatchupsView;
  /** Signed-in member's franchise in this league (roadmap 7.1). */
  viewerTeamId?: number;
  /** ``?box=1-2`` — football lineup box or baseball category box. */
  boxPair?: { a: number; b: number } | null;
  weekBoxScore?: WeekBoxScoreSnapshot | null;
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
  const showWeekBox =
    (league.sport === "football" || league.sport === "baseball") &&
    boxPair != null &&
    activeView === "week";

  if (showWeekBox && boxPair) {
    return (
      <div className="matchups-panel">
        {league.sport === "baseball" ? (
          <CategoryBoxPanel
            league={league}
            week={activeWeek}
            teamA={boxPair.a}
            teamB={boxPair.b}
            snapshot={weekBoxScore}
          />
        ) : (
          <BoxScorePanel
            league={league}
            week={activeWeek}
            teamA={boxPair.a}
            teamB={boxPair.b}
            snapshot={weekBoxScore}
          />
        )}
      </div>
    );
  }

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
              viewerTeamId={viewerTeamId}
              showBoxLink={
                league.sport === "football" || league.sport === "baseball"
              }
              boxLinkLabel={
                league.sport === "baseball" ? "Category box" : "Box score"
              }
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
                viewerTeamId={viewerTeamId}
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
          viewerTeamId={viewerTeamId}
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
  viewerTeamId,
}: {
  league: LeagueSnapshot;
  periodLabel: string;
  regSeasonCount: number | null | undefined;
  playoffTeamCount: number | null | undefined;
  max: number;
  viewerTeamId?: number;
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
          {league.sport === "football"
            ? ". Open a week matchup for the box score when synced."
            : league.sport === "baseball"
              ? ". Open a period matchup for the category box when synced."
              : "."}
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
                  <tr
                    key={team.team_id}
                    className={team.team_id === viewerTeamId ? "is-viewer" : undefined}
                  >
                    <td>{team.standing ?? "—"}</td>
                    <td>
                      <Link
                        href={`/leagues/${league.league_id}/teams/${team.team_id}?season=${league.season}`}
                      >
                        {team.name}
                      </Link>
                      {team.team_id === viewerTeamId ? <ViewerBadge /> : null}
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
              viewerTeamId={viewerTeamId}
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
            {promoteViewerGame(projected, viewerTeamId).map((game) => (
              <MatchupCard
                key={`proj-${game.left.teamId}-${game.right.teamId}`}
                game={game}
                leagueId={league.league_id}
                season={league.season}
                viewerTeamId={viewerTeamId}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
