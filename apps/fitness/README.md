# Strictly Jayers Fitness (`apps/fitness`)

Member training log for **https://fitness.strictlyjayers.com**.

The community portal stays on **https://strictlyjayers.com** (`apps/www`).
The fantasy hub stays on **https://fantasy.strictlyjayers.com** (`apps/web`).
This app never proxies those hosts.

See [FITNESS.md](../../FITNESS.md) for domain routing, Auth.js, and deploy.

## Local

```bash
cd apps/fitness
cp .env.example .env.local
npm install
npm run dev                  # http://localhost:3003
```

| Env | Purpose |
|---|---|
| `SITE_URL` / `AUTH_URL` | Canonical origin (metadata + Auth.js) |
| `AUTH_SECRET` / `AUTH_GOOGLE_*` / `ALLOWED_EMAILS` | Same secrets as `sj-hub` |
| `AUTH_DEV_BYPASS` | Skip Google; use `SJ_DEV_VIEWER_EMAIL` |
| `SJ_HUB_DIR` | Read-only `hub_members.json` (same file as Fantasy) |
| `SJ_FITNESS_DIR` | Per-user `users/{hash}/athlete.json` |
| `COMMUNITY_SITE_URL` | Absolute link to the apex portal |
| `FANTASY_HUB_URL` | Absolute link to the hub |

The log itself is the static PWA in `public/` (vanilla JS from athlete-log,
restyled). Next.js hosts Auth.js, `/api/me`, `/api/health`, and rewrites `/`
→ `/app.html` so the service worker stays on this origin.
