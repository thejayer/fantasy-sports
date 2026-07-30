"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Team } from "@/lib/data";
import {
  evaluateTrade,
  findTwoForOneTrades,
  rosterWithProjections,
  sumRosterProjections,
  type RosterProjectionTotals,
} from "@/lib/decision-tools";
import { tradeVerdict } from "@/lib/trade-verdict";
import {
  formatProjectionPoints,
  type PlayerWithProjection,
} from "@/lib/projection-join";
import type { ProjectionPlayer } from "@/lib/data";

function TotalsTable({
  label,
  before,
  after,
  deltaMedian,
  deltaVor,
}: {
  label: string;
  before: RosterProjectionTotals;
  after: RosterProjectionTotals;
  deltaMedian: number;
  deltaVor: number;
}) {
  const fmtDelta = (value: number) =>
    `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
  return (
    <div className="panel table-scroll">
      <h3 style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>{label}</h3>
      <table className="table-cards">
        <thead>
          <tr>
            <th></th>
            <th>Before</th>
            <th>After</th>
            <th>Δ</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td data-label="">Median</td>
            <td data-label="Before">{formatProjectionPoints(before.median)}</td>
            <td data-label="After">{formatProjectionPoints(after.median)}</td>
            <td data-label="Δ">{fmtDelta(deltaMedian)}</td>
          </tr>
          <tr>
            <td data-label="">VOR</td>
            <td data-label="Before">{formatProjectionPoints(before.vor)}</td>
            <td data-label="After">{formatProjectionPoints(after.vor)}</td>
            <td data-label="Δ">{fmtDelta(deltaVor)}</td>
          </tr>
          <tr>
            <td data-label="">Floor</td>
            <td data-label="Before">{formatProjectionPoints(before.floor)}</td>
            <td data-label="After">{formatProjectionPoints(after.floor)}</td>
            <td data-label="Δ">
              {fmtDelta(after.floor - before.floor)}
            </td>
          </tr>
          <tr>
            <td data-label="">Ceiling</td>
            <td data-label="Before">{formatProjectionPoints(before.ceiling)}</td>
            <td data-label="After">{formatProjectionPoints(after.ceiling)}</td>
            <td data-label="Δ">
              {fmtDelta(after.ceiling - before.ceiling)}
            </td>
          </tr>
          <tr>
            <td data-label="">Mapped</td>
            <td data-label="Before">
              {before.mapped}/{before.rostered}
            </td>
            <td data-label="After">
              {after.mapped}/{after.rostered}
            </td>
            <td data-label="Δ">—</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function RosterPicker({
  title,
  players,
  selected,
  onToggle,
}: {
  title: string;
  players: PlayerWithProjection[];
  selected: Set<string>;
  onToggle: (espnId: string) => void;
}) {
  return (
    <div className="panel table-scroll">
      <h3 style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>{title}</h3>
      <table className="table-cards">
        <thead>
          <tr>
            <th></th>
            <th>Player</th>
            <th>Pos</th>
            <th>Med</th>
            <th>VOR</th>
          </tr>
        </thead>
        <tbody>
          {players.map((player) => {
            const espn = String(player.id ?? "");
            const checked = selected.has(espn);
            return (
              <tr key={`${espn}-${player.name}`}>
                <td data-label="Offer">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!player.projection || !espn}
                    onChange={() => onToggle(espn)}
                    aria-label={`Offer ${player.name}`}
                  />
                </td>
                <td data-label="Player">{player.name}</td>
                <td data-label="Pos">{player.position ?? "—"}</td>
                <td data-label="Med">
                  {formatProjectionPoints(player.projection?.median)}
                </td>
                <td data-label="VOR">
                  {formatProjectionPoints(player.projection?.vor)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function TradeAnalyzer({
  teams,
  espnToGsisEntries,
  projectionEntries,
  initialA,
  initialB,
  leagueId,
  season,
}: {
  teams: Team[];
  /** Serializable Map entries from the server. */
  espnToGsisEntries: Array<[string, string]>;
  projectionEntries: Array<[string, ProjectionPlayer]>;
  initialA: number;
  initialB: number;
  leagueId: string;
  season: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const espnToGsis = useMemo(
    () => new Map(espnToGsisEntries),
    [espnToGsisEntries],
  );
  const byGsis = useMemo(
    () => new Map(projectionEntries),
    [projectionEntries],
  );

  const [teamAId, setTeamAId] = useState(initialA);
  const [teamBId, setTeamBId] = useState(initialB);
  const [give, setGive] = useState<Set<string>>(new Set());
  const [get, setGet] = useState<Set<string>>(new Set());

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("season", String(season));
    params.set("tab", "tools");
    params.set("view", "trade");
    params.set("a", String(teamAId));
    params.set("b", String(teamBId));
    params.delete("team");
    params.delete("slot");
    const next = `${pathname}?${params.toString()}`;
    const current = `${pathname}?${searchParams.toString()}`;
    if (next !== current) {
      router.replace(next, { scroll: false });
    }
  }, [teamAId, teamBId, leagueId, season, pathname, router, searchParams]);

  const teamA = teams.find((t) => t.team_id === teamAId) ?? teams[0];
  const teamB = teams.find((t) => t.team_id === teamBId) ?? teams[1] ?? teams[0];

  const rosterA = useMemo(
    () => rosterWithProjections(teamA?.roster ?? [], espnToGsis, byGsis),
    [teamA, espnToGsis, byGsis],
  );
  const rosterB = useMemo(
    () => rosterWithProjections(teamB?.roster ?? [], espnToGsis, byGsis),
    [teamB, espnToGsis, byGsis],
  );

  const result = useMemo(() => {
    if (!teamA || !teamB) return null;
    return evaluateTrade(
      teamA,
      teamB,
      [...give],
      [...get],
      espnToGsis,
      byGsis,
    );
  }, [teamA, teamB, give, get, espnToGsis, byGsis]);

  const verdict = useMemo(() => {
    if (!result || !teamA || !teamB) return null;
    if (give.size === 0 && get.size === 0) return null;
    return tradeVerdict(result.sideA, result.sideB, teamA.name, teamB.name);
  }, [result, teamA, teamB, give, get]);

  const finderHits = useMemo(() => {
    if (!teamA || !teamB) return [];
    return findTwoForOneTrades(teamA, teamB, espnToGsis, byGsis, {
      limit: 6,
      maxCandidatesPerSide: 6,
    });
  }, [teamA, teamB, espnToGsis, byGsis]);

  const baselineA = useMemo(
    () => sumRosterProjections(rosterA),
    [rosterA],
  );
  const baselineB = useMemo(
    () => sumRosterProjections(rosterB),
    [rosterB],
  );

  if (!teamA || !teamB || teams.length < 2) {
    return (
      <p className="league-meta">Need at least two teams to analyze a trade.</p>
    );
  }

  const toggle = (
    setter: (next: Set<string>) => void,
    current: Set<string>,
    espnId: string,
  ) => {
    const next = new Set(current);
    if (next.has(espnId)) next.delete(espnId);
    else next.add(espnId);
    setter(next);
  };

  return (
    <div className="trade-analyzer">
      <p className="lede" style={{ marginTop: "0.75rem" }}>
        Trade Desk — compare season projection totals before and after a
        package, then read a verdict. Quantiles are summed independently (store
        has no joint sample matrix) — direction, not a full Monte Carlo trade
        net.
      </p>

      <div
        className="cta-row"
        style={{ gap: "1rem", flexWrap: "wrap", marginBottom: "0.75rem" }}
      >
        <label className="league-meta">
          You{" "}
          <select
            value={teamAId}
            onChange={(e) => {
              setTeamAId(Number(e.target.value));
              setGive(new Set());
            }}
          >
            {teams.map((t) => (
              <option key={t.team_id} value={t.team_id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="league-meta">
          Partner{" "}
          <select
            value={teamBId}
            onChange={(e) => {
              setTeamBId(Number(e.target.value));
              setGet(new Set());
            }}
          >
            {teams.map((t) => (
              <option key={t.team_id} value={t.team_id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            setGive(new Set());
            setGet(new Set());
          }}
        >
          Clear package
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "1rem",
        }}
      >
        <RosterPicker
          title={`${teamA.name} offers`}
          players={rosterA}
          selected={give}
          onToggle={(id) => toggle(setGive, give, id)}
        />
        <RosterPicker
          title={`${teamB.name} offers`}
          players={rosterB}
          selected={get}
          onToggle={(id) => toggle(setGet, get, id)}
        />
      </div>

      {result && (give.size > 0 || get.size > 0) ? (
        <>
          {verdict ? (
            <div className="panel" style={{ marginTop: "1rem" }} data-testid="trade-verdict">
              <h3 style={{ margin: "0 0 0.35rem", fontSize: "1.05rem" }}>
                Verdict
              </h3>
              <p style={{ margin: "0 0 0.35rem" }}>{verdict.headline}</p>
              <p className="league-meta" style={{ margin: 0 }}>
                {verdict.uncertainty}
              </p>
            </div>
          ) : null}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: "1rem",
              marginTop: "1rem",
            }}
          >
            <TotalsTable
              label={`${teamA.name} after trade`}
              before={result.sideA.before}
              after={result.sideA.after}
              deltaMedian={result.sideA.deltaMedian}
              deltaVor={result.sideA.deltaVor}
            />
            <TotalsTable
              label={`${teamB.name} after trade`}
              before={result.sideB.before}
              after={result.sideB.after}
              deltaMedian={result.sideB.deltaMedian}
              deltaVor={result.sideB.deltaVor}
            />
          </div>
        </>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: "1rem",
            marginTop: "1rem",
          }}
        >
          <div className="panel">
            <h3 style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>
              {teamA.name} roster strength
            </h3>
            <p className="league-meta">
              Median {formatProjectionPoints(baselineA.median)} · VOR{" "}
              {formatProjectionPoints(baselineA.vor)} · mapped {baselineA.mapped}/
              {baselineA.rostered}
            </p>
          </div>
          <div className="panel">
            <h3 style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>
              {teamB.name} roster strength
            </h3>
            <p className="league-meta">
              Median {formatProjectionPoints(baselineB.median)} · VOR{" "}
              {formatProjectionPoints(baselineB.vor)} · mapped {baselineB.mapped}/
              {baselineB.rostered}
            </p>
          </div>
        </div>
      )}

      {finderHits.length ? (
        <div className="panel" style={{ marginTop: "1rem" }} data-testid="trade-finder">
          <h3 style={{ margin: "0 0 0.35rem", fontSize: "1.05rem" }}>
            Trade Finder
          </h3>
          <p className="league-meta" style={{ marginTop: 0 }}>
            Bounded 2-for-1 packages ranked by joint median improvement. Click
            Apply to load a package into the desk.
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: "0.5rem 0 0" }}>
            {finderHits.map((hit) => (
              <li
                key={`${hit.giveIds.join("-")}_${hit.getIds.join("-")}`}
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0.5rem",
                  alignItems: "center",
                  marginTop: "0.5rem",
                }}
              >
                <span className="league-meta">
                  {hit.giveNames.join(" + ")} → {hit.getNames.join(" + ")} ·
                  joint {hit.jointMedian >= 0 ? "+" : ""}
                  {hit.jointMedian.toFixed(1)} ({teamA.name}{" "}
                  {hit.sideADeltaMedian >= 0 ? "+" : ""}
                  {hit.sideADeltaMedian.toFixed(1)}, {teamB.name}{" "}
                  {hit.sideBDeltaMedian >= 0 ? "+" : ""}
                  {hit.sideBDeltaMedian.toFixed(1)})
                </span>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    setGive(new Set(hit.giveIds));
                    setGet(new Set(hit.getIds));
                  }}
                >
                  Apply
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
