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

## Why two hosts

- **Auth.js cookies** for the hub must be scoped to `fantasy.strictlyjayers.com`.
  Sharing the apex would mix community traffic with league OAuth redirects.
- **Snapshot / hub data** mounts stay on `sj-hub` only. The portal has no GCS
  dependency and can scale to zero independently.
- **Product boundary**: Discord / Palworld / future community surfaces live on
  the apex; leagues, tools, and auction rooms live on the hub.

## How visitors reach fantasy

From the portal, every fantasy CTA is an **absolute cross-origin link**:

```
https://fantasy.strictlyjayers.com
```

Configured via `FANTASY_HUB_URL` (default production host). There is no Next.js
rewrite, reverse proxy, or same-origin `/leagues` path on the apex — that would
break Auth.js and couple deploys.

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
