# Community portal — `strictlyjayers.com`

The apex site is the **community home**. Fantasy stays on a subdomain.

Visual language is the shared **Modernist** system (`design/modernist/`) —
Archivo, Signal Red accent (`--color-accent`), 0 radius, 2px rules. Both
`apps/www` and `apps/web` vendor a copy under `src/styles/modernist.css`.
Fitness restyles the training-log PWA onto the same tokens (`FITNESS.md`).

| Host | App | Cloud Run | Role |
|---|---|---|---|
| `strictlyjayers.com` (and `www`) | `apps/www` | `sj-www` | Public community front door |
| `fantasy.strictlyjayers.com` | `apps/web` | `sj-hub` | Authenticated member hub |
| `fitness.strictlyjayers.com` | `apps/fitness` | `sj-fitness` | Local-first training log |
| `vibe.strictlyjayers.com` | `apps/vibe` | `sj-vibe` | Coded-while-lifting |

## Why two hosts

- **Auth.js cookies** for the hub stay on `fantasy.strictlyjayers.com`.
  The apex now has a **second**, scoped Auth.js install for `/bets` (and
  `/casino` when `CASINO_URL` is set) — same Google client + allowlist;
  callback host `strictlyjayers.com`. Public Community / AI / People /
  Watch / Palworld routes never require a session. Do not put a service
  worker on the apex.
- **Snapshot / hub data**: `sj-www` mounts the hub bucket **read-only** so
  `/bets` can read `hub_members.json` and `bets/{bets,parlay_legs,public_warnings,record_splits,tailing_legs,options}.json`. Home and other
  public pages do not touch that mount.
- **Product boundary**: Discord / Palworld / Watch / AI / People live on
  the apex; leagues, tools, and auction rooms live on the hub.

## How visitors reach fantasy

From the portal, every fantasy CTA is an **absolute cross-origin link**:

```
https://fantasy.strictlyjayers.com
```

Configured via `FANTASY_HUB_URL` (default production host). There is no Next.js
rewrite, reverse proxy, or same-origin `/leagues` path on the apex — that would
break Auth.js and couple deploys. The one exception is an **optional**
`/casino` proxy (below), which is off unless `CASINO_URL` is set.

Discord CTA defaults to the crew invite (`lib/site.ts`); override with
`DISCORD_INVITE_URL` on `sj-www` if the code rotates. Palworld is a real
`/palworld` room (join cards + Discord CTA). Optional `PALWORLD_STATUS` is a
public world line only — never put IPs or passwords in env or copy. Optional
`PALWORLD_INFO_URL` adds an extra “more info” link on that page.

**AI News** lives at `/ai` (nav + homepage destination). **Must read** is the
hand-edited `AI_EDITOR_PICKS` desk (`apps/www/src/lib/ai-news.ts`); **Top
stories** is the RSS firehose. X timelines use official embed widgets.

**Watch** lives at `/watch` — featured `youtube-nocookie` player (~2/3) plus a
playlist sidebar (~1/3) with thumbnails and a Playing mark. Embeds the shared
YouTube playlist (`lib/watch.ts` default, override with `YOUTUBE_PLAYLIST_ID`
on `sj-www`). Queue `?v=` stays inside the same playlist. Discord voice / clip
drops stay on the page. Anyone with YouTube edit access can add/remove videos.

**Palworld** lives at `/palworld` — world status + how to join. Passwords stay
in Discord. Home tile links here (Soon only if join copy is marked empty).

**People** lives at `/people` — a bank-style leadership desk (portrait, bio,
Follow on X) of influential accounts (Elon, Jensen Huang, AI lab leads,
NFL/golf). Official `x.com/{handle}` links only. Portraits are committed
under `apps/www/public/people/` from Wikimedia Commons (credited on each
card); missing shots use a monogram. Edit `INFLUENTIAL_PEOPLE` in
`apps/www/src/lib/people.ts`. No X API.

**Fitness** is a sibling host (`FITNESS_URL`, default
`https://fitness.strictlyjayers.com`) — nav More, People, and the home
destination list. Docs: [FITNESS.md](FITNESS.md).

**Bets** lives at `/bets` (nav + home destination). Members-only tracker for
public slips (data-driven bettors), parlay legs, tailing splits, BetMGM public-money
warnings, and posted options fills (`?tab=options`). Same Google allowlist as
Fantasy. Data is `sj bets` (Drive xlsx or native Sheet) →
`bets/{bets,summary,parlay_legs,public_warnings,record_splits,tailing_legs,options}.json`
on the hub bucket. Options stay in `options.json` and never fold into betting
totals. Docs:
[apps/www/README.md](apps/www/README.md) and `./scripts/setup-bets-infra.sh`.

**Casino** is an optional members-only path at `/casino` (nav + home
destination when configured). When `CASINO_URL` is set, `sj-www` proxies
`/casino` and `/casino/*` through a Route Handler
(`apps/www/src/app/casino/[[...path]]`) to the private `sj-casino` Cloud Run
service, calling it with a Google ID token from the portal's runtime service
account. Everything under `/casino/**`, images included, needs the same
Auth.js sign-in as `/bets`: signed-out pages redirect to
`/login?callbackUrl=/casino`, signed-out assets and API calls get `401`.
Unset / empty `CASINO_URL` leaves `/casino` a 404 — no proxy, no nav link.

**Member identity headers (casino chat).** For a signed-in member the proxy
adds these request headers to every upstream call, next to the
`Authorization: Bearer <Google ID token>`:

| Header | Value |
|---|---|
| `x-sj-user-id` | Opaque, stable member id: 24 hex chars. With `CASINO_USER_ID_SALT` set it is `HMAC-SHA256(salt, "sj:" + <input>)`, hex, truncated to 24 chars, where the input is the member's Google account subject (captured at sign-in), else (sessions minted before that was captured) the lowercased email, else the Auth.js `sub`; **without** the salt it falls back to a plain `SHA-256` of the subject, truncated (stable but unkeyed — set the salt in production). Never an email. Omitted if nothing usable is available and there is no salt. Auth.js has no database adapter here, so its own `sub` is a random UUID per sign-in and is not used when anything stable exists. |
| `x-sj-user-alias` | Optional bridge id for profiles that were keyed before sessions carried the Google subject. Sent only when the session has **both** a Google subject and an email and a salt is set: `HMAC-SHA256(salt, "sj:" + <lowercased email>)`, same 24-hex format. Never sent when equal to `x-sj-user-id`, so members on old sessions (whose primary id already is the email hash) get none. The casino uses it once to move the old profile to the new id. Never an email. |
| `x-sj-user-name` | Display name: session `name`, then `username`, then `Player`. Never the email or its local part (such a name is skipped). Trimmed to 40 characters, URI-encoded UTF-8 (`decodeURIComponent` it). |

Every client-supplied `x-sj-*` header (any case) is dropped before the proxy
adds its own, signed in or not, so a browser cannot spoof identity. Trust
comes from the ID token: Cloud Run IAM only lets the `sj-www` runtime service
account invoke `sj-casino`, so only the portal can reach it with these
headers. `sj-casino` must therefore stay private (no `allUsers`).

Chat needs no websockets: `GET /casino/api/chat?since=…` polling and `POST`
JSON bodies stream through unchanged; status codes (including `429`, with
`retry-after`) and JSON bodies pass through. Responses under `/casino/api/*`
keep the upstream `cache-control`, and get `cache-control: no-store` when the
casino sent none.

`CASINO_USER_ID_SALT` is an optional repo secret that `deploy-portal.yml`
sets as a runtime env var on `sj-www` (never printed; empty leaves the
existing value; no commas — generate with `openssl rand -hex 32`). Changing
it changes every member id.
`deploy-portal.yml` sets `CASINO_URL` from the repo secret as a runtime env
var (also a build arg, for the nav link only) and makes no IAM changes; the
operator IAM steps (grant `roles/run.invoker` to the portal runtime account,
then remove `allUsers`) are in
[apps/www/README.md](apps/www/README.md#operator-iam-private-sj-casino).

**Casino team linking (fantasy matchup chips).** Members link their own
fantasy team in each ESPN league from the casino ("Link my teams"); the
casino pays chips for that team's matchup wins. The portal's part:
`GET/POST/DELETE /casino/api/links` (the picker's leagues and teams come from
the hub snapshots read through `SJ_HUB_DIR`; a pick is checked against them
before the casino stores it) and `POST /casino/api/links/sync` (reports the
member's own linked teams' decided results to the casino's `/api/grants`).
These explicit routes sit under `/casino/**`, so the sign-in gate applies and
they take precedence over the catch-all proxy. The portal's calls to the
casino's private endpoints add `x-sj-service: casino-grants`; the proxy sets it
only from server code and still strips every browser `x-sj-*` header first, and
the casino accepts it only with `SJ_TRUST_HEADERS=1`. Hub-native leagues (golf)
are not offered. No new env var, secret, IAM role or scheduler. The rules,
caps and storage are in the casino repo's `docs/fantasy-links.md`.

Home also ships a **Coming up** event strip and **Meet the crew** links into
hub `/u/{handle}` profiles (edit handles in `lib/content.ts`). The hub chrome
links back with **Community** → `strictlyjayers.com` (`COMMUNITY_SITE_URL`).

## Local

```bash
# Portal (port 3002 — hub already uses 3000)
cd apps/www && npm install && npm run dev

# Hub (unchanged)
cd apps/web && npm run dev

# Portal unit + smoke (after npm run build for Playwright)
cd apps/www && npm test && npm run test:e2e
AUTH_DEV_BYPASS=1 npm run test:e2e:bets
AUTH_DEV_BYPASS=0 npm run test:e2e:auth
```

## Deploy

```bash
# One-time domain mapping + Spaceship DNS steps
./scripts/setup-portal-domain.sh

# Manual / CD — see .github/workflows/deploy-portal.yml
```

Push-path CD watches `apps/www/**`. Apex DNS + `SITE_URL` cutover is **landed**:
production serves `https://strictlyjayers.com` (and `www`) on `sj-www` with
`SITE_URL=https://strictlyjayers.com`. Deploy CD keeps a non-`*.run.app`
`SITE_URL`. Portal middleware 308s `www` → apex.

Re-run mapping / DNS printouts if you need them:

```
SITE_URL=https://strictlyjayers.com
FANTASY_HUB_URL=https://fantasy.strictlyjayers.com
FITNESS_URL=https://fitness.strictlyjayers.com
```

```bash
./scripts/setup-portal-domain.sh --with-www
./scripts/setup-portal-domain.sh --cutover   # only if SITE_URL was never set
```

Fantasy hub domain work stays in [HUB.md](HUB.md) (`fantasy` CNAME). Apex
mapping is intentionally separate so a portal deploy cannot clobber hub
`AUTH_URL`.
