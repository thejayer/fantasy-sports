import Link from "next/link";

import { EmptyState } from "@/components/EmptyState";
import { formatStat } from "@/lib/baseball";
import {
  BASEBALL_TOOL_CARDS,
  baseballFixtureNow,
  buildCategoryBoard,
  buildDailyLocksBoard,
  buildGamesPerTeamBoard,
  buildIpUsageBoard,
  buildTrailingBoard,
  buildTwoStartBoard,
  type BaseballToolsView,
  type CategoryBoard,
  type CategoryId,
  type DailyLocksBoard,
  type GamesPerTeamBoard,
  type IpUsageBoard,
  type TrailingBoard,
  type TrailingPlayerRow,
  type TrailingWindow,
  type TwoStartBoard,
} from "@/lib/baseball-tools";
import type {
  LeagueSnapshot,
  ProScheduleSnapshot,
  WeekBoxScoreSnapshot,
} from "@/lib/data";
import {
  baseballToolsForScoring,
  isSeasonPointsScoring,
} from "@/lib/scoring-type";

function toolsHref(
  leagueId: string,
  season: number,
  view: BaseballToolsView,
  window?: TrailingWindow,
): string {
  const query = new URLSearchParams({
    season: String(season),
    tab: "tools",
    view,
  });
  if (view === "trailing" && window) {
    query.set("window", window);
  }
  return `/leagues/${leagueId}?${query.toString()}`;
}

function ViewSwitcher({
  leagueId,
  season,
  view,
  scoringType,
}: {
  leagueId: string;
  season: number;
  view: BaseballToolsView;
  scoringType?: string | null;
}) {
  const allowed = new Set(baseballToolsForScoring(scoringType));
  const views: Array<{ id: BaseballToolsView; label: string }> = [
    { id: "home", label: "Tools" },
    ...BASEBALL_TOOL_CARDS.filter((card) => allowed.has(card.id)).map((card) => ({
      id: card.id as BaseballToolsView,
      label: card.name,
    })),
  ];
  return (
    <div className="tabs" style={{ marginTop: "0.5rem" }}>
      {views.map((item) => (
        <Link
          key={item.id}
          href={toolsHref(leagueId, season, item.id)}
          className={`tab${view === item.id ? " active" : ""}`}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}

function CategoryBoardView({
  board,
  leagueId,
  season,
  currentWeek,
  seasonPoints,
}: {
  board: CategoryBoard;
  leagueId: string;
  season: number;
  currentWeek: number | null | undefined;
  seasonPoints?: boolean;
}) {
  const periodHref =
    currentWeek != null
      ? `/leagues/${leagueId}?season=${season}&tab=matchups&view=week&week=${currentWeek}`
      : `/leagues/${leagueId}?season=${season}&tab=matchups`;
  return (
    <section style={{ marginTop: "0.75rem" }}>
      <p className="lede" style={{ marginTop: 0 }}>
        Category ranks from roster season stats — not a projection model.
      </p>
      <p className="league-meta">{board.disclaimer}</p>
      {seasonPoints ? null : (
        <p className="league-meta">
          For ESPN period H2H cats, open{" "}
          <Link href={periodHref}>Matchups → category box</Link>.
        </p>
      )}
      <div className="panel table-scroll">
        <table className="table-cards">
          <thead>
            <tr>
              <th>Team</th>
              <th className="numeric">Roto</th>
              {board.categories.map((cat) => (
                <th key={cat.id} className="numeric">
                  {cat.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {board.rows.map((row) => (
              <tr key={row.teamId}>
                <td data-label="Team">{row.name}</td>
                <td data-label="Roto" className="numeric">
                  {formatStat(row.rotoPoints, 1)}
                  <span className="muted"> (#{formatStat(row.rotoRank, 0)})</span>
                </td>
                {board.categories.map((cat) => {
                  const cell = row.cells[cat.id as CategoryId];
                  return (
                    <td key={cat.id} data-label={cat.label} className="numeric">
                      {formatStat(cell?.value, cat.digits)}
                      {cell?.rank != null ? (
                        <span className="muted"> · #{formatStat(cell.rank, 0)}</span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function timeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} UTC`;
}

function TrailingRowsTable({
  title,
  rows,
  role,
}: {
  title: string;
  rows: TrailingPlayerRow[];
  role: "batter" | "pitcher";
}) {
  const columns =
    role === "batter"
      ? (["R", "HR", "RBI", "SB"] as const)
      : (["K", "W", "SV", "HLD", "QS"] as const);
  return (
    <>
      <h3 className="roster-group-title">{title}</h3>
      {!rows.length ? (
        <EmptyState title={`No ${title.toLowerCase()} in this window`}>
          ESPN trailing splits will appear here after sync provides PR7 / PR15 /
          PR30 player buckets.
        </EmptyState>
      ) : (
        <div className="panel table-scroll">
          <table className="table-cards">
            <thead>
              <tr>
                <th>Player</th>
                <th>Roster</th>
                <th>MLB</th>
                {columns.map((key) => (
                  <th key={key} className="numeric">
                    {key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.status}-${row.playerId}`}>
                  <td data-label="Player">{row.name}</td>
                  <td data-label="Roster">{row.fantasyTeamName}</td>
                  <td data-label="MLB">{row.proTeam ?? "—"}</td>
                  {columns.map((key) => (
                    <td key={key} data-label={key} className="numeric">
                      {formatStat(row.stats[key], 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function TrailingBoardView({
  league,
  board,
}: {
  league: LeagueSnapshot;
  board: TrailingBoard;
}) {
  return (
    <section style={{ marginTop: "0.75rem" }}>
      <p className="lede" style={{ marginTop: 0 }}>
        Hot streaks from ESPN PR{board.window} splits for rostered players and
        free agents.
      </p>
      <div className="tabs" style={{ marginTop: "0.5rem" }}>
        {(["7", "15", "30"] as const).map((window) => (
          <Link
            key={window}
            href={toolsHref(league.league_id, league.season, "trailing", window)}
            className={`tab${board.window === window ? " active" : ""}`}
          >
            {window} days
          </Link>
        ))}
      </div>
      <p className="league-meta">{board.disclaimer}</p>
      <TrailingRowsTable title="Batters" rows={board.batters} role="batter" />
      <TrailingRowsTable title="Pitchers" rows={board.pitchers} role="pitcher" />
    </section>
  );
}

function ScheduleBoardView({
  board,
  twoStarts,
}: {
  board: GamesPerTeamBoard;
  twoStarts: TwoStartBoard;
}) {
  return (
    <section style={{ marginTop: "0.75rem" }}>
      <p className="lede" style={{ marginTop: 0 }}>
        Games per fantasy team in matchup period {board.period ?? "—"}.
      </p>
      <p className="league-meta">
        {board.disclaimer} Scoring periods:{" "}
        {board.scoringPeriods.length ? board.scoringPeriods.join(", ") : "—"}.
      </p>
      {!board.games.length ? (
        <EmptyState title="No pro schedule for this period">
          Sync needs a baseball <code>pro_schedule.json</code> sidecar before the
          forecaster can count roster games.
        </EmptyState>
      ) : (
        <div className="panel table-scroll">
          <table className="table-cards">
            <thead>
              <tr>
                <th>Team</th>
                <th className="numeric">Player games</th>
                <th>By MLB team</th>
              </tr>
            </thead>
            <tbody>
              {board.rows.map((row) => (
                <tr key={row.teamId}>
                  <td data-label="Team">{row.name}</td>
                  <td data-label="Player games" className="numeric">
                    {formatStat(row.totalPlayerGames, 0)}
                  </td>
                  <td data-label="By MLB team">
                    {row.proTeamGames
                      .filter((item) => item.games > 0)
                      .slice(0, 8)
                      .map(
                        (item) =>
                          `${item.proTeam}: ${item.games}g × ${item.players}`,
                      )
                      .join(", ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="roster-group-title">Two-start pitchers</h3>
      <p className="league-meta">{twoStarts.disclaimer}</p>
      {!twoStarts.rows.length ? (
        <EmptyState title="No two-start pitchers this period">
          Pitchers need probable-starter tags on two or more games in the
          selected matchup period.
        </EmptyState>
      ) : (
        <div className="panel table-scroll">
          <table className="table-cards">
            <thead>
              <tr>
                <th>Pitcher</th>
                <th>Roster</th>
                <th className="numeric">Starts</th>
                <th>Games</th>
              </tr>
            </thead>
            <tbody>
              {twoStarts.rows.map((row) => (
                <tr key={`${row.playerId}-${row.name}`}>
                  <td data-label="Pitcher">{row.name}</td>
                  <td data-label="Roster">{row.fantasyTeamName}</td>
                  <td data-label="Starts" className="numeric">
                    {formatStat(row.starts, 0)}
                  </td>
                  <td data-label="Games">
                    {row.games
                      .map(
                        (game) =>
                          `${game.awayProTeam}@${game.homeProTeam} (${timeLabel(game.startTime)})`,
                      )
                      .join("; ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function DailyLocksBoardView({ board }: { board: DailyLocksBoard }) {
  return (
    <section style={{ marginTop: "0.75rem" }}>
      <p className="lede" style={{ marginTop: 0 }}>
        Today&apos;s lineup locks for {board.date}.
      </p>
      <p className="league-meta">{board.disclaimer}</p>
      {!board.games.length ? (
        <EmptyState title="No MLB games today">
          Daily locks appear when <code>pro_schedule.json</code> has games whose
          UTC date matches the snapshot clock.
        </EmptyState>
      ) : (
        <div className="panel table-scroll">
          <table className="table-cards">
            <thead>
              <tr>
                <th>Game</th>
                <th>Lock</th>
                <th>Rostered players</th>
              </tr>
            </thead>
            <tbody>
              {board.games.map((game) => (
                <tr key={`${game.awayProTeam}-${game.homeProTeam}-${game.startTime}`}>
                  <td data-label="Game">
                    {game.awayProTeam} @ {game.homeProTeam}
                  </td>
                  <td data-label="Lock">{timeLabel(game.startTime)}</td>
                  <td data-label="Rostered players">
                    {game.players.length
                      ? game.players
                          .slice(0, 12)
                          .map(
                            (player) =>
                              `${player.name} (${player.teamName}, ${player.slot ?? "—"})`,
                          )
                          .join(", ")
                      : "No rostered players"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Baseball projection-free toolkit (roadmap 8.2).
 * Distinct from football ``ToolsPanel`` — no ffa / projection joins.
 */
export function BaseballToolsPanel({
  league,
  view = "home",
  proSchedule = null,
  weekBoxScore = null,
  trailingWindow = "7",
}: {
  league: LeagueSnapshot;
  view?: BaseballToolsView;
  proSchedule?: ProScheduleSnapshot | null;
  weekBoxScore?: WeekBoxScoreSnapshot | null;
  trailingWindow?: TrailingWindow;
}) {
  const leagueId = league.league_id;
  const season = league.season;
  const seasonPoints = isSeasonPointsScoring(league.scoring_type);
  const allowedTools = new Set(baseballToolsForScoring(league.scoring_type));
  const active: BaseballToolsView =
    view === "home" || BASEBALL_TOOL_CARDS.some((c) => c.id === view)
      ? view
      : "home";

  const categoryBoard =
    active === "categories" && !seasonPoints
      ? buildCategoryBoard(league)
      : null;
  const ipBoard =
    active === "usage" ? buildIpUsageBoard(league, weekBoxScore) : null;
  const trailingBoard =
    active === "trailing" ? buildTrailingBoard(league, trailingWindow) : null;
  const scheduleBoard =
    active === "schedule"
      ? buildGamesPerTeamBoard(league, proSchedule, league.current_week)
      : null;
  const twoStartBoard =
    active === "schedule"
      ? buildTwoStartBoard(league, proSchedule, league.current_week)
      : null;
  const locksBoard =
    active === "locks"
      ? buildDailyLocksBoard(
          league,
          proSchedule,
          baseballFixtureNow(proSchedule?.synced_at ?? league.synced_at),
        )
      : null;

  return (
    <div className="baseball-tools-panel">
      <ViewSwitcher
        leagueId={leagueId}
        season={season}
        view={active}
        scoringType={league.scoring_type}
      />

      {active === "home" ? (
        <section style={{ marginTop: "0.75rem" }}>
          <p className="lede" style={{ marginTop: 0 }}>
            Scheduling and roster arithmetic — still projection-free (roadmap
            4.6 / 8.2). Free agents stay on the Waivers tab.
            {seasonPoints
              ? " Season Points standings live on Standings; scoring weights on Settings."
              : ""}
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "0.75rem",
              marginTop: "0.75rem",
            }}
          >
            {BASEBALL_TOOL_CARDS.filter((card) => allowedTools.has(card.id)).map(
              (card) => (
              <Link
                key={card.id}
                href={toolsHref(leagueId, season, card.id)}
                className="panel"
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <h3 className="roster-group-title" style={{ marginTop: 0 }}>
                  {card.name}
                  {!card.ready ? (
                    <span className="muted" style={{ fontWeight: 400 }}>
                      {" "}
                      · needs sync
                    </span>
                  ) : null}
                </h3>
                <p className="league-meta" style={{ marginBottom: 0 }}>
                  {card.promise}
                </p>
              </Link>
            ),
            )}
          </div>
        </section>
      ) : null}

      {active === "categories" && categoryBoard ? (
        <CategoryBoardView
          board={categoryBoard}
          leagueId={league.league_id}
          season={league.season}
          currentWeek={league.current_week}
          seasonPoints={seasonPoints}
        />
      ) : null}
      {active === "categories" && seasonPoints ? (
        <EmptyState title="Category Board is for H2H / roto leagues">
          This league uses Season Points. Standings are cumulative fantasy points
          — see Standings and Settings for the race and point weights.
        </EmptyState>
      ) : null}

      {active === "usage" && ipBoard ? (
        <UsageBoardViewLinked league={league} board={ipBoard} />
      ) : null}

      {active === "trailing" ? (
        trailingBoard ? <TrailingBoardView league={league} board={trailingBoard} /> : null
      ) : null}

      {active === "schedule" ? (
        scheduleBoard && twoStartBoard ? (
          <ScheduleBoardView board={scheduleBoard} twoStarts={twoStartBoard} />
        ) : null
      ) : null}

      {active === "locks" ? (
        locksBoard ? <DailyLocksBoardView board={locksBoard} /> : null
      ) : null}
    </div>
  );
}

function UsageBoardViewLinked({
  league,
  board,
}: {
  league: LeagueSnapshot;
  board: IpUsageBoard;
}) {
  return (
    <section style={{ marginTop: "0.75rem" }}>
      <p className="lede" style={{ marginTop: 0 }}>
        Season IP vs a {board.seasonMaxSource === "default" ? "default" : "settings"}{" "}
        ceiling of {formatStat(board.seasonMax, 0)}.
      </p>
      <p className="league-meta">{board.disclaimer}</p>
      <h3 className="roster-group-title">Team IP</h3>
      <div className="panel table-scroll">
        <table className="table-cards">
          <thead>
            <tr>
              <th>Team</th>
              <th className="numeric">IP</th>
              <th className="numeric">Remaining</th>
              <th className="numeric">Used</th>
            </tr>
          </thead>
          <tbody>
            {board.teams.map((row) => (
              <tr key={row.teamId}>
                <td data-label="Team">
                  <Link
                    href={`/leagues/${league.league_id}/teams/${row.teamId}?season=${league.season}`}
                  >
                    {row.name}
                  </Link>
                </td>
                <td data-label="IP" className="numeric">
                  {formatStat(row.ip, 1)}
                </td>
                <td data-label="Remaining" className="numeric">
                  {formatStat(row.remaining, 1)}
                </td>
                <td data-label="Used" className="numeric">
                  {formatStat(row.pct * 100, 0)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {board.seasonGsMax != null ? (
        <>
          <h3 className="roster-group-title">
            Team GS vs {formatStat(board.seasonGsMax, 0)}
          </h3>
          <div className="panel table-scroll">
            <table className="table-cards">
              <thead>
                <tr>
                  <th>Team</th>
                  <th className="numeric">GS</th>
                  <th className="numeric">Remaining</th>
                  <th className="numeric">Used</th>
                </tr>
              </thead>
              <tbody>
                {board.gsTeams.map((row) => (
                  <tr key={`gs-${row.teamId}`}>
                    <td data-label="Team">{row.name}</td>
                    <td data-label="GS" className="numeric">
                      {formatStat(row.gs, 0)}
                    </td>
                    <td data-label="Remaining" className="numeric">
                      {formatStat(row.remaining, 0)}
                    </td>
                    <td data-label="Used" className="numeric">
                      {formatStat(row.pct * 100, 0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {board.minWeeklyIp != null ? (
        <>
          <h3 className="roster-group-title">
            Period {board.period ?? "—"} IP vs {formatStat(board.minWeeklyIp, 0)}{" "}
            floor
          </h3>
          <div className="panel table-scroll">
            <table className="table-cards">
              <thead>
                <tr>
                  <th>Team</th>
                  <th className="numeric">Period IP</th>
                  <th className="numeric">Short</th>
                  <th>Floor</th>
                </tr>
              </thead>
              <tbody>
                {board.periodTeams.map((row) => (
                  <tr key={`period-${row.teamId}`}>
                    <td data-label="Team">{row.name}</td>
                    <td data-label="Period IP" className="numeric">
                      {formatStat(row.ip, 1)}
                    </td>
                    <td data-label="Short" className="numeric">
                      {row.met ? "—" : formatStat(Math.max(0, row.remaining), 1)}
                    </td>
                    <td data-label="Floor">{row.met ? "Met" : "Short"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <h3 className="roster-group-title">Pitcher IP leaders</h3>
      {!board.pitchers.length ? (
        <EmptyState title="No pitcher IP in this snapshot">
          Pitcher season_stats appear after ESPN sync.
        </EmptyState>
      ) : (
        <div className="panel table-scroll">
          <table className="table-cards">
            <thead>
              <tr>
                <th>Pitcher</th>
                <th>Team</th>
                <th className="numeric">IP</th>
              </tr>
            </thead>
            <tbody>
              {board.pitchers.map((row) => (
                <tr key={`${row.teamId}-${row.playerId}`}>
                  <td data-label="Pitcher">
                    {row.playerId != null ? (
                      <Link
                        href={`/leagues/${league.league_id}/players/${row.playerId}?season=${league.season}`}
                      >
                        {row.name}
                      </Link>
                    ) : (
                      row.name
                    )}
                  </td>
                  <td data-label="Team">{row.teamName}</td>
                  <td data-label="IP" className="numeric">
                    {formatStat(row.ip, 1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
