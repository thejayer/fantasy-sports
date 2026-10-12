# Vibe Split — `vibe.strictlyjayers.com`

Workout windows overlapped with GitHub. Sibling Cloud Run app, not on the
apex and not inside the fantasy hub.

| Host | App | Cloud Run | Role |
|---|---|---|---|
| `strictlyjayers.com` | `apps/www` | `sj-www` | Public community front door |
| `fantasy.strictlyjayers.com` | `apps/web` | `sj-hub` | Authenticated member hub |
| `fitness.strictlyjayers.com` | `apps/fitness` | `sj-fitness` | Member training log |
| `vibe.strictlyjayers.com` | `apps/vibe` | `sj-vibe` | Coded-while-lifting |

Setup, score formula, Health Auto Export, and GitHub OAuth steps:
[apps/vibe/README.md](apps/vibe/README.md).

### Cloud Run env (sj-vibe)

| Runtime env | Source | Purpose |
|---|---|---|
| `AUTH_URL` | `https://vibe.strictlyjayers.com` | Auth.js public origin |
| `AUTH_TRUST_HOST` | `true` | Cloud Run / custom domain |
| `AUTH_SECRET` | secret `sj-auth-secret:latest` | Same JWT secret as `sj-hub` |
| `AUTH_GOOGLE_ID` | secret `sj-auth-google-id:latest` | Same Google OAuth client |
| `AUTH_GOOGLE_SECRET` | secret `sj-auth-google-secret:latest` | Same Google OAuth client |
| `ALLOWED_EMAILS` | secret `sj-allowed-emails:latest` | Same env allowlist |
| `SJ_HUB_DIR` | `/app/data/sj` | Read `hub_members.json` |
| `SJ_VIBE_DIR` | `/app/data/sj/vibe` | Per-user `users/{sha256(email)[:32]}/vibe.json` |
| `GITHUB_CLIENT_ID` | secret `sj-vibe-github-client-id:latest` | GitHub OAuth app |
| `GITHUB_CLIENT_SECRET` | secret `sj-vibe-github-client-secret:latest` | GitHub OAuth app |
| `SJ_VIBE_TOKEN_KEY` | secret `sj-vibe-token-key:latest` | AES-256 key for GitHub tokens |
| `CRON_SECRET` | secret `sj-vibe-cron-secret:latest` | Optional `POST /api/cron/sync` |
| `AUTH_DEV_BYPASS` | unset in prod | Local / CI only |

**Do not** `mkdir` / `stat` / `test` the FUSE mount in the entrypoint.

Push CD: `.github/workflows/deploy-vibe.yml`. Domain: `./scripts/setup-vibe-domain.sh`.
Live check: `/api/health` → `{"service":"sj-vibe"}`.
