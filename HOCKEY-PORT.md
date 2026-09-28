# Hockey intelligence port (Rinkside → hub)

Plan for bringing Rinkside's hockey projections, lineup data, and decision tools
into the Strictly Jayers hub for `hockey-main` (ESPN `1023106173`). Rinkside is
a working single-user Streamlit app; its source is the reference implementation
for everything below (see [Reference map](#reference-map)).

This **replaces "projection-free" in the HUB.md hockey scope**. It does not
touch `src/ffa` (NFL stays NFL); hockey gets its own package.

## Ground rules (same as the rest of the hub)

- **Sync-time artifacts only.** Every external source (NHL API, Daily Faceoff,
  ESPN ownership, Yahoo) is read by the sync job and written as JSON under the
  store. Next.js never calls an outside service from a request.
- **No invented stats.** Values are labeled estimates with provenance. Every
  player value ships with its input breakdown; missing data is `null`, never 0.
- **Scoring from the league, not code.** Read ESPN `scoringSettings.scoringItems`
  at sync; keep a YAML override in `configs/` for testing and sandboxing.
- **Fixtures + tests per phase.** Python unit tests on synthetic frames (offline),
  Vitest for view logic, one Playwright smoke per new tab. `sj validate-fixtures`
  stays green.
- **Docs travel with code.** Each phase updates HUB.md (hockey scope), ROADMAP.md,
  and AGENTS.md.

## Architecture

```
src/nhl/                     New package (not src/ffa)
  nhl_api.py                 NHL public API: rosters, bios, TOI, goalie starts,
                             team stats, schedules, player landing pages
  dfo.py                     Daily Faceoff: lines, PP units, goalies, injuries
  match.py                   ESPN ↔ NHL player map (name + position + team)
  scoring.py                 League scoring from ESPN settings; score stat lines
  value.py                   Per-game value model + breakdown
  aging.py                   Position aging curves
  prospects.py               NHL-equivalency translations + draft prior
  durability.py              Expected games played
  goalies.py                 Goalie start expected-FP model
  decisions.py               Start/sit, streaming, add/drop, move evaluation
  export.py                  Writes the artifacts below
```

Artifacts, per league-season (`{SJ_DATA_DIR}/{league}/{season}/nhl/` — a side
concern beside baseball's `analysis/`, not in `manifest.files`, no index upsert):

| file                            | written by | contents                                              |
| ------------------------------- | ---------- | ----------------------------------------------------- |
| `player_map.json`               | H1         | ESPN id → NHL id, match method, coverage stats         |
| `nhl_context.json`              | H1         | age, ht/wt, team, prior team, TOI (EV/PP), start share |
| `schedule.json`                 | H1         | team schedules, back-to-backs                          |
| `team_strength.json`            | H1         | GF/GA/SF/SA per game, PK%, blended with last season    |
| `values.json`                   | H2–H3      | value, breakdown, durability, ROS projection per player|
| `lines.json`                    | H4         | lines, pairs, PP1/PP2, linemates, source date          |
| `starting_goalies/{date}.json`  | H4         | Confirmed / Likely / Unconfirmed per game              |
| `injury_log.json`               | H6         | status history (ESPN + DFO), transitions               |
| `ownership.json`                | H7         | ESPN and Yahoo % rostered + recent change              |

## Phases

### H0: prerequisites — LANDED

- Add the 2027 season (2026–27) for `hockey-main` in `configs/leagues.yaml`.
- Scoring for SJ Hockey (season points): G 2, A 1, PPG +1, PPA +0.5, SHG +1,
  SHA +0.5, SHP +0.5, GWG 1, HAT 2, SOG 0.5, HIT 0.1, BLK 0.5; W 4, L −2, GA −2,
  SV 0.35, SO 3. Lineup 9 F / 5 D / 1 UTIL / 2 G, 7 BE, 3 IR. GP caps F 855,
  D 475, UTIL 95, G 164. Read these from ESPN at sync; the list is for test
  fixtures.

**Landed as:** 2027 is `current_season`. Sync stashes ESPN `rosterSettings`
(`attach_hockey_roster_settings`) so `settings.position_slot_counts` and
`lineup_slot_stat_limits` (`GP`) come from the league; scoring was already
synced into `settings.categories`. `configs/hockey_scoring.yaml` holds the list
above; `nhl.scoring` (`league_scoring`, `resolve_scoring`, `score_line`) reads
ESPN first and uses the YAML only as an override. The fixture league is built
from the YAML and, like the real league, is Season Points
(`TOTAL_SEASON_POINTS`): total points for the whole regular season, no weekly
matchups, standings by cumulative points.

### H1: NHL data layer + player map — LANDED

- Bulk tables from `api.nhle.com/stats` (skater summary, realtime, timeonice;
  goalie summary; team summary) for the current and prior three seasons;
  `api-web.nhle.com` rosters (age, height, weight), standings, schedules,
  player landing pages (career, draft, minor/college/junior seasons).
- Player map: normalized full name + position group, then first-initial + last
  name; ties broken by ESPN team. Fallback: NHL player search (active, then
  inactive). Report coverage like `export-player-map` (target 98%+).
- **UI:** roster and free-agent tables gain Age, Ht, Wt, Team, EV min, PP min.

**Landed as:** `src/nhl/` — `nhl_api.py` (urllib, parsers split from fetch),
`teams.py` (explicit ESPN → NHL code table instead of Rinkside's fuzzy team
words), `match.py`, `export.py`, `scoring.py`, `sample.py` (synthetic NHL for
fixtures/seed). `sj sync` runs it for the current hockey season
(`SJ_NHL_SYNC=0` to skip; failures never fail the ESPN sync); `sj nhl
[--fail-below 0.98]` rebuilds from the stored snapshot. Notes:

- The first-initial fallback is stricter than Rinkside's: it also needs a
  compatible first name (Mitch/Mitchell, J.T./JT) or the ESPN team to agree
  (Mike/Michael). Same initial alone let an off-roster "Patrick Rogers" match
  "Peter Rogers" (and would pair brothers like Jared/Jordan Staal).
- Player landing pages are fetched only for players with no NHL line in the
  fetched seasons (rookies/prospects) and search-only matches, capped by
  `SJ_NHL_LANDING_MAX`. Search is capped by `SJ_NHL_SEARCH_MAX`.
- Team strength uses the stats-API team summary (current + prior season) rather
  than `standings/now`, which reports last season's final table in preseason.
- TOI uses this season at 3+ GP, else last season at 10+ GP (flagged "other
  team" when he moved). `HAT` is not in the NHL season tables, so history lines
  omit it (null), never 0.
- Committed fixtures under `fixtures/sj/hockey-main/{season}/nhl/` come from
  `sj regenerate-fixtures`; a pytest checks they match the generator.

### H2: player values (fills the empty hockey projections tab)

Per-game value = weighted blend of every usable input; weights shrink with
small samples. Each input's share is exported for a breakdown view.

| input                                 | weight (recent-form slider = 0.5)          |
| ------------------------------------- | ------------------------------------------ |
| L7 / L15 / L30                        | 0.10 / 0.15 / 0.15 × 0.5, scaled by games   |
| this season                           | 0.35 × min(GP/25, 1)                        |
| ESPN projection                       | 0.30                                        |
| NHL history (3 seasons, age-adjusted) | 0.30 × min(total GP/120, 1)                 |
| prospect estimate (rookies)           | 0.15                                        |
| role estimate                         | only when nothing else exists (flagged)     |

Rules learned the hard way in Rinkside:

- **ESPN often leaves projected `appliedTotal` at 0 while the projected stat
  line is filled.** Score the stat line under league rules instead of treating
  the projection as 0.
- Zero projections and zero past seasons are data gaps, not forecasts. Current
  season zeros are real.
- History uses decay 1.0 / 0.6 / 0.35 by season and is carried to current age on
  the aging curve (forwards peak ~25–27, D ~27–28, goalies ~27–30; −1% to −10%
  per year after 28–29).
- Prospects: NHLe factors (AHL .39, KHL .77, SHL .57, NCAA .19, OHL/WHL .14 …),
  multiplied for age at the time (17 → ×1.8, 18 → ×1.5, 19 → ×1.25), then
  regressed toward a draft-slot prior (#1–3: 2.3 FP/G, keep 80%; #4–10: 1.7;
  1st round: 1.35; else ~1.1–1.2, keep 70%).
- Role adjustment multiplies the base: line/pair, PP unit (PP1 +10%), ice-time
  trend in-season and season-over-season, linemate quality. Capped ±25%.

**UI:** hockey `projections` tab: value, ROS projection, ESPN's own projection
beside it, data-source color (this season / history / rookie / rookie playing /
role estimate), and an expandable breakdown per player.

**H2b (strongly recommended): backtest it.** The weights above are informed
judgment, never measured. Port the `ffa backtest` pattern: project each past
season from strictly prior data and report MAE, Spearman, and bias by position
and tier. Tune the weights from that.

### H3: durability

Expected share of remaining games = blend of ESPN projected GP (weight 1.5) and
the last three seasons' GP rate (weights 1 / 0.6 / 0.35, pulled 40% toward 90%).
Clamp 50–100%. Rookies default 90%. Iron man = 95%+. Goalies use start share.
ROS points = value × remaining games × durability.

Later: port the `ffa.games` empirical GamesModel, which is the better
(backtested) version of the same idea.

### H4: Daily Faceoff lineups + starting goalies

- Team pages (`/teams/{slug}/line-combinations`): forward lines, D pairs, PP1
  and PP2, goalies, injuries. Parse the embedded `__NEXT_DATA__` JSON first,
  visible sections second. PP units override the ice-time estimate.
- Starting goalies (`/starting-goalies/{date}`), today through +2 days.
- A player on the team's NHL roster but absent from a full DFO lineup
  (15+ matched players) is a possible scratch for the next game only.
- **Scheduling:** goalie confirmations land late afternoon. The daily 6:00 sync
  is too early for them, so add a light hockey-only job (e.g. 15:00 and 17:30
  Central) that refreshes lines + goalies only. Be polite: 32 team pages at
  most every few hours, one goalie page per date.
- **UI:** Role and PP columns (PP links to the team's DFO page), Linemates.

### H5: decision tools (hockey `tools` tab)

1. **Waiver board:** value, "Upgrade vs your worst" (by F / D / G, skipping
   protected players), Replaces, week projection, durability, filters (position,
   healthy, PP only, rookies, 6'3"+, iron men).
2. **Compare free agents:** 2–4 side by side, best-in-row highlight, verdict
   (best value vs best next-14-days).
3. **Evaluate a move:** drop X / add Y with value, next-14-day and ROS deltas,
   durability, warnings (goalie max 4, protected player, injured add, nearing
   return).
4. **Weakest to best:** per-position ranking chart.
5. **Start/sit (daily):** fill active slots by availability-adjusted value ×
   that day's matchup; 0 if no game or the other goalie is confirmed.
6. **Goalie start model:** expected FP from win probability (Pythagorean split
   of expected goals), expected saves (opponent shots × own shot suppression),
   goals against, shutout chance, under league scoring. Back-to-back = ×0.6
   only when no starter is announced.
7. **Streaming planner:** per day, open F / D / UTIL / G slots, and free agents
   whose games fill them.
8. **GP cap pacing:** games used per slot vs pace. The baseball Analysis sync
   already walks `mRoster` per scoring period; the same walk can count games
   used per lineup slot, so members don't enter it by hand.

Per-member tools need the member → franchise link already in `hub_members.json`.

### H6: monitoring + alerts

- `injury_log.json`: ESPN and DFO statuses per sync; transitions newly hurt,
  nearing return (out → day-to-day), back.
- Alerts: injured starter in lineup, healthy player on IR, goalie in lineup
  not starting (confirmed/likely), announced starter on the bench, ESPN vs DFO
  injury disagreement, projected scratch in lineup.
- Hook into the existing feed / Discord digest.
- Status links to ESPN player news (`espn.com/nhl/player/news/_/id/{espnId}`).

### H7: market signals

- ESPN: `kona_player_info` with `x-fantasy-filter` `filterIds` **and**
  `scoringPeriodId` (without it ESPN returns 400); `ownership.percentOwned` /
  `percentChange`.
- Yahoo (optional): OAuth app with Fantasy Sports Read; no Yahoo league
  required. `game/nhl` → `game/{key}/players;start;count=25` → `players;
  player_keys=…/percent_owned`. Hosted: one owner's refresh token in Secret
  Manager. Rinkside hit a 403 on the collection-with-`out=percent_owned` call;
  the three-step sequence is the fix but is unverified against live Yahoo.
- Drop protection: average of available sources ≥ threshold (default 85%).

### H8: personal layer

Per-member tags (PP1 / PP2 / No PP / Top 6 / Bottom 6 / Top 4 D / Bottom pair /
Starting goalie / Backup goalie / Watch / Keep), note, Never drop list. Tags
override automatic roles in the value model. Store per member (e.g.
`member_prefs/{email}.json` in the hub store). Visual flags: data-source cell
color, 6'3"+ bold magenta name, 🦾 iron man.

## Reference map

| Rinkside                         | Target                    | notes                                  |
| -------------------------------- | ------------------------- | -------------------------------------- |
| `nhl.py` fetches, roles, schedule| `nhl_api.py`, `export.py` | `skater_roles`, `goalie_roles`, `team_ratings` |
| `nhl.py` `Matcher`               | `match.py`                | team-aware duplicate names             |
| `nhl.py` aging, prospects        | `aging.py`, `prospects.py`| `age_project`, `prospect_fpg`          |
| `dfo.py`                         | `dfo.py`                  | as is                                  |
| `recommend.py` `value_parts`, `evaluate`, `adjust` | `value.py` |                                  |
| `recommend.py` `games_rate`      | `durability.py`           |                                        |
| `recommend.py` `goalie_game_fp`, `game_factor` | `goalies.py` |                                        |
| `recommend.py` lineup, add/drop, streaming | `decisions.py`  |                                        |
| `scoring.py`                     | `scoring.py` + configs    | replace constants with ESPN settings   |
| `tracking.py`                    | H6 / H8 storage           | injury log, tags                       |
| `yahoo.py`                       | H7                        |                                        |
| `app.py`                         | Next.js tabs              | UI reference only                      |

## Open questions

- Daily Faceoff: confirm they're fine with a few scheduled reads a day, or
  source lines another way.
- Should hockey tools be member-only (franchise link required) or visible to
  everyone for every team?
- Backtest before or after shipping the projections tab?
- ~~Is SJ Hockey `TOTAL_SEASON_POINTS` or `H2H_POINTS` on ESPN?~~ Resolved:
  Season Points — total points for the regular season, no weekly matchups.
  H5's start/sit and streaming tools should optimize season totals under the
  GP caps, not a weekly opponent.
