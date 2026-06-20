"""Streamlit dashboard for the ffa pipeline.

Launch via the CLI:

    ffa dashboard --league configs/ppr.yaml --season 2025

or directly:

    streamlit run src/ffa/dashboard.py -- --league configs/ppr.yaml --season 2025

Sections:
    - Sidebar: league config, season, generator, sample count.
    - Ranked board: VOR + tier + floor/median/ceiling, filterable by position.
    - Per-player distribution: histogram of simulated season points.
    - Lineup optimizer: best lineup under the configured roster.
    - Draft sim: pick-rate table + "available at my next pick" matrix.

The dashboard is a thin presentation layer over the pure-Python API in
:mod:`ffa`. Analysis logic lives in the library; chart/table builders here
are kept as small pure helpers so they can be unit-tested without a browser.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
from typing import Iterable

import altair as alt
import numpy as np
import pandas as pd
import streamlit as st

from ffa.draft import simulate_draft, summarize_user_picks
from ffa.ingest import open_warehouse
from ffa.learned import simulate_seasons_learned
from ffa.league import load_league
from ffa.optimize import optimize_lineup
from ffa.quantile import simulate_seasons_quantile_calibrated
from ffa.ranking import assign_tiers, compute_vor
from ffa.scoring import score_player_weeks
from ffa.simulation import simulate_seasons, summarize_seasons


_GENERATORS = {
    "bootstrap": simulate_seasons,
    "learned": simulate_seasons_learned,
    "quantile": simulate_seasons_quantile_calibrated,
}

# Friendly labels + inline help for the cryptic posterior columns.
def _ranked_column_config() -> dict:
    return {
        "player_display_name": st.column_config.TextColumn("Player"),
        "position": st.column_config.TextColumn("Pos"),
        "recent_team": st.column_config.TextColumn("Team"),
        "tier": st.column_config.NumberColumn(
            "Tier", help="Players grouped by scoring gaps; 1 = top group at the position."
        ),
        "points_mean": st.column_config.NumberColumn(
            "Proj Pts", format="%.1f", help="Mean projected season fantasy points."
        ),
        "vor": st.column_config.NumberColumn(
            "VOR",
            format="%.1f",
            help="Value over replacement: points above a freely-available "
            "player at the same position. Compare across positions with this.",
        ),
        "q05": st.column_config.NumberColumn("Floor", format="%.0f", help="5th-percentile outcome."),
        "q50": st.column_config.NumberColumn("Median", format="%.0f", help="50th-percentile outcome."),
        "q95": st.column_config.NumberColumn("Ceiling", format="%.0f", help="95th-percentile outcome."),
    }


def _parse_args() -> argparse.Namespace:
    """Streamlit passes everything after `--` to sys.argv; parse defaults."""
    p = argparse.ArgumentParser(allow_abbrev=False)
    p.add_argument("--league", type=Path, default=Path("configs/ppr.yaml"))
    p.add_argument("--season", type=int, default=2025)
    p.add_argument("--db", type=Path, default=Path("data/ffa.duckdb"))
    p.add_argument("--raw-dir", type=Path, default=Path("data/raw"))
    args, _ = p.parse_known_args()
    return args


def distribution_chart(points: pd.Series, floor: float, median: float, ceiling: float):
    """Build a histogram of simulated season points with floor/median/ceiling rules.

    Pure helper: returns an Altair chart and never touches Streamlit, so it
    can be validated in tests via ``.to_dict()`` (which is what surfaces the
    SchemaValidationError that the old ``st.bar_chart(pd.cut(...))`` produced).
    """
    data = pd.DataFrame({"points": points.astype(float).to_numpy()})
    hist = (
        alt.Chart(data)
        .mark_bar(opacity=0.85, color="#4c78a8")
        .encode(
            x=alt.X("points:Q", bin=alt.Bin(maxbins=40), title="Projected season points"),
            y=alt.Y("count():Q", title="Simulations"),
            tooltip=[alt.Tooltip("count():Q", title="Simulations")],
        )
    )
    rule_data = pd.DataFrame(
        {
            "value": [float(floor), float(median), float(ceiling)],
            "label": ["Floor (q05)", "Median (q50)", "Ceiling (q95)"],
        }
    )
    rules = (
        alt.Chart(rule_data)
        .mark_rule(strokeDash=[5, 4], color="#e45756", size=2)
        .encode(x="value:Q", tooltip=["label", alt.Tooltip("value:Q", format=".1f")])
    )
    return (hist + rules).properties(height=320)


def availability_view(availability: pd.DataFrame, ranked: pd.DataFrame, top: int = 40) -> pd.DataFrame:
    """Join the draft availability matrix to player names; values as percentages.

    Pure helper. ``availability`` has one row per player_id and one column per
    user draft round (probability still on the board at that pick).
    """
    meta_cols = [c for c in ("player_display_name", "position", "vor") if c in ranked.columns]
    merged = availability.merge(ranked[["player_id", *meta_cols]], on="player_id", how="left")
    round_cols = [c for c in merged.columns if c.startswith("round_")]
    for rc in round_cols:
        merged[rc] = (merged[rc] * 100).round(0)
    sort_col = "vor" if "vor" in merged.columns else round_cols[0] if round_cols else "player_id"
    merged = merged.sort_values(sort_col, ascending=False).head(top)
    display_cols = [c for c in ("player_display_name", "position") if c in merged.columns]
    return merged[[*display_cols, *round_cols]].reset_index(drop=True)


def risk_badge(q05: float, q50: float, q95: float) -> str:
    """Label a player's outcome spread as safe / solid / volatile.

    Uses the relative interval width ``(q95 - q05) / q50`` -- a wide
    floor-to-ceiling gap relative to the median is a boom-or-bust profile.
    Pure helper so it's unit-testable without Streamlit.
    """
    if pd.isna(q05) or pd.isna(q95) or pd.isna(q50) or q50 <= 0:
        return "—"
    rel = (q95 - q05) / q50
    if rel < 0.7:
        return "🟢 Safe"
    if rel < 1.1:
        return "🟡 Solid"
    return "🔴 Volatile"


def outcome_sparklines(
    samples_df: pd.DataFrame,
    league,
    player_ids: Iterable[str],
    bins: int = 16,
    clip_q: float = 0.99,
) -> dict:
    """Per-player coarse histogram of simulated season points for the board.

    Scores every sample once, then bins each player's outcomes over a *shared*
    range so the sparklines are comparable row to row -- a star's mass sits
    right, a fringe player's left, and the skew (boom vs bust) is visible
    inline. Returns ``{player_id: [counts...]}`` for ``BarChartColumn``.
    """
    from ffa.scoring import score_player_weeks

    ids = set(player_ids)
    scored = samples_df[samples_df["player_id"].isin(ids)]
    if scored.empty:
        return {}
    pts = score_player_weeks(scored, league)
    scored = scored[["player_id"]].assign(_pts=pts.to_numpy())
    hi = float(scored["_pts"].quantile(clip_q))
    hi = hi if hi > 0 else 1.0
    out: dict = {}
    for pid, grp in scored.groupby("player_id", sort=False):
        counts, _ = np.histogram(grp["_pts"].to_numpy(), bins=bins, range=(0.0, hi))
        out[pid] = counts.tolist()
    return out


@st.cache_data(show_spinner="Loading weekly history...")
def _load_weekly(seasons: tuple[int, ...], db: str, raw_dir: str) -> pd.DataFrame:
    con = open_warehouse(db_path=db, raw_dir=raw_dir)
    placeholders = ",".join("?" for _ in seasons)
    return con.execute(
        f"SELECT * FROM weekly WHERE season IN ({placeholders})", list(seasons)
    ).df()


@st.cache_data(show_spinner="Running simulations...")
def _simulate(
    weekly: pd.DataFrame,
    season: int,
    generator: str,
    samples: int,
    lookback: int,
    decay: float,
    expected_games: float,
    games_model: str,
    level_sd: float,
    level_mean: float,
    seed: int,
) -> pd.DataFrame:
    simulator = _GENERATORS[generator]
    return simulator(
        weekly,
        target_season=season,
        n_samples=samples,
        lookback=lookback,
        decay=decay,
        expected_games=expected_games,
        games_model=games_model,
        level_sd=level_sd,
        level_mean=level_mean,
        seed=seed,
    )


def _password_gate() -> None:
    """Block the app behind a shared password when DASHBOARD_PASSWORD is set."""
    expected = os.environ.get("DASHBOARD_PASSWORD", "")
    if not expected:
        return
    if st.session_state.get("_ffa_auth"):
        return
    st.markdown("### Sign in")
    st.caption("This dashboard is gated. Enter the league password to continue.")
    pwd = st.text_input("Password", type="password", key="_ffa_pwd_input")
    if st.button("Continue"):
        if pwd == expected:
            st.session_state["_ffa_auth"] = True
            st.rerun()
        else:
            st.error("Incorrect password.")
    st.stop()


def main() -> None:
    args = _parse_args()
    st.set_page_config(page_title="ffa", layout="wide")
    _password_gate()
    st.title("Fantasy Football Analytics")

    # ---------------- Sidebar ----------------
    # Everyday users touch only league + season; the model is pre-set to the
    # backtest-calibrated config (empirical games + level uncertainty). Power
    # users can override under "Advanced".
    with st.sidebar:
        st.header("League")
        league_path = Path(st.text_input("League config (YAML)", value=str(args.league)))
        season = int(st.number_input("Target season", value=args.season, step=1))

        with st.expander("Advanced (model settings)"):
            st.caption("Defaults are the calibrated config; change only if you know why.")
            generator = st.selectbox(
                "Generator",
                options=list(_GENERATORS),
                help="bootstrap = empirical resample; learned = ML mean; "
                "quantile = ML with calibrated floor/ceiling.",
            )
            games_model = st.selectbox(
                "Games played",
                options=["empirical", "fixed"],
                help="empirical = sample games played from history (calibrated); "
                "fixed = assume every player plays the full season.",
            )
            level_sd = float(
                st.slider(
                    "Level uncertainty (sd)",
                    0.0,
                    0.8,
                    0.45,
                    step=0.05,
                    help="Per-season level spread -- breakouts and declines. "
                    "0.45 is the calibrated setting; 0 turns it off.",
                )
            )
            level_mean = float(
                st.slider(
                    "Level mean",
                    0.7,
                    1.0,
                    0.90,
                    step=0.02,
                    help="Multiplier mean; <1 de-biases projections down (0.90 calibrated).",
                )
            )
            samples = int(st.slider("Samples per player", 100, 5000, 1000, step=100))
            lookback = int(st.slider("Lookback seasons", 1, 5, 3))
            decay = float(st.slider("Recency decay", 0.0, 2.0, 0.5, step=0.1))
            expected_games = float(st.slider("Expected games", 8.0, 17.0, 17.0, step=0.5))
            seed = int(st.number_input("Seed", value=0, step=1))

    # Load the league config up front so a bad path shows a friendly message
    # instead of white-screening the whole app.
    try:
        league = load_league(league_path)
    except Exception as e:  # noqa: BLE001
        st.error(f"Couldn't load league config `{league_path}`: {e}")
        st.stop()

    st.caption(
        f"Season {season} · {league.name} scoring · {generator} generator · "
        f"{samples:,} sims/player · lookback {lookback}"
    )
    with st.expander("What do these numbers mean?"):
        st.markdown(
            "- **Proj Pts** — mean projected fantasy points for the season.\n"
            "- **VOR** — value over replacement: points above a freely-available "
            "player at the same position. The right way to compare across positions.\n"
            "- **Tier** — players grouped by natural scoring gaps; tier 1 is the top "
            "group at a position. When a tier is about to empty, grab from it.\n"
            "- **Floor / Ceiling** — 5th / 95th-percentile outcomes across the "
            "simulations. A wide gap means boom-or-bust.\n"
            "- **Risk** — that gap as a quick badge: 🟢 Safe, 🟡 Solid, 🔴 Volatile.\n"
            "- **Outcomes** — each player's full simulated-points distribution, on a "
            "shared scale so you can compare shapes (where the mass sits, and the skew)."
        )

    db_path = str(args.db)
    raw_dir = str(args.raw_dir)

    history_pad = 0 if generator == "bootstrap" else 2
    seasons = tuple(range(season - (lookback + history_pad), season))
    weekly = _load_weekly(seasons, db_path, raw_dir)
    if weekly.empty:
        st.error(
            f"No weekly history found for seasons {list(seasons)}. "
            "Run `ffa ingest` to populate the warehouse, or pick a season "
            "your data covers."
        )
        return

    samples_df = _simulate(
        weekly, season, generator, samples, lookback, decay, expected_games,
        games_model, level_sd, level_mean, seed,
    )
    if samples_df.empty:
        st.error("Simulation produced no samples. Try a different season or generator.")
        return

    summary = summarize_seasons(samples_df, league)
    ranked = compute_vor(summary, league.roster)
    ranked = assign_tiers(ranked, n_tiers=5)

    tab_board, tab_player, tab_optimize, tab_draft = st.tabs(
        ["Ranked board", "Player distribution", "Lineup optimizer", "Draft sim"]
    )

    # ----- Ranked board -----
    with tab_board:
        positions: Iterable[str] = sorted(ranked["position"].dropna().unique().tolist())
        chosen_positions = st.multiselect("Position filter", positions, default=positions)
        df = ranked[ranked["position"].isin(chosen_positions)] if chosen_positions else ranked
        df = df.sort_values("vor", ascending=False).head(200).copy()

        # Risk read + per-player outcome distribution, inline on the board.
        df["risk"] = [
            risk_badge(r.q05, r.q50, r.q95)
            if {"q05", "q50", "q95"} <= set(df.columns)
            else "—"
            for r in df.itertuples()
        ]
        sparks = outcome_sparklines(samples_df, league, df["player_id"].tolist())
        df["outcomes"] = df["player_id"].map(sparks)

        show_cols = [
            c
            for c in (
                "player_display_name",
                "position",
                "recent_team",
                "tier",
                "points_mean",
                "vor",
                "risk",
                "q05",
                "q95",
                "outcomes",
            )
            if c in df.columns
        ]
        column_config = _ranked_column_config() | {
            "risk": st.column_config.TextColumn(
                "Risk", help="Boom-or-bust read from the floor-to-ceiling spread."
            ),
            "outcomes": st.column_config.BarChartColumn(
                "Outcomes",
                help="Distribution of simulated season points (same scale across rows).",
                y_min=0,
            ),
        }
        st.dataframe(
            df[show_cols],
            use_container_width=True,
            hide_index=True,
            column_config=column_config,
        )

    # ----- Player distribution -----
    with tab_player:
        name_col = "player_display_name" if "player_display_name" in samples_df.columns else "player_id"
        player_options = (
            ranked.sort_values("vor", ascending=False)[name_col].dropna().unique().tolist()
        )
        if not player_options:
            st.info("No players to show.")
        else:
            selected = st.selectbox("Player", player_options)
            candidates = ranked.loc[ranked[name_col] == selected]
            if not candidates.empty:
                row = candidates.iloc[0]
                player_id = row["player_id"]
                context = " · ".join(
                    str(row[c]) for c in ("position", "recent_team") if c in row and pd.notna(row[c])
                )
                if context:
                    st.caption(f"{selected} — {context}")
                player_samples = samples_df[samples_df["player_id"] == player_id].copy()
                if player_samples.empty:
                    st.info("No simulated samples for this player.")
                else:
                    player_samples["fantasy_points"] = score_player_weeks(player_samples, league)
                    pts = player_samples["fantasy_points"]
                    q05, q50, q95 = pts.quantile([0.05, 0.5, 0.95])
                    c1, c2, c3 = st.columns(3)
                    c1.metric("Floor (q05)", f"{q05:.1f}")
                    c2.metric("Median (q50)", f"{q50:.1f}")
                    c3.metric("Ceiling (q95)", f"{q95:.1f}")
                    st.altair_chart(
                        distribution_chart(pts, q05, q50, q95), use_container_width=True
                    )

    # ----- Lineup optimizer -----
    with tab_optimize:
        st.write(
            "Maximize total VOR under your league's roster slots. For auction "
            "leagues, upload a costs CSV (`player_id,cost`) and set a budget."
        )
        col1, col2 = st.columns([1, 2])
        with col1:
            budget = st.number_input("Budget (0 = no cap)", value=0.0, step=1.0, min_value=0.0)
        with col2:
            costs_file = st.file_uploader("Costs CSV (player_id, cost)", type=["csv"])

        try:
            if budget > 0 and costs_file is not None:
                costs_df = pd.read_csv(costs_file)
                costs = costs_df.set_index("player_id")["cost"]
                lineup = optimize_lineup(ranked, league.roster, costs=costs, budget=budget)
            elif budget > 0 and costs_file is None:
                st.info("Upload a costs CSV to optimize under a budget.")
                lineup = optimize_lineup(ranked, league.roster)
            else:
                lineup = optimize_lineup(ranked, league.roster)
        except Exception as e:  # noqa: BLE001
            st.error(f"Optimizer error: {e}")
            lineup = pd.DataFrame()

        if not lineup.empty:
            cols = [
                c
                for c in ("slot", "player_display_name", "position", "recent_team", "points_mean", "vor")
                if c in lineup.columns
            ]
            st.dataframe(
                lineup[cols],
                use_container_width=True,
                hide_index=True,
                column_config=_ranked_column_config() | {"slot": st.column_config.TextColumn("Slot")},
            )
            if "points_mean" in lineup.columns:
                st.metric("Projected starting points", f"{lineup['points_mean'].sum():.1f}")

    # ----- Draft sim -----
    with tab_draft:
        c1, c2 = st.columns(2)
        with c1:
            user_slot = int(st.number_input("Your draft slot", value=1, min_value=1, step=1))
            n_sims = int(st.slider("Number of sims", 50, 2000, 300, step=50))
        with c2:
            opponent_noise = float(st.slider("Opponent ADP noise", 0.05, 0.6, 0.25, step=0.05))

        try:
            result = simulate_draft(
                ranked,
                league.roster,
                user_slot=user_slot,
                n_sims=n_sims,
                opponent_noise=opponent_noise,
                seed=seed,
            )
        except Exception as e:  # noqa: BLE001
            st.error(f"Draft sim error: {e}")
            result = None

        if result is not None:
            st.subheader("Who you tend to land")
            st.caption("Across all simulated drafts from your slot.")
            picks = summarize_user_picks(result.user_picks, top=40)
            st.dataframe(picks, use_container_width=True, hide_index=True)

            st.subheader("Availability at each of your picks")
            st.caption(
                "Probability (%) a player is still on the board when your pick "
                "comes up in each round. The planning view for two picks ahead."
            )
            avail = availability_view(result.availability, ranked, top=40)
            round_cols = [c for c in avail.columns if c.startswith("round_")]
            avail_cfg = {
                "player_display_name": st.column_config.TextColumn("Player"),
                "position": st.column_config.TextColumn("Pos"),
            }
            for rc in round_cols:
                n = rc.replace("round_", "")
                avail_cfg[rc] = st.column_config.NumberColumn(f"R{n} %", format="%.0f")
            st.dataframe(
                avail, use_container_width=True, hide_index=True, column_config=avail_cfg
            )


if __name__ == "__main__":
    main()
