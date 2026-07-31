# Community portal — `strictlyjayers.com`

The apex site is the **community home**. Fantasy stays on a subdomain.

Visual language is the shared **Modernist** system (`design/modernist/`) —
Archivo, Signal Red accent (`--color-accent`), 0 radius, 2px rules. Both
`apps/www` and `apps/web` vendor a copy under `src/styles/modernist.css`.

| Host | App | Cloud Run | Role |
|---|---|---|---|
| `strictlyjayers.com` (and `www`) | `apps/www` | `sj-www` | Public community front door |
| `fantasy.strictlyjayers.com` | `apps/web` | `sj-hub` | Authenticated member hub |

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

Optional: set `DISCORD_INVITE_URL` and `PALWORLD_INFO_URL` on `sj-www` to turn
the Discord / Palworld destination tiles into live links.

**AI News** lives at `/ai` (nav + homepage destination). Headlines are fetched
server-side from RSS (see `apps/www/src/lib/ai-news.ts`); X timelines use
official embed widgets. Edit `AI_EDITOR_PICKS` for the big-story wall.

## Local

```bash
# Portal (port 3002 — hub already uses 3000)
cd apps/www && npm install && npm run dev

# Hub (unchanged)
cd apps/web && npm run dev
```

## Deploy

```bash
# One-time domain mapping + Spaceship DNS steps
./scripts/setup-portal-domain.sh

# Manual / CD — see .github/workflows/deploy-portal.yml
```

Push-path CD watches `apps/www/**`. First deploy can use `workflow_dispatch`
before the apex DNS cutover. After the mapping is Ready, set:

```
SITE_URL=https://strictlyjayers.com
FANTASY_HUB_URL=https://fantasy.strictlyjayers.com
```

Redirect `www.strictlyjayers.com` → apex (Cloud Run domain mapping or DNS
provider redirect) so both hostnames hit `sj-www`.

## Relationship to the hub docs

Hub-only domain work stays in [HUB.md](HUB.md) (`fantasy` CNAME). Apex mapping
is intentionally separate so a portal deploy cannot clobber hub `AUTH_URL`.
