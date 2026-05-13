"""Streamlit dashboard for the ffa pipeline.

Launch via the CLI:

    ffa dashboard --league configs/ppr.yaml --season 2025

or directly:

    streamlit run src/ffa/dashboard.py -- --league configs/ppr.yaml --season 2025

Sections:
    - Sidebar: league config, season, generator, sample count.
    - Ranked board: VOR + tier + 5/95 quantiles, filterable by position.
    - Per-player distribution: histogram of simulated season points.
    - Lineup optimizer: best lineup under the configured roster.
    - Draft sim: pick-rate table from your draft slot.

The dashboard is a thin presentation layer over the pure-Python API in
:mod:`ffa`. It intentionally avoids re-implementing analysis logic --
that all lives in the library so the CLI and dashboard share behavior.
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Iterable

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


def _parse_args() -> argparse.Namespace:
    """Streamlit passes everything after `--` to sys.argv; parse defaults."""
    p = argparse.ArgumentParser(allow_abbrev=False)
    p.add_argument("--league", type=Path, default=Path("configs/ppr.yaml"))
    p.add_argument("--season", type=int, default=2025)
    p.add_argument("--db", type=Path, default=Path("data/ffa.duckdb"))
    p.add_argument("--raw-dir", type=Path, default=Path("data/raw"))
    args, _ = p.parse_known_args()
    return args


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
        seed=seed,
    )


def _score_summary(samples_df: pd.DataFrame, league_path: Path) -> tuple[object, pd.DataFrame]:
    league = load_league(league_path)
    summary = summarize_seasons(samples_df, league)
    return league, summary


def main() -> None:
    args = _parse_args()
    st.set_page_config(page_title="ffa", layout="wide")
    st.title("Fantasy Football Analytics")
    st.caption("Posterior-driven projections, rankings, and draft tooling.")

    # ---------------- Sidebar ----------------
    with st.sidebar:
        st.header("Inputs")
        league_path = Path(
            st.text_input("League config (YAML)", value=str(args.league))
        )
        season = int(st.number_input("Target season", value=args.season, step=1))
        lookback = int(st.slider("Lookback seasons", 1, 5, 3))
        generator = st.selectbox(
            "Generator",
            options=list(_GENERATORS),
            help="bootstrap=phase 3, learned=phase 5, quantile=phase 6 (calibrated tails).",
        )
        samples = int(st.slider("Samples per player", 100, 5000, 1000, step=100))
        decay = float(st.slider("Recency decay", 0.0, 2.0, 0.5, step=0.1))
        expected_games = float(st.slider("Expected games", 8.0, 17.0, 17.0, step=0.5))
        seed = int(st.number_input("Seed", value=0, step=1))

    db_path = str(args.db)
    raw_dir = str(args.raw_dir)

    history_pad = 0 if generator == "bootstrap" else 2
    seasons = tuple(range(season - (lookback + history_pad), season))
    weekly = _load_weekly(seasons, db_path, raw_dir)
    if weekly.empty:
        st.error(
            f"No weekly history found for seasons {list(seasons)}. "
            "Run `ffa ingest` to populate the warehouse."
        )
        return

    samples_df = _simulate(
        weekly, season, generator, samples, lookback, decay, expected_games, seed
    )
    if samples_df.empty:
        st.error("Simulation produced no samples (try lowering min_history_games?).")
        return

    league, summary = _score_summary(samples_df, league_path)
    ranked = compute_vor(summary, league.roster)
    ranked = assign_tiers(ranked, n_tiers=5)

    # ---------------- Tabs ----------------
    tab_board, tab_player, tab_optimize, tab_draft = st.tabs(
        ["Ranked board", "Player distribution", "Lineup optimizer", "Draft sim"]
    )

    # ----- Ranked board -----
    with tab_board:
        positions: Iterable[str] = sorted(ranked["position"].dropna().unique().tolist())
        chosen_positions = st.multiselect("Position filter", positions, default=positions)
        df = ranked[ranked["position"].isin(chosen_positions)] if chosen_positions else ranked
        df = df.sort_values("vor", ascending=False).head(200)
        show_cols = [
            c
            for c in (
                "player_display_name",
                "position",
                "recent_team",
                "tier",
                "points_mean",
                "vor",
                "q05",
                "q50",
                "q95",
            )
            if c in df.columns
        ]
        st.dataframe(df[show_cols].round(1), use_container_width=True, hide_index=True)

    # ----- Player distribution -----
    with tab_player:
        name_col = "player_display_name" if "player_display_name" in samples_df.columns else "player_id"
        player_options = (
            ranked.sort_values("vor", ascending=False)[name_col].dropna().unique().tolist()
        )
        selected = st.selectbox("Player", player_options)
        # Resolve back to player_id since IDs are unique while display names may not be.
        candidates = ranked.loc[ranked[name_col] == selected]
        if not candidates.empty:
            player_id = candidates.iloc[0]["player_id"]
            player_samples = samples_df[samples_df["player_id"] == player_id].copy()
            player_samples["fantasy_points"] = score_player_weeks(player_samples, league)
            qs = (
                player_samples["fantasy_points"]
                .quantile([0.05, 0.5, 0.95])
                .rename({0.05: "q05", 0.5: "q50", 0.95: "q95"})
            )
            c1, c2, c3 = st.columns(3)
            c1.metric("Floor (q05)", f"{qs['q05']:.1f}")
            c2.metric("Median (q50)", f"{qs['q50']:.1f}")
            c3.metric("Ceiling (q95)", f"{qs['q95']:.1f}")
            st.bar_chart(
                pd.cut(player_samples["fantasy_points"], bins=40)
                .value_counts()
                .sort_index()
                .rename_axis("bin")
                .reset_index(name="count"),
                x="bin",
                y="count",
            )

    # ----- Lineup optimizer -----
    with tab_optimize:
        st.write(
            "Maximize total VOR under the roster slots in your league YAML. "
            "Add costs and a budget for auction leagues."
        )
        col1, col2 = st.columns([1, 2])
        with col1:
            budget = st.number_input("Budget (optional)", value=0.0, step=1.0)
        with col2:
            costs_csv = st.text_input(
                "Costs CSV (player_id,cost; required if budget > 0)", value=""
            )

        try:
            if budget > 0 and costs_csv:
                costs_df = pd.read_csv(costs_csv)
                costs = costs_df.set_index("player_id")["cost"]
                lineup = optimize_lineup(ranked, league.roster, costs=costs, budget=budget)
            else:
                lineup = optimize_lineup(ranked, league.roster)
        except Exception as e:  # noqa: BLE001
            st.error(f"Optimizer error: {e}")
            lineup = pd.DataFrame()

        if not lineup.empty:
            cols = [
                c
                for c in (
                    "slot",
                    "player_display_name",
                    "position",
                    "recent_team",
                    "points_mean",
                    "vor",
                )
                if c in lineup.columns
            ]
            st.dataframe(lineup[cols].round(1), use_container_width=True, hide_index=True)

    # ----- Draft sim -----
    with tab_draft:
        c1, c2 = st.columns(2)
        with c1:
            user_slot = int(st.number_input("Your draft slot", value=1, min_value=1, step=1))
            n_sims = int(st.slider("Number of sims", 50, 2000, 300, step=50))
        with c2:
            opponent_noise = float(
                st.slider("Opponent ADP noise", 0.05, 0.6, 0.25, step=0.05)
            )

        try:
            result = simulate_draft(
                ranked,
                league.roster,
                user_slot=user_slot,
                n_sims=n_sims,
                opponent_noise=opponent_noise,
                seed=seed,
            )
            summary_picks = summarize_user_picks(result.user_picks, top=40)
            st.dataframe(summary_picks.round(2), use_container_width=True, hide_index=True)
        except Exception as e:  # noqa: BLE001
            st.error(f"Draft sim error: {e}")


if __name__ == "__main__":
    main()
