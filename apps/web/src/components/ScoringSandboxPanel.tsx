"use client";

import { useMemo, useState } from "react";

import { EmptyState } from "@/components/EmptyState";
import {
  defaultTweaks,
  formatDelta,
  outcomeArrow,
  sandboxStorageKey,
  sandboxTeamName,
  simulateBaseball,
  simulateFootball,
  simulateGolf,
  simulateHockey,
  type SandboxScoringItem,
  type SandboxTweaks,
  type ScoringSandboxModel,
} from "@/lib/scoring-sandbox";

function clamp(item: SandboxScoringItem, value: number): number {
  if (item.kind === "toggle") return value > 0 ? 1 : 0;
  if (item.kind === "count") return Math.round(value);
  return value;
}

function applyItem(
  tweaks: SandboxTweaks,
  item: SandboxScoringItem,
  value: number,
): SandboxTweaks {
  const next: SandboxTweaks = {
    weights: { ...tweaks.weights },
    enabled: { ...tweaks.enabled },
    golf: {
      ...tweaks.golf,
      multipliers: { ...tweaks.golf.multipliers },
    },
  };
  const v = clamp(item, value);
  if (item.kind === "toggle" && item.key === "drop_worst_golfer") {
    next.golf.dropWorst = v > 0;
    next.weights[item.key] = v;
    return next;
  }
  if (item.kind === "toggle") {
    next.enabled[item.key] = v > 0;
    next.weights[item.key] = v;
    return next;
  }
  if (item.key === "thu_fri_count") {
    next.golf.thuFriCount = v;
    next.weights[item.key] = v;
    return next;
  }
  if (item.key === "sat_sun_count") {
    next.golf.satSunCount = v;
    next.weights[item.key] = v;
    return next;
  }
  if (item.key.startsWith("multiplier.")) {
    const tier = item.key.slice("multiplier.".length) as
      | "regular"
      | "signature"
      | "major";
    next.golf.multipliers[tier] = v;
    next.weights[item.key] = v;
    return next;
  }
  next.weights[item.key] = v;
  return next;
}

function itemValue(tweaks: SandboxTweaks, item: SandboxScoringItem): number {
  if (item.kind === "toggle" && item.key === "drop_worst_golfer") {
    return tweaks.golf.dropWorst ? 1 : 0;
  }
  if (item.kind === "toggle") {
    return tweaks.enabled[item.key] === false ? 0 : 1;
  }
  if (item.key === "thu_fri_count") return tweaks.golf.thuFriCount;
  if (item.key === "sat_sun_count") return tweaks.golf.satSunCount;
  if (item.key.startsWith("multiplier.")) {
    const tier = item.key.slice("multiplier.".length) as
      | "regular"
      | "signature"
      | "major";
    return tweaks.golf.multipliers[tier];
  }
  return tweaks.weights[item.key] ?? item.official;
}

function dirty(model: ScoringSandboxModel, tweaks: SandboxTweaks): boolean {
  const baseline = defaultTweaks(model);
  return JSON.stringify(tweaks) !== JSON.stringify(baseline);
}

export function ScoringSandboxPanel({ model }: { model: ScoringSandboxModel }) {
  const [tweaks, setTweaks] = useState<SandboxTweaks>(() => defaultTweaks(model));
  const [week, setWeek] = useState<number | null>(
    () => model.football?.weeks.at(-1)?.week ?? null,
  );
  const [saved, setSaved] = useState<"idle" | "saved" | "restored">("idle");

  function restoreDraft() {
    try {
      const raw = sessionStorage.getItem(
        sandboxStorageKey(model.leagueId, model.season),
      );
      if (!raw) return;
      const parsed = JSON.parse(raw) as SandboxTweaks;
      if (!parsed?.weights) return;
      setTweaks({
        ...defaultTweaks(model),
        ...parsed,
        golf: { ...defaultTweaks(model).golf, ...parsed.golf },
      });
      setSaved("restored");
    } catch {
      /* ignore bad drafts */
    }
  }

  const football = useMemo(
    () =>
      model.sport === "football"
        ? simulateFootball(model, tweaks.weights, week)
        : null,
    [model, tweaks.weights, week],
  );
  const baseball = useMemo(
    () => (model.sport === "baseball" ? simulateBaseball(model, tweaks) : null),
    [model, tweaks],
  );
  const hockey = useMemo(
    () => (model.sport === "hockey" ? simulateHockey(model, tweaks) : null),
    [model, tweaks],
  );
  const golf = useMemo(
    () => (model.sport === "golf" ? simulateGolf(model, tweaks.golf) : null),
    [model, tweaks.golf],
  );

  const changed = dirty(model, tweaks);
  const weeks = model.football?.weeks.map((w) => w.week) ?? [];
  const recItem = model.items.find((item) => item.key === "REC");

  function applyRecPreset(value: number | null) {
    const baseline = defaultTweaks(model);
    if (value == null || !recItem) {
      setTweaks(baseline);
      setSaved("idle");
      return;
    }
    setTweaks(applyItem(baseline, recItem, value));
    setSaved("idle");
  }

  return (
    <div className="scoring-sandbox">
      <p className="lede">
        Scoring lab — clone this season&apos;s official items and see every team
        move. Sandbox only: nothing writes ESPN or the live settings file.
      </p>
      <p className="league-meta">{model.disclaimer}</p>

      <section className="panel scoring-sandbox-controls">
        <div className="scoring-sandbox-toolbar">
          <h3 className="roster-group-title">Scoring items</h3>
          <div className="scoring-sandbox-actions">
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                setTweaks(defaultTweaks(model));
                setSaved("idle");
              }}
              disabled={!changed}
            >
              Reset official
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                sessionStorage.setItem(
                  sandboxStorageKey(model.leagueId, model.season),
                  JSON.stringify(tweaks),
                );
                setSaved("saved");
              }}
            >
              Save this tab
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={restoreDraft}
            >
              Restore saved
            </button>
          </div>
        </div>
        {saved === "saved" ? (
          <p className="league-meta">Draft stored in this browser tab only.</p>
        ) : null}
        {saved === "restored" ? (
          <p className="league-meta">Restored the draft from this browser tab.</p>
        ) : null}

        {recItem ? (
          <div className="scoring-sandbox-presets" role="group" aria-label="Reception presets">
            <span className="league-meta">Receptions</span>
            <button
              type="button"
              className="button secondary"
              onClick={() => applyRecPreset(null)}
            >
              Official
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => applyRecPreset(1)}
            >
              1.0
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => applyRecPreset(0.5)}
            >
              0.5
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => applyRecPreset(0)}
            >
              0
            </button>
          </div>
        ) : null}

        {weeks.length ? (
          <div className="tabs" style={{ margin: "0.35rem 0 0.75rem" }}>
            <button
              type="button"
              className={`tab${week == null ? " active" : ""}`}
              onClick={() => setWeek(null)}
            >
              Stored weeks
            </button>
            {weeks.map((w) => (
              <button
                key={w}
                type="button"
                className={`tab${week === w ? " active" : ""}`}
                onClick={() => setWeek(w)}
              >
                {model.periodLabel} {w}
              </button>
            ))}
          </div>
        ) : null}

        <div className="scoring-sandbox-items">
          {model.items.map((item) => {
            const value = itemValue(tweaks, item);
            const off = value !== item.official;
            return (
              <label key={item.key} className="scoring-sandbox-item">
                <span>
                  {item.label}
                  {item.inferred ? (
                    <span className="league-meta"> · not in settings</span>
                  ) : null}
                </span>
                {item.kind === "toggle" ? (
                  <input
                    type="checkbox"
                    checked={value > 0}
                    onChange={(e) =>
                      setTweaks(applyItem(tweaks, item, e.target.checked ? 1 : 0))
                    }
                  />
                ) : (
                  <span className="scoring-sandbox-slider">
                    <input
                      type="range"
                      min={item.min}
                      max={item.max}
                      step={item.step}
                      value={value}
                      aria-label={item.label}
                      onChange={(e) =>
                        setTweaks(applyItem(tweaks, item, Number(e.target.value)))
                      }
                    />
                    <input
                      type="number"
                      min={item.min}
                      max={item.max}
                      step={item.step}
                      value={value}
                      aria-label={`${item.label} value`}
                      onChange={(e) =>
                        setTweaks(applyItem(tweaks, item, Number(e.target.value)))
                      }
                    />
                  </span>
                )}
                <span className={off ? "is-delta" : "league-meta"}>
                  official {item.official}
                  {off ? ` → ${value}` : ""}
                </span>
              </label>
            );
          })}
        </div>
      </section>

      {football ? <FootballTables model={model} result={football} /> : null}
      {baseball ? <BaseballTables model={model} result={baseball} /> : null}
      {hockey ? <BaseballTables model={model} result={hockey} /> : null}
      {golf ? <GolfTables model={model} result={golf} /> : null}

      {model.sport === "football" && !model.football?.weeks.length ? (
        <EmptyState title="No stored box scores">
          Sync football <code>weeks/{"{N}"}.json</code> to resimulate weekly
          W/L. Scoring sliders still edit locally.
        </EmptyState>
      ) : null}
      {model.sport === "hockey" &&
      !model.items.length &&
      !model.hockey?.teams.some((t) => Object.keys(t.stats).length) ? (
        <EmptyState title="No hockey stats on this snapshot">
          Scoring lab will not invent fantasy points. Sync ESPN settings or
          roster <code>season_stats</code> first.
        </EmptyState>
      ) : null}
    </div>
  );
}

function FootballTables({
  model,
  result,
}: {
  model: ScoringSandboxModel;
  result: ReturnType<typeof simulateFootball>;
}) {
  return (
    <>
      <section className="panel table-scroll">
        <h3 className="roster-group-title" style={{ padding: "0.85rem 1rem 0" }}>
          Team totals
        </h3>
        <table className="table-cards">
          <thead>
            <tr>
              <th>Team</th>
              <th className="numeric">Official</th>
              <th className="numeric">Simulated</th>
              <th className="numeric">Δ</th>
              <th>Per-stat Δ</th>
            </tr>
          </thead>
          <tbody>
            {result.teams.map((row) => (
              <tr key={row.teamId}>
                <td data-label="Team">{row.name}</td>
                <td data-label="Official" className="numeric">
                  {row.official.toFixed(1)}
                </td>
                <td data-label="Simulated" className="numeric">
                  {row.simulated.toFixed(1)}
                </td>
                <td data-label="Δ" className="numeric">
                  {formatDelta(row.delta)}
                </td>
                <td data-label="Per-stat Δ">
                  {Object.keys(row.statDeltas).length
                    ? Object.entries(row.statDeltas)
                        .map(([k, v]) => `${k} ${formatDelta(v)}`)
                        .join(" · ")
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel table-scroll">
        <h3 className="roster-group-title" style={{ padding: "0.85rem 1rem 0" }}>
          Matchup winners
        </h3>
        {result.matchups.length ? (
          <table className="table-cards">
            <thead>
              <tr>
                <th>{model.periodLabel}</th>
                <th>Matchup</th>
                <th>Official</th>
                <th>Simulated</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {result.matchups.map((row) => (
                <tr key={`${row.week}-${row.homeId}-${row.awayId}`}>
                  <td data-label={model.periodLabel}>{row.week}</td>
                  <td data-label="Matchup">
                    {sandboxTeamName(model.teams, row.homeId)}{" "}
                    {row.homeOfficial.toFixed(1)}–{row.awayOfficial.toFixed(1)}{" "}
                    {sandboxTeamName(model.teams, row.awayId)}
                  </td>
                  <td data-label="Official">
                    {row.homeOfficial.toFixed(1)}–{row.awayOfficial.toFixed(1)}
                  </td>
                  <td data-label="Simulated">
                    {row.homeSim.toFixed(1)}–{row.awaySim.toFixed(1)}
                  </td>
                  <td data-label="Result">
                    <span className={row.flipped ? "is-delta" : undefined}>
                      {outcomeArrow(row.officialOutcome, row.simulatedOutcome)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="league-meta" style={{ padding: "0 1rem 1rem" }}>
            No stored matchups in the selected weeks.
          </p>
        )}
      </section>
    </>
  );
}

function BaseballTables({
  model,
  result,
}: {
  model: ScoringSandboxModel;
  result: ReturnType<typeof simulateBaseball>;
}) {
  const category = result.mode === "category";
  return (
    <>
      <section className="panel table-scroll">
        <h3 className="roster-group-title" style={{ padding: "0.85rem 1rem 0" }}>
          {category ? "Category ranks" : "Season points"}
        </h3>
        <table className="table-cards">
          <thead>
            <tr>
              <th>Team</th>
              <th className="numeric">{category ? "Roto official" : "Official"}</th>
              <th className="numeric">{category ? "Roto sim" : "Simulated"}</th>
              <th className="numeric">Δ</th>
              <th>Rank</th>
              {category ? <th>Cats</th> : <th>Per-stat Δ</th>}
            </tr>
          </thead>
          <tbody>
            {result.teams.map((row) => (
              <tr key={row.teamId}>
                <td data-label="Team">{row.name}</td>
                <td data-label="Official" className="numeric">
                  {row.official.toFixed(1)}
                </td>
                <td data-label="Simulated" className="numeric">
                  {row.simulated.toFixed(1)}
                </td>
                <td data-label="Δ" className="numeric">
                  {formatDelta(row.delta)}
                </td>
                <td data-label="Rank">
                  {row.officialRank ?? "—"} → {row.simulatedRank}
                  {row.rankDelta
                    ? ` (${formatDelta(row.rankDelta, 0)} seed)`
                    : ""}
                </td>
                <td data-label={category ? "Cats" : "Per-stat Δ"}>
                  {category
                    ? `${row.catWins}-${row.catLosses}-${row.catTies}`
                    : Object.keys(row.statDeltas).length
                      ? Object.entries(row.statDeltas)
                          .map(([k, v]) => `${k} ${formatDelta(v)}`)
                          .join(" · ")
                      : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {result.flips.length ? (
        <section className="panel table-scroll">
          <h3 className="roster-group-title" style={{ padding: "0.85rem 1rem 0" }}>
            Category flips
          </h3>
          <table className="table-cards">
            <thead>
              <tr>
                <th>Period</th>
                <th>Matchup</th>
                <th>Cat</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {result.flips.map((flip) => (
                <tr key={`${flip.week}-${flip.homeId}-${flip.key}`}>
                  <td data-label="Period">{flip.week}</td>
                  <td data-label="Matchup">
                    {sandboxTeamName(model.teams, flip.homeId)} vs{" "}
                    {sandboxTeamName(model.teams, flip.awayId)}
                  </td>
                  <td data-label="Cat">{flip.key}</td>
                  <td data-label="Result" className="is-delta">
                    {outcomeArrow(flip.official, flip.simulated)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </>
  );
}

function GolfTables({
  model,
  result,
}: {
  model: ScoringSandboxModel;
  result: ReturnType<typeof simulateGolf>;
}) {
  return (
    <>
      <section className="panel table-scroll">
        <h3 className="roster-group-title" style={{ padding: "0.85rem 1rem 0" }}>
          Season totals
        </h3>
        <table className="table-cards">
          <thead>
            <tr>
              <th>Team</th>
              <th className="numeric">Official</th>
              <th className="numeric">Simulated</th>
              <th className="numeric">Δ</th>
              <th>Rank</th>
            </tr>
          </thead>
          <tbody>
            {result.teams.map((row) => (
              <tr key={row.teamId}>
                <td data-label="Team">{row.name}</td>
                <td data-label="Official" className="numeric">
                  {row.official.toFixed(1)}
                </td>
                <td data-label="Simulated" className="numeric">
                  {row.simulated.toFixed(1)}
                </td>
                <td data-label="Δ" className="numeric">
                  {formatDelta(row.delta)}
                </td>
                <td data-label="Rank">
                  {row.officialRank ?? "—"} → {row.simulatedRank}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {result.matchups.length ? (
        <section className="panel table-scroll">
          <h3 className="roster-group-title" style={{ padding: "0.85rem 1rem 0" }}>
            Event winners
          </h3>
          <table className="table-cards">
            <thead>
              <tr>
                <th>Event</th>
                <th>Matchup</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {result.matchups.map((row) => (
                <tr key={`${row.eventId}-${row.homeId}`}>
                  <td data-label="Event">{row.eventId}</td>
                  <td data-label="Matchup">
                    {sandboxTeamName(model.teams, row.homeId)} vs{" "}
                    {sandboxTeamName(model.teams, row.awayId)}
                  </td>
                  <td data-label="Result">
                    <span className={row.flipped ? "is-delta" : undefined}>
                      {outcomeArrow(row.officialOutcome, row.simulatedOutcome)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </>
  );
}
