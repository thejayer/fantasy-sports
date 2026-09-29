import Link from "next/link";

import { EmptyState } from "@/components/EmptyState";
import {
  CompareView,
  DepthView,
  MoveView,
  WaiverBoardView,
  type DecisionQuery,
} from "@/components/HockeyDecisionViews";
import type { DecisionContext } from "@/lib/hockey-decisions";
import {
  HOCKEY_TOOL_CARDS,
  buildHockeyCategoryBoard,
  hockeyToolsForScoring,
  rosterHasHockeyStats,
  type HockeyCategoryBoard,
  type HockeyToolsView,
} from "@/lib/hockey-tools";
import type { LeagueSnapshot } from "@/lib/data";
import { isCategoryScoring, isSeasonPointsScoring } from "@/lib/scoring-type";

function toolsHref(
  leagueId: string,
  season: number,
  view: HockeyToolsView,
): string {
  return `/leagues/${leagueId}?season=${season}&tab=tools&view=${view}`;
}

function formatValue(value: number | null, digits: number): string {
  if (value == null || Number.isNaN(value)) return "—";
  return digits > 0 ? value.toFixed(digits) : String(Math.round(value));
}

function CategoryBoardView({ board }: { board: HockeyCategoryBoard }) {
  return (
    <section style={{ marginTop: "0.75rem" }}>
      <p className="lede" style={{ marginTop: 0 }}>
        Category ranks from roster season stats — not a projection model.
      </p>
      <p className="league-meta">{board.disclaimer}</p>
      <div className="panel table-scroll">
        <table className="table-cards">
          <thead>
            <tr>
              <th>Team</th>
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
                {board.categories.map((cat) => {
                  const cell = row.cells[cat.id];
                  return (
                    <td key={cat.id} data-label={cat.label} className="numeric">
                      {formatValue(cell?.value ?? null, cat.digits)}
                      {cell?.rank != null ? (
                        <span className="league-meta"> · {cell.rank}</span>
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

export function HockeyToolsPanel({
  league,
  view = "home",
  ctx,
  query,
  viewerTeamId,
}: {
  league: LeagueSnapshot;
  view?: HockeyToolsView;
  ctx?: DecisionContext;
  query?: DecisionQuery;
  viewerTeamId?: number;
}) {
  const scoringType = league.scoring_type ?? league.settings?.scoring_type;
  const allowed = new Set(hockeyToolsForScoring(scoringType));
  const active: HockeyToolsView = view !== "home" && allowed.has(view) ? view : "home";
  const seasonPoints = isSeasonPointsScoring(scoringType);
  const category = isCategoryScoring(scoringType);
  const board = rosterHasHockeyStats(league)
    ? buildHockeyCategoryBoard(league)
    : null;

  return (
    <div className="tools-panel">
      <div className="tabs" style={{ marginTop: "0.5rem" }}>
        <Link
          href={toolsHref(league.league_id, league.season, "home")}
          className={`tab${active === "home" ? " active" : ""}`}
        >
          Tools
        </Link>
        {HOCKEY_TOOL_CARDS.filter((card) => allowed.has(card.id)).map((card) => (
          <Link
            key={card.id}
            href={`${toolsHref(league.league_id, league.season, card.id)}${
              query?.teamId != null && card.id !== "categories" ? `&team=${query.teamId}` : ""
            }`}
            className={`tab${active === card.id ? " active" : ""}`}
          >
            {card.name}
          </Link>
        ))}
      </div>

      {active === "home" ? (
        <>
          <p className="lede">
            Decision tools read the synced hockey player values (per-game
            value, rest of season, share of games played) and the NHL
            schedule. Any team can be picked; yours is the default when your
            franchise is linked. No NHL model in <code>ffa</code>.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "0.75rem",
              marginTop: "0.75rem",
            }}
          >
            {HOCKEY_TOOL_CARDS.filter((card) => allowed.has(card.id)).map(
              (card) => (
                <Link
                  key={card.id}
                  href={toolsHref(league.league_id, league.season, card.id)}
                  className="panel"
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  <h3 className="roster-group-title" style={{ marginTop: 0 }}>
                    {card.name}
                  </h3>
                  <p className="league-meta" style={{ marginBottom: 0 }}>
                    {card.promise}
                  </p>
                </Link>
              ),
            )}
            <Link
              href={`/leagues/${league.league_id}?season=${league.season}&tab=sandbox`}
              className="panel"
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <h3 className="roster-group-title" style={{ marginTop: 0 }}>
                Scoring lab
              </h3>
              <p className="league-meta" style={{ marginBottom: 0 }}>
                Clone official weights and rescore in the browser. Nothing writes
                ESPN.
              </p>
            </Link>
          </div>
          {seasonPoints ? (
            <p className="league-meta">
              Season Points standings live on Standings; scoring weights on
              Settings and Scoring lab.
            </p>
          ) : null}
          {category ? (
            <p className="league-meta">
              H2H category period boxes open from Matchups when ESPN returns
              them. Empty weeks stay empty.
            </p>
          ) : null}
        </>
      ) : null}

      {ctx && query && active === "waivers" ? (
        <WaiverBoardView league={league} ctx={ctx} query={query} viewerTeamId={viewerTeamId} />
      ) : null}
      {ctx && query && active === "compare" ? (
        <CompareView league={league} ctx={ctx} query={query} />
      ) : null}
      {ctx && query && active === "move" ? (
        <MoveView league={league} ctx={ctx} query={query} viewerTeamId={viewerTeamId} />
      ) : null}
      {ctx && query && active === "depth" ? (
        <DepthView league={league} ctx={ctx} query={query} viewerTeamId={viewerTeamId} />
      ) : null}
      {active === "categories" && board ? <CategoryBoardView board={board} /> : null}
      {active === "categories" && !board ? (
        <EmptyState title="No hockey counting stats on this snapshot">
          Category Board needs roster <code>season_stats</code> from ESPN. The
          hub will not invent fantasy points. Open Scoring lab if weights exist,
          or wait for a live <code>sj sync</code>.
        </EmptyState>
      ) : null}
    </div>
  );
}
