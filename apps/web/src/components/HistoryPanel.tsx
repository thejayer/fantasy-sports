import Link from "next/link";
import type { LeagueHistoryArchive } from "@/lib/data";
import {
  allTimeStandings,
  buildRecordBook,
  championsBySeason,
  defaultH2HPair,
  formatPoints,
  formatWinPct,
  franchiseOptions,
  headToHead,
  recordLabelFromCounts,
  seasonCountLabel,
} from "@/lib/history";

export type HistoryView = "standings" | "champions" | "records" | "h2h";

function ViewSwitcher({
  leagueId,
  season,
  view,
  a,
  b,
}: {
  leagueId: string;
  season: number;
  view: HistoryView;
  a?: number;
  b?: number;
}) {
  const views: Array<{ id: HistoryView; label: string }> = [
    { id: "standings", label: "All-time" },
    { id: "champions", label: "Champions" },
    { id: "records", label: "Records" },
    { id: "h2h", label: "Head-to-head" },
  ];
  const pair =
    a != null && b != null ? `&a=${a}&b=${b}` : "";
  return (
    <div className="tabs history-subtabs" style={{ marginTop: "0.5rem" }}>
      {views.map((item) => (
        <Link
          key={item.id}
          href={`/leagues/${leagueId}?season=${season}&tab=history&view=${item.id}${pair}`}
          className={`tab${view === item.id ? " active" : ""}`}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}

function AllTimeTable({
  archive,
  leagueId,
  season,
}: {
  archive: LeagueHistoryArchive;
  leagueId: string;
  season: number;
}) {
  const rows = allTimeStandings(archive);
  if (!rows.length) {
    return <p className="league-meta">No franchise history in this archive.</p>;
  }
  const showPoints = rows.some((row) => row.pointsFor > 0);
  return (
    <div className="panel table-scroll">
      <table className="table-cards">
        <thead>
          <tr>
            <th>#</th>
            <th>Franchise</th>
            <th>Seasons</th>
            <th>Record</th>
            <th>Win%</th>
            <th>#1s</th>
            {showPoints ? <th>PF</th> : null}
            {showPoints ? <th>PA</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.teamId}>
              <td data-label="#">{index + 1}</td>
              <td data-label="Franchise">
                <Link
                  href={`/leagues/${leagueId}/teams/${row.teamId}?season=${season}`}
                >
                  {row.name}
                </Link>
                {row.owners.length ? (
                  <div className="league-meta">{row.owners.join(", ")}</div>
                ) : null}
              </td>
              <td data-label="Seasons">{row.seasons}</td>
              <td data-label="Record">
                {recordLabelFromCounts(row.wins, row.losses, row.ties)}
              </td>
              <td data-label="Win%">{formatWinPct(row.winPct)}</td>
              <td data-label="#1s">{row.championships}</td>
              {showPoints ? (
                <td data-label="PF">{formatPoints(row.pointsFor)}</td>
              ) : null}
              {showPoints ? (
                <td data-label="PA">{formatPoints(row.pointsAgainst)}</td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChampionsTable({
  archive,
  leagueId,
}: {
  archive: LeagueHistoryArchive;
  leagueId: string;
}) {
  const rows = championsBySeason(archive);
  if (!rows.length) {
    return (
      <p className="league-meta">
        No #1 finishes found across seasons in this archive.
      </p>
    );
  }
  return (
    <div className="history-section">
      <p className="league-meta">
        Regular-season #1 finish by year (playoff champion is not in the
        snapshot yet).
      </p>
      <div className="panel table-scroll">
        <table className="table-cards">
          <thead>
            <tr>
              <th>Season</th>
              <th>Champion</th>
              <th>Owner</th>
              <th>Record</th>
              <th>PF</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.season}>
                <td data-label="Season">
                  <Link
                    href={`/leagues/${leagueId}?season=${row.season}&tab=standings`}
                  >
                    {row.season}
                  </Link>
                </td>
                <td data-label="Champion">
                  <Link
                    href={`/leagues/${leagueId}/teams/${row.teamId}?season=${row.season}`}
                  >
                    {row.name}
                  </Link>
                </td>
                <td data-label="Owner">{row.owners.join(", ") || "—"}</td>
                <td data-label="Record">
                  {recordLabelFromCounts(row.wins, row.losses, row.ties)}
                </td>
                <td data-label="PF">{formatPoints(row.pointsFor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RecordsList({ archive }: { archive: LeagueHistoryArchive }) {
  const entries = buildRecordBook(archive);
  if (!entries.length) {
    return <p className="league-meta">No records available yet.</p>;
  }
  return (
    <div className="record-grid">
      {entries.map((entry) => (
        <article key={entry.label} className="record-card">
          <div className="record-label">{entry.label}</div>
          <div className="record-value">{entry.value}</div>
          <div className="league-meta">{entry.detail}</div>
        </article>
      ))}
    </div>
  );
}

function H2HView({
  archive,
  leagueId,
  season,
  a,
  b,
}: {
  archive: LeagueHistoryArchive;
  leagueId: string;
  season: number;
  a?: number;
  b?: number;
}) {
  const options = franchiseOptions(archive);
  const defaults = defaultH2HPair(archive);
  const teamA = a ?? defaults?.a;
  const teamB = b ?? defaults?.b;
  if (teamA == null || teamB == null) {
    return <p className="league-meta">Need at least two franchises for H2H.</p>;
  }

  const summary = headToHead(archive, teamA, teamB);
  const nameA = options.find((o) => o.teamId === teamA)?.name ?? `Team ${teamA}`;
  const nameB = options.find((o) => o.teamId === teamB)?.name ?? `Team ${teamB}`;

  return (
    <div className="history-section">
      <div className="h2h-pickers">
        <div>
          <div className="record-label">Franchise A</div>
          <div className="week-switch">
            {options.map((opt) => (
              <Link
                key={`a-${opt.teamId}`}
                href={`/leagues/${leagueId}?season=${season}&tab=history&view=h2h&a=${opt.teamId}&b=${teamB}`}
                className={`week-chip${opt.teamId === teamA ? " active" : ""}`}
              >
                {opt.name}
              </Link>
            ))}
          </div>
        </div>
        <div>
          <div className="record-label">Franchise B</div>
          <div className="week-switch">
            {options.map((opt) => (
              <Link
                key={`b-${opt.teamId}`}
                href={`/leagues/${leagueId}?season=${season}&tab=history&view=h2h&a=${teamA}&b=${opt.teamId}`}
                className={`week-chip${opt.teamId === teamB ? " active" : ""}`}
              >
                {opt.name}
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="h2h-summary panel">
        <div className="h2h-summary-inner">
          <strong>{nameA}</strong>
          <span className="h2h-record">
            {recordLabelFromCounts(summary.wins, summary.losses, summary.ties)}
          </span>
          <strong>{nameB}</strong>
        </div>
        <p className="league-meta" style={{ margin: "0.35rem 0 0" }}>
          {summary.games.length} decided games · PF {formatPoints(summary.pointsFor)} ·
          PA {formatPoints(summary.pointsAgainst)}
        </p>
      </div>

      {summary.games.length === 0 ? (
        <p className="league-meta">These franchises have no decided H2H games on disk.</p>
      ) : (
        <div className="panel table-scroll">
          <table className="table-cards">
            <thead>
              <tr>
                <th>Season</th>
                <th>Period</th>
                <th>{nameA}</th>
                <th>{nameB}</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {summary.games.map((game) => (
                <tr key={`${game.season}-${game.period}`}>
                  <td data-label="Season">{game.season}</td>
                  <td data-label="Period">{game.period}</td>
                  <td data-label={nameA}>{formatPoints(game.teamScore)}</td>
                  <td data-label={nameB}>{formatPoints(game.oppScore)}</td>
                  <td data-label="Result">
                    <span
                      className={`outcome-pill outcome-${
                        game.outcome === "W"
                          ? "win"
                          : game.outcome === "L"
                            ? "loss"
                            : game.outcome === "T"
                              ? "tie"
                              : "open"
                      }`}
                    >
                      {game.outcome}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function HistoryPanel({
  archive,
  leagueId,
  season,
  view = "standings",
  a,
  b,
  sport,
}: {
  archive: LeagueHistoryArchive | null;
  leagueId: string;
  season: number;
  view?: HistoryView;
  a?: number;
  b?: number;
  sport?: string;
}) {
  const active: HistoryView = ["standings", "champions", "records", "h2h"].includes(
    view,
  )
    ? view
    : "standings";
  const isGolf = sport === "golf";

  if (!archive || archive.seasons.length === 0) {
    return (
      <div className="history-panel">
        <p className="league-meta">
          {isGolf ? (
            <>
              No golf seasons on disk yet. Create a league or regenerate{" "}
              <code>golf-main</code> fixtures; multi-season archives grow as you
              add years under the same league id.
            </>
          ) : (
            <>
              No multi-season history on disk for this league. Run{" "}
              <code>sj seed</code> or sync past seasons to populate the archive.
            </>
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="history-panel">
      <p className="league-meta" style={{ marginTop: 0 }}>
        {seasonCountLabel(archive)} · franchises keyed by team id · owners may
        change year to year
        {isGolf
          ? " · event weeks projected from the scoreboard into Records / H2H"
          : ""}
      </p>
      <ViewSwitcher
        leagueId={leagueId}
        season={season}
        view={active}
        a={a}
        b={b}
      />
      {active === "standings" ? (
        <AllTimeTable archive={archive} leagueId={leagueId} season={season} />
      ) : null}
      {active === "champions" ? (
        <ChampionsTable archive={archive} leagueId={leagueId} />
      ) : null}
      {active === "records" ? <RecordsList archive={archive} /> : null}
      {active === "h2h" ? (
        <H2HView
          archive={archive}
          leagueId={leagueId}
          season={season}
          a={a}
          b={b}
        />
      ) : null}
    </div>
  );
}
