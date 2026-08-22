# Strictly Jayers Fitness (`apps/fitness`)

Public training log for **https://fitness.strictlyjayers.com**.

The community portal stays on **https://strictlyjayers.com** (`apps/www`).
The fantasy hub stays on **https://fantasy.strictlyjayers.com** (`apps/web`).
This app never proxies those hosts.

See [FITNESS.md](../../FITNESS.md) for domain routing and deploy.

## Local

```bash
cd apps/fitness
cp .env.example .env.local   # optional
npm install
npm run dev                  # http://localhost:3003
```

| Env | Purpose |
|---|---|
| `SITE_URL` | Canonical origin (metadata) |
| `COMMUNITY_SITE_URL` | Absolute link to the apex portal |
| `FANTASY_HUB_URL` | Absolute link to the hub |

The log itself is the static PWA in `public/` (vanilla JS from athlete-log,
restyled). Next.js hosts `/api/health` and rewrites `/` → `/app.html` so
the service worker can stay on this origin.
