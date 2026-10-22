# Vercel (portal pilot)

Phase 0: `apps/www` can run on Vercel without changing Cloud Run (`sj-www`
still uses `output: "standalone"` + the GCS FUSE mount). Do not add a
`vercel.json` `output` / `builds` override — that would break the Docker image.

## Project settings

| Setting | Value |
|---|---|
| Root Directory | `apps/www` |
| Framework Preset | Next.js |
| Ignored Build Step | `bash scripts/vercel-ignore.sh` |
| Node.js | 22 |
| OIDC | Enable **Secure backend access with OIDC** |

The ignore script exits `0` (skip) when `apps/www` and `packages/sj-ui` are
unchanged vs the previous deployment SHA, otherwise `1` (build). First deploy
and unknown SHAs always build.

`next.config.ts` keeps `output: "standalone"` for Cloud Run. Vercel ignores
that setting and uses its own output.

## Google OAuth (stable preview alias)

Use the existing hub OAuth client. Add this pair for the **stable preview
alias** (replace the placeholder host; do not use a per-commit `*.vercel.app`):

| Field | Value |
|---|---|
| Authorized JavaScript origin | `https://<STABLE_PREVIEW_ALIAS>` |
| Authorized redirect URI | `https://<STABLE_PREVIEW_ALIAS>/api/auth/callback/google` |

Set `SITE_URL` and `AUTH_URL` to `https://<STABLE_PREVIEW_ALIAS>`. Keep the
production `https://strictlyjayers.com` pair on the same client for Cloud Run.

## Environment variables

Leave `SJ_DATA_SOURCE` unset on Cloud Run. On Vercel set `SJ_DATA_SOURCE=gcs`
and the GCS/WIF vars. No JSON key files.

### Required on Vercel

| Name | Meaning |
|---|---|
| `SITE_URL` | Canonical origin (metadata + Auth.js host); the stable preview alias |
| `AUTH_URL` | Auth.js public origin (same as `SITE_URL`) |
| `AUTH_SECRET` | Auth.js secret (same value as Cloud Run `sj-auth-secret`) |
| `AUTH_GOOGLE_ID` | Google OAuth client id (same client as the hub) |
| `AUTH_GOOGLE_SECRET` | Google OAuth client secret |
| `ALLOWED_EMAILS` | Comma-separated extra allowlist (unioned with `hub_members.json`) |
| `SJ_DATA_SOURCE` | Set to `gcs` (anything else, or unset, is `fs`) |
| `SJ_GCS_BUCKET` | Bucket that holds `hub_members.json` and `bets/*.json` |
| `GCP_PROJECT_ID` | GCP project id for the Storage client |
| `GCP_WIF_AUDIENCE` | WIF provider Default audience URL (`https://iam.googleapis.com/projects/…/providers/…`) |
| `GCP_SERVICE_ACCOUNT_EMAIL` | Service account to impersonate (objectViewer on the bucket) |

### Optional

| Name | Meaning |
|---|---|
| `AUTH_TRUST_HOST` | Set `true` so Auth.js trusts the Vercel host |
| `SJ_GCS_PREFIX` | Object-key prefix; omit when the FUSE mount is the bucket root |
| `FANTASY_HUB_URL` | Absolute hub URL (defaults to production host) |
| `FITNESS_URL` | Absolute fitness URL (defaults to production host) |
| `VIBE_URL` | Absolute vibe URL (defaults to production host) |
| `DISCORD_INVITE_URL` | Discord CTA override |
| `PALWORLD_STATUS` | Public Palworld line only — never IPs or passwords |
| `PALWORLD_INFO_URL` | Extra Palworld link |
| `YOUTUBE_PLAYLIST_ID` | `/watch` playlist override |
| `AUTH_DEV_BYPASS` | Keep unset / `0` on Vercel |
| `SJ_HUB_DIR` / `SJ_DATA_DIR` / `SJ_BETS_DIR` | `fs` mode only (Cloud Run + local) |

Vercel injects the OIDC token when OIDC is enabled; do not set a key file
path. The reader uses `@vercel/oidc` `getVercelOidcToken` as the WIF
`subject_token_supplier`.

WIF provider (placeholders only): issuer `https://oidc.vercel.com/<TEAM_SLUG>`;
Allowed audiences `https://vercel.com/<TEAM_SLUG>` (Vercel’s default token
`aud`); map `google.subject` → `assertion.sub`. Grant the impersonated SA
`roles/storage.objectViewer` on `SJ_GCS_BUCKET`. Bind each Vercel
environment principal
`owner:<TEAM_SLUG>:project:<PROJECT_SLUG>:environment:<production|preview>`.

## Reads

`gcs` mode is read-only. Keys (after optional `SJ_GCS_PREFIX`):

- `hub_members.json`
- `bets/bets.json`
- `bets/parlay_legs.json`
- `bets/public_warnings.json`
- `bets/record_splits.json`
- `bets/tailing_legs.json`

A missing object is the same as `ENOENT`. Bets still fall through to committed
`fixtures/bets`. `hub_members.json` has no fixture. Auth / network errors do
not fall back.
