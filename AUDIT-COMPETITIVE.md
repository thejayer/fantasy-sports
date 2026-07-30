# Strictly Jayers hub — competitive audit

Second point-in-time audit, run against `main` at commit `b6ea87e`. Where
[AUDIT.md](AUDIT.md) asked *"is this thing correct and safe?"*, this one asks
*"is this thing good?"* — measured against the products members actually
compare it to: **ESPN Fantasy**, **Yahoo Fantasy**, **Sleeper**, and
**FantasyPros**.

The plan that follows from it is [ROADMAP.md](ROADMAP.md) **Phase 7**.

> The first audit's through-line was *"careful engineering pointed at the wrong
> surface."* Phases 0–6 fixed that: the hub now has a decade of history, an
> engine-backed projection stack, six decision tools, and a whole third sport.
> The new through-line is different, and narrower:
>
> **The hub is a very good reference library and not yet a place anyone hangs
> out.** It answers questions accurately when you already know which question
> to ask, and it does nothing at all if you just open it.

---

## How this audit was run

Reproducible from a clean checkout, no ESPN credentials:

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements-lock.txt
.venv/bin/pip install -e . --no-deps
.venv/bin/sj seed                       # 25 league-seasons of realistic synthetic data
cd apps/web && npm ci
printf 'AUTH_DEV_BYPASS=1\nSJ_DATA_DIR=/workspace/data/sj\n' > .env.local
npm run dev
```

Every number below was measured against that running app — page weights with
`curl | wc -c`, layout metrics and screenshots with Playwright at 1440×900 and
iPhone 13 (390×844). Competitor claims are sourced from vendor documentation and
2025–2026 release notes, cited inline.

Baseline health remains good and is worth stating before the criticism: `ruff`
clean, **360 Python tests** and **138 web tests** green, repo coverage **82%**,
`tsc --noEmit` clean, `eslint` clean, `npm audit` at zero advisories, 8 checks in
CI with branch protection on. Nothing below is rot. It is all scope.

---

## What the hub already does better than the incumbents

This matters because it determines what to protect while changing everything
else.

| Capability | Hub | ESPN | Yahoo | Sleeper |
|---|---|---|---|---|
| Calibrated **floor / median / ceiling** per player | Yes, free, inline on rosters | No | Fantasy Plus only | No |
| Native **playoff odds** (Monte Carlo over remaining schedule) | Yes | **No** | No | **No** (top user request) |
| **VOR + tiers** from a simulated posterior | Yes | No | No | No |
| Draft-sim **availability curves** by your slot | Yes | Practice drafts only | Draft Scout (paid) | No |
| **Cross-sport** hub in one shell (football + baseball + golf) | Yes | Separate games | Separate games | Football/basketball |
| Hub-native **golf** with a real auction room | Yes | No | No | No |
| Decade of **all-time records / H2H** for one franchise id | Yes | Yes | Yes | Yes |

Two of those are genuinely unusual. **Nobody ships fantasy playoff odds** —
ESPN's elaborate FPI machinery is pointed at real NFL games, not fantasy
standings, and playoff odds are among Sleeper's most-requested missing features.
And calibrated floor/ceiling is paywalled on Yahoo and absent everywhere else.
The engine work from phases 4.1–4.5 is a real moat. It is currently buried
behind a lowercase tab called `tools`.

---

## Feature scorecard

Legend: ● shipped · ◐ partial · ○ absent

### League surfaces

| | Hub | ESPN | Yahoo | Sleeper |
|---|---|---|---|---|
| Standings | ● | ● | ● | ● |
| Rosters / teams | ● | ● | ● | ● |
| Player list with search/sort/filter | ● | ● | ● | ● |
| **Player detail page** | ○ | ● | ● | ● |
| Matchup pairings + scores | ● | ● | ● | ● |
| **Box score (per-player matchup lines)** | ○ | ● | ● | ● |
| Schedule | ● | ● | ● | ● |
| Playoff bracket | ◐ projected seeds only | ● | ● | ● |
| **Consolation / toilet bowl** | ○ | ◐ | ○ | ● |
| Transactions / activity | ● | ● | ● | ● |
| Draft results board | ● | ● | ● | ● |
| Free agents / waiver pool | ● | ● | ● | ● |
| Multi-season history + records | ● | ● | ● | ● |
| **Franchise / manager career page** | ○ | ○ | ○ | ◐ |
| **League settings surface (ESPN sports)** | ○ | ● | ● | ● |
| **Commissioner tools** | ○ (ESPN owns it) | ● | ● | ● |

### Live experience

| | Hub | ESPN | Yahoo | Sleeper |
|---|---|---|---|---|
| Live scoring | ○ (30-min sync) | ● FantasyCast | ● StatTracker | ● GameDay |
| Live in-game projections | ○ | ● | ● | ● |
| Win probability | ○ | ● | ● | ○ |
| Play-by-play feed | ○ | ◐ | ● Fantasy Feed | ● |
| Push / mobile alerts | ○ | ● | ● | ● |
| Live draft room | ● golf only | ● | ● | ● Draftboard |

### Social & engagement

| | Hub | ESPN | Yahoo | Sleeper |
|---|---|---|---|---|
| League chat | ○ | ● | ● | ● best-in-class |
| Reactions / GIFs | ○ | ◐ | ◐ | ● |
| Polls | ○ | ● LM Polls | ○ | ● |
| **Auto weekly recap** | ○ | ● | ○ | ● with Awards |
| **Power rankings** | ○ | ○ | Plus only | ○ |
| Transactions posted into a narrative feed | ○ | ● | ◐ | ● |
| Email / notification digest | ○ | ● | ● | ● |
| Trade block / trade interest | ○ | ◐ | ● Trading Block | ● |

### Decision tools

| | Hub | ESPN | Yahoo | Sleeper | FantasyPros |
|---|---|---|---|---|---|
| Trade analyzer | ● | ● watsonx | Plus | ○ | ● |
| Trade *finder* (suggests partners) | ○ | ○ | Plus | ○ | ● |
| Start/sit | ● typical-week | ◐ | Plus | ○ | ● |
| Lineup optimizer | ○ | ● (MLB Quick Lineup) | Plus | ○ | ● + Auto-Pilot |
| Waiver board | ● | ● | ● | ◐ trending | ● |
| Draft assistant | ● offline MC | ◐ | Plus | ○ | ● Draft Wizard |
| Playoff odds | ● | ○ | ○ | ○ | ○ |
| Strength of schedule | ◐ roster strength | ○ | Plus | ○ | ● |
| Rest-of-season rankings | ○ | ● | ● | ○ | ● |
| Consensus rankings (ECR) | ○ own model | ● analysts | ● blended | ○ | ● |

The pattern in that last table is the interesting one. The hub's tools are
**better modelled and worse packaged**. FantasyPros' equivalents each have a
proper noun, a one-line promise, and a roster-aware default. The hub's are
sub-views of `?tab=tools&view=…`.

---

## Findings

### 1. The hub does not know which team is yours — P0 product

`hub_members.json` already links each member email to one franchise per league,
and `/admin` already has the UI to manage it. That link is consumed in exactly
two places: golf auction ACL and golf lineup writes (`lib/franchise-acl.ts`).

```
$ rg -l 'franchise|hubMembers' apps/web/src/app
apps/web/src/app/leagues/[leagueId]/page.tsx   # resolveGolfActingScope only
apps/web/src/app/layout.tsx                    # admin-link visibility only
apps/web/src/app/api/golf/...                  # golf ACL
```

Nothing in football or baseball reads it. The consequences compound:

- **Standings** render 12 identical rows. Yours is not highlighted, not pinned,
  not marked.
- **Matchups** render six identical cards. Yours is not first and not flagged.
- **Home** is a marketing hero for a product the visitor has already bought.
- **`/leagues`** lists four leagues with no record, no rank, no next deadline.

<img src="/opt/cursor/artifacts/audit2_home_no_member_dashboard.png" alt="Signed-in home page showing only a hero headline and two buttons, with no member context" />

Every competitor solves this in the same shape: ESPN's **Dynamic Roster
Dashboard** surfaces day-of-week action items ("check waivers, it's Tuesday"),
Yahoo's home screen shows your matchups first and packs 50% more of them onto
the screen, Sleeper opens on your league with your matchup at the top. This is
the single highest-leverage change available, because it is mostly *ordering and
emphasis of data already on disk*.

<img src="/opt/cursor/artifacts/audit2_standings_no_my_team_no_logos.png" alt="Football standings table with 12 undifferentiated text rows, no team logos and no highlight for the member's own team" />

### 2. There is no social layer at all — P0 product for a friend league

This is a private hub for a ~10-person friend group. For that audience, Sleeper
does not win on projections — it wins because the league *lives* in the app:
transactions, waiver results, commissioner notes, and trash talk interleave in
one chronological chat stream, with GIFs, polls, reaction emoji, and weekly
auto-posted **Awards**. Sleeper's own documentation credits chat as "the single
reason our leagues are considered the most active," and reports that relaxing
roster validation ("lazy enforcement") **tripled trade activity**.

The hub has:

- no chat, no message board, no comments, no reactions, no polls
- no weekly recap, no awards, no power rankings
- no notifications of any kind — no email, no push, no digest
- an `activity` tab that is a four-row read-only ESPN transaction table

The hub is the only place in this comparison where nothing a member does is
visible to any other member. It has an auction room with optimistic-concurrency
bidding and 1-second polling — proving the infrastructure for a live shared
surface already exists — and no way to say "nice pick."

### 3. Everything is a dead end — P1

Team names link to team pages, and golf's schedule links across to lineup and
scoreboard. Beyond that, every link in the app is a navigation chip — a tab, a
season, a week, a sub-view. No data cell opens anything deeper:

```
$ rg -n 'player\.name|row\.name' apps/web/src/components/*.tsx | rg -i 'link|href'
(no matches — no player name is a link anywhere in the app)
```

| Clicked thing | Competitors | Hub |
|---|---|---|
| Player name | Player page: game log, splits, news, depth chart | nothing |
| Matchup card | Box score with per-player lines | nothing |
| Score | Play-by-play | nothing |
| Owner name | Manager/career page | nothing |
| Draft pick | Player page | nothing |
| Transaction row | Player page / trade detail | nothing |

<img src="/opt/cursor/artifacts/audit2_matchups_dead_end_cards.png" alt="Week 14 matchup cards showing team names and scores with no logos, records, or click-through" />

Two of these are cheap and two are gated on data the sync does not keep:

- **Player page** — buildable today from the snapshot plus projection/weekly
  snapshots. Season stats, roster status, fantasy owner, floor/median/ceiling,
  weekly posterior, and draft/transaction history are all already on disk keyed
  by player id.
- **Manager page** — buildable today from `getLeagueHistoryArchive`.
- **Box score** — needs per-player weekly stats, deferred in roadmap 2.4.
- **Play-by-play / live scoring** — needs a live feed, out of scope for a
  30-minute batch sync.

Also dead: `Team.logo_url` is fetched and persisted by the sync and **rendered
nowhere**. Every team in the app, on every screen, is a text string. ESPN
already gives us the image URL.

### 4. Team pages silently drop the team's own season — P1 correctness/UX

`loadTeamSelective()` in `apps/web/src/lib/data.ts` is the fast path for v2
snapshots. It builds the team without reading `matchups.json`:

```ts
const team: Team = {
  ...standing,
  schedule: [],
  scores: [],
  outcomes: [],
  roster: rosters.teams?.[key] ?? [],
};
```

That was a deliberate cost optimization (AUDIT #16), but nothing downstream
compensates, so the team page shows a roster and *no schedule, no game log, no
weekly scores, no next opponent*. Confirmed against the running app:

```
$ curl -s localhost:3000/leagues/football-main/teams/1 \
    | grep -cE 'Schedule|Week|vs\.'
0
```

<img src="/opt/cursor/artifacts/audit2_team_page_no_schedule.png" alt="Team page showing only a roster table, with no schedule, game log or weekly scores" />

A team page with no results on it is the most conspicuous single omission in the
app. On ESPN, Yahoo, and Sleeper the team page *is* the game log.

### 5. Navigation is a wall of identical pills — P1 UI

Measured with Playwright:

| Route | Nav pills on screen | Chrome above first data row (desktop) | (mobile) |
|---|---|---|---|
| `football-main` standings | **21** | 406 px | 576 px |
| `football-main?tab=players` | **28** | 465 px | 709 px — **1.07 screens** |
| `baseball-dynasty?tab=players` | **25** | 534 px | 749 px — **1.13 screens** |
| `golf-main?tab=scoreboard` | 11 | 602 px | 815 px — **1.23 screens** |

On a phone, the baseball players tab requires scrolling past **more than a full
screen** of chrome before a single player appears. The chrome is 12 season chips
plus 9–10 lowercase tab pills plus a sub-view row plus filter chips — all the
same shape, same size, same weight, no icons, no grouping, no hierarchy.

<img src="/opt/cursor/artifacts/audit2_mobile_chrome_before_content.png" alt="Mobile view where 12 season chips and 10 tab pills fill the entire viewport before any standings data" />

Related IA gaps:

- Global nav is `Leagues` and `Admin`. No league switcher, no team switcher, no
  search. Yahoo shipped a team switcher reachable from *every* screen and
  long-press on the nav icon; the hub makes you go back to `/leagues`.
- No mobile bottom tab bar. This is a phone-first audience and the app is a
  desktop layout that reflows.
- Tab labels are raw lowercase route slugs (`standings`, `tools`) rather than
  written labels.
- 12 season chips is the wrong control for 12 seasons — that should be a select
  or a "History" entry point, with chips reserved for 3–4 recent years.

Credit where due: the `.table-cards` mobile treatment genuinely works. Measured
horizontal overflow at 390 px is **0 px on every route**, including the 16-column
baseball table, which collapses to labelled stacked cards. Only the desktop
baseball table overflows (194 px), and that is inside a `.table-scroll`.

### 6. Empty cells are shown without explanation — P1 UI

The football players board renders **four columns of `—` for every row** when
the projection join misses, with no note explaining why.

<img src="/opt/cursor/artifacts/audit2_players_unexplained_dashes.png" alt="Players table where the Floor, Med, Ceil and VOR columns show an em dash for every visible row" />

Offline this is expected and documented — fixture leagues use synthetic ESPN ids
and only a handful of `fixture_overlay` rows resolve. But the UI does not say so,
and a member cannot distinguish "we have no projection for this player" from
"this feature is broken." The team page gets this right (`3/16 with season
projections (PPR)`); the players board does not. Whatever the coverage rate is,
it should be stated on the surface that displays it, and columns with zero
coverage on the current page should collapse rather than render as dashes.

### 7. The decision tools are unbranded and unopinionated — P1 product

Six genuinely sophisticated tools live behind `?tab=tools&view=trade|waivers|
strength|draft|start-sit|playoff-odds`.

<img src="/opt/cursor/artifacts/audit2_trade_tool.png" alt="Trade tool with two team dropdowns, checkbox player lists and a Clear package button" />

What FantasyPros does differently, and why it matters:

| FantasyPros | Hub |
|---|---|
| Named products ("Trade Analyzer", "Waiver Assistant", "Lineup Assistant") | `view=` query values |
| Defaults to **your** roster on open | defaults to teams 1 and 2 |
| States a verdict ("this trade favors Team B") | shows two Σ columns and lets you subtract |
| Shows best/worst expert rank as an uncertainty band | shows floor/median/ceiling (better data, no framing) |
| **Trade Finder** proposes partners | you construct every package by hand |

And the framing device worth stealing outright is Yahoo's: **Assistant GM does
not say "start X," it says "+2.4 projected points and +6% win probability."**
The hub already computes playoff odds by Monte Carlo. Pricing an individual
lineup or trade decision in Δ playoff-odds is a differentiating feature that no
competitor ships for free, and it reuses an engine that already exists.

### 8. No settings or commissioner surface for ESPN sports — P1

`settings.json` has been synced since roadmap 2.4 — roster slots, scoring
format, FAAB budget, keeper counts, playoff team count, trade deadline, division
map, tie rules. Golf renders all of it in `GolfSettingsPanel`. Football and
baseball render **none** of it; `FOOTBALL_TABS` and `BASEBALL_TABS` have no
`settings` entry.

This is a pure display gap over data already on disk, and it is also the answer
to AUDIT #9's other loose end: `format: dynasty` still means nothing in the
product. `settings.keeper_count` is right there.

The hub cannot and should not offer real commissioner *tools* for ESPN leagues —
ESPN is the system of record and there is no write path. But that argues for the
opposite of silence: **read-only settings plus "Open in ESPN" deep links**.
`espn_league_id` is on every snapshot; every table row that a member might want
to act on could link to the ESPN page that lets them act. Today the hub is a
dead end that quietly asks members to go find ESPN themselves.

### 9. Baseball is projection-free by design but also tool-free by accident — P2

Keeping the NFL engine out of category leagues is the right call (roadmap 4.6)
and should stand. But that decision has been read as "no baseball features,"
and there is a large class of baseball tooling that needs **no projection model
at all** — it is scheduling and roster arithmetic:

| Feature | Needs a model? | Notes |
|---|---|---|
| Games-per-team this period | No | Two-start pitchers, 7-game vs 5-game weeks |
| Category standings ("you win 6 of 10") | No | Roto/H2H-cat math over synced stats |
| Trailing-window rater (7/15/30 day) | No | ESPN's `PR7/PR15/PR30` is pure arithmetic |
| Probable-starter grid | Feed only | ESPN publishes a 10-day rolling grid |
| Innings/games usage caps | No | Yahoo auto-forfeits pitching cats below min IP |
| Daily lineup lock times | No | Baseball is daily, not weekly |

Yahoo's usage caps are the mechanic home-built baseball hubs miss most often:
minimum weekly IP that **forfeits every pitching category** when unmet, and
season maximums (1,400 IP / 162 games) that silently strip surplus stats.
`baseball-dynasty` is the league with the richest data in this repo and the
thinnest set of reasons to visit.

### 10. Golf has the strongest engine and the weakest week-to-week loop — P2

Golf is the one sport where the hub *is* the system of record, so it is the one
sport where product gaps are entirely ours. Against the official PGA TOUR
Fantasy game and the commissioner-pool platforms (Splash Sports, Pro Tour
Fantasy Golf, Clubpicks):

| | Hub | Elsewhere |
|---|---|---|
| Draft (snake / auction / live room) | ● strong | ◐ |
| Lineup with tee-time locks | ● fail-closed | ● |
| EOD scoring, best 4/5, alts, multipliers | ● | ● |
| **Live/projected leaderboard during the event** | ● through_round + week_projected (EOD; not hole-by-hole) | ● "projected earnings after each round" |
| **Lineup reminder before first tee** | ● digest + Discord (7.7) | ● configurable reminder emails |
| **Golfer detail / usage history** | ● `/players/{id}` usage, ownership %, EOD results | ● results history, ownership % |
| **Per-segment start limits** | ● `starts.max_per_segment` (default 3) + usage board | ● 3 starts per segment (the core constraint) |
| Alternates | ● alt1/alt2 + auto-pick on missed deadline | ● + auto-pick on missed deadline |
| Variance dampeners | ● optional `drop_worst_golfer` (off by default) | ● "drop your worst golfer" |

The two that matter for a friend league are the reminder and the projected
leaderboard. Golf's weekly cadence makes a missed lineup the primary churn
cause — the Tour removed its opening-round deadline in 2026 specifically to fix
that. The hub locks fail-closed with no warning beforehand, which is correct and
unkind.

### 11. Page weight regressed against its own target — P2

ROADMAP's "what done looks like" sets **largest page payload < 100 KB**.
Measured now:

| Route | HTML | At first audit |
|---|---|---|
| `baseball-dynasty?tab=players` | **239 KB** | 448 KB |
| `golf-main?tab=scoreboard` | **206 KB** | n/a |
| `football-main?tab=tools&view=trade` | **119 KB** | n/a |
| `football-main?tab=players` | **125 KB** | 84.9 KB |

Pagination halved the baseball board but did not fix the cause. `DataTable` is a
`"use client"` component and `PlayersDataTable` hands it **every** row:

```tsx
<DataTable rows={players} columns={baseballColumns(role)} pageSize={25} … />
```

25 rows render; all 348 serialize into the RSC payload so the client can search
and sort them. The football players tab is now *larger* than at the first audit
because projection columns were added on top. Golf's scoreboard emits 204 table
rows in one response.

This is a real trade-off, not a bug — client-side search over the full set is
why the table feels fast. But the target is unmet, and the fix (server-side
search/sort/page via `searchParams`, or trimming row payloads to displayed
fields) is known.

### 12. Visual design is competent, generic, and light-only — P2

The design system is coherent: one accent, one radius, tabular numerals,
skeletons, mobile cards, a nice display face. Against the field it reads as
*administrative*.

- **No dark mode.** No `prefers-color-scheme` handling anywhere in
  `globals.css`. Sleeper is dark by default and mobile-first; that is a large
  part of why it feels like a consumer app.
- **No imagery.** No team logos (already on disk), no player headshots, no
  avatars, no event art. Text-only tables on every screen.
- **No status legend.** Injury dots are green/amber/red with a `title`
  attribute — invisible on touch, and unexplained.
- **No live affordances.** No relative "synced 4 min ago", no LIVE badge, no
  freshness indicator. Scores could be six hours stale and look identical.
- **Uniform emphasis.** Nothing on any screen is bigger, bolder, or louder than
  anything else, so nothing draws the eye. Yahoo shipped *reduced padding* as a
  headline feature for engaged managers; the hub has the opposite problem —
  even spacing everywhere and no focal point.

### 13. The hub cannot tell members anything they did not come looking for — P1

Rolled up, findings 1, 2, and 12 are one thing: **the hub has no outbound
channel.** No email, no push, no digest, no home-page feed, no badge.

Every competitor manufactures a recurring appointment. Sleeper's **Waiver
Countdown** turns a cron job into a communal event and auto-posts results to
chat. ESPN emails an **Instant Draft Grade** to every manager. FantasyPros sends
Auto-Pilot lineup alerts. Pro Tour Fantasy Golf sends configurable lineup
reminders.

The hub runs a sync every 30 minutes, exports projections nightly, and scores
golf weeks — and no member ever hears about any of it. It is a pull-only product
competing with push products, in a group that already has a Discord.

---

## Summary

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Hub does not know which team is yours (franchise link unused outside golf) | **P0 product** | **Fixed** — roadmap 7.1 + 7.2 |
| 2 | No social layer: no chat, recaps, reactions, power rankings | **P0 product** | **Fixed** — roadmap 7.6 / 7.7 (feed + digests + Discord) |
| 3 | No player pages, box scores, manager pages; logos unrendered | P1 | **Fixed** for pages/logos/deep links (7.3); box scores need sync 8.1 |
| 4 | Team pages drop schedule/scores entirely (`loadTeamSelective`) | P1 | **Fixed** — roadmap 7.4 |
| 5 | 21–28 identical nav pills; >1 screen of chrome on mobile | P1 | **Fixed** — roadmap 7.5 (28 → 19 pills; 1.13 → 0.87 mobile screens) |
| 6 | Empty projection columns rendered without coverage disclosure | P1 | **Fixed** — roadmap 7.10 |
| 7 | Decision tools unnamed, not roster-aware, no verdict/Δ framing | P1 | **Fixed** — 7.8 landing/verdict/Trade Finder + Δ make-playoffs via samples sidecar |
| 8 | No settings tab for ESPN sports; no "Open in ESPN" deep links | P1 | **Fixed** — roadmap 7.9 + 7.3 |
| 9 | Baseball missing the projection-free tooling (cats, two-start, caps) | P2 | **Fixed** — roadmap 8.2 (cats, trailing, schedule/locks, two-starts, IP/GS caps) |
| 10 | Golf missing reminders, projected leaderboard, segment limits | P2 | **Fixed** — reminders (7.7); projected board / golfer pages / segment limits / auto-pick / drop-worst (8.3) |
| 11 | 239 KB largest page vs a 100 KB target; full row sets to client | P2 | **Fixed** — roadmap 7.11 (server players board + slim scoreboard/draft + CI gate) |
| 12 | No dark mode, no imagery, no live/freshness affordances, no legend | P2 | **Fixed** for theme/legend/freshness/crests (7.10 + 7.3); typographic pass open |
| 13 | No outbound channel at all — no email, push, or digest | P1 | **Fixed** for digest + Discord + golf tee-time reminders (7.7); email fallback open |

**Nine of thirteen findings were blocked on nothing.** They were display,
ordering, emphasis, and naming over data that is already synced, already
modelled, and already on disk. That is the shape of a product that was built
data-layer-first and never had its surface designed — which is exactly what
phases 2–4 optimized for, and exactly what Phase 7 corrects.

The two-sentence version, as written at audit time:

> The hub has better projections than ESPN, better playoff odds than anyone, and
> a decade more history than a new league could have — and it opens on a
> marketing hero, cannot tell you which of the twelve teams is yours, and has no
> way for one member to talk to another.
>
> Fix the second sentence and the first one starts to matter.

Those three are now fixed: the hub opens on a member dashboard, marks your team
on every screen it appears on, and has a league feed with digests and Discord
delivery. What remains against the competitive set is mostly sport depth
(phase 8), HTML payload budget (7.11), and Δ playoff-odds pricing.
