# Strictly Jayers community portal (`apps/www`)

Public front door for **https://strictlyjayers.com**.

The fantasy member hub stays on **https://fantasy.strictlyjayers.com**
(`apps/web`). This app never proxies or rewrites league routes — it deep-links
with absolute URLs so Auth.js cookies and snapshot data stay on the hub host.

**Bets** (`/bets`) is the built-in members-only surface on this host (roadmap P.11).
Auth.js + Google uses the same allowlist as Fantasy / Fitness
(`ALLOWED_EMAILS` ∪ `{SJ_HUB_DIR}/hub_members.json`). The rest of the apex
stays public. There is **no service worker** on www — `/bets` is a
server-rendered page, not a PWA.

**Casino** (`/casino`) is an optional, members-only, authenticated reverse
proxy to a separately deployed, **private** Cloud Run service (`sj-casino`).
When `CASINO_URL` is set, `app/casino/[[...path]]/route.ts` proxies every
method on `/casino` and `/casino/*` to `${CASINO_URL}/casino/<path>?<query>`.
When unset, `/casino` is a 404, the nav link is hidden and robots disallows
`/casino`.

- **Sign-in gate.** Everything under `/casino/**` — images and static assets
  included — needs the same Strictly Jayers Auth.js session as `/bets`
  (`middleware.ts` adds a second matcher entry because the main one skips
  image extensions; the Route Handler checks the session again). Signed-out
  page loads redirect to `/login?callbackUrl=<path+query>`; signed-out
  assets and API calls get `401`.
- **Service-to-service auth.** The portal fetches a Google ID token from the
  metadata server (audience = the `CASINO_URL` origin), caches it until about
  5 minutes before expiry, and sends it upstream as `Authorization: Bearer`.
  With no metadata server (local dev) no token is sent; `CASINO_AUTH=none`
  skips the token explicitly (tests).
- **Member identity.** Signed-in requests carry `x-sj-user-id` (opaque,
  keyed hash of the Google account subject), `x-sj-user-alias` (optional: the
  earlier email-keyed hash, so the casino can move an old profile once) and
  `x-sj-user-name` (display name, never the email); any client-sent `x-sj-*` header is stripped. Contract and salt
  details are in [PORTAL.md](../../PORTAL.md). `/casino/api/*` responses get
  `cache-control: no-store` unless the casino sets its own.
- **What is forwarded.** Request and response bodies stream. Upstream status,
  `content-type`, `cache-control`, `etag`, `last-modified`, `set-cookie` (all
  values) and `location` (made relative when it points at the casino origin)
  come back. The browser's `Cookie` and `Authorization` headers, `host` and
  hop-by-hop headers are never forwarded. Redirects are not followed; the
  upstream call has a timeout (`502` on failure, `504` on timeout).
- **Home-page box ("Casino today").** When `CASINO_URL` is set, the home page
  shows today's top three wins and hottest machines. The browser asks
  `GET /casino/portal-summary` (inside the sign-in gate; signed out is a bare
  `401` and the box is simply absent). That Route Handler calls the casino's
  `/casino/api/home-summary` **server-side through the same proxy path**
  (ID token, identity headers, origin pinned), validates and trims the JSON
  (display names and chips only), and caches it in memory for 30 seconds,
  shared by every member. If the casino is slow (4 s timeout) or down it serves
  the last good copy for up to 5 minutes, then answers `503` and the box is
  hidden. The home page itself stays statically cached. **Deploy order:** this
  needs the casino's `/api/home-summary` (casino leaderboards PR), so ship the
  casino first; until then the box just doesn't appear.
- **Config.** `CASINO_URL` is read at **request time**. `deploy-portal.yml`
  sets it as a Cloud Run env var on `sj-www` from the repo secret (never
  printed). It is also a Docker build arg, but only so the prerendered nav and
  home show the Casino link.

### Operator IAM: private `sj-casino`

The deploy workflows make **no** IAM changes; an operator does these steps in
this order (placeholders in `<>`):

1. Merge and deploy this proxy first, with `CASINO_URL` set to the
   `sj-casino` service URL (not a custom domain: it is the ID-token audience).
2. Find the identity `sj-www` runs as (empty output = the project's default
   compute service account):
   ```bash
   gcloud run services describe sj-www --project <PROJECT_ID> --region <REGION> \
     --format='value(spec.template.spec.serviceAccountName)'
   ```
3. Let that account invoke the private service:
   ```bash
   gcloud run services add-iam-policy-binding sj-casino \
     --project <PROJECT_ID> --region <REGION> \
     --member "serviceAccount:<SJ_WWW_RUNTIME_SA>" --role roles/run.invoker
   ```
4. Check, signed in, that `/casino` and an image such as
   `/casino/cards/<image>` load through the portal.
5. Remove public access:
   ```bash
   gcloud run services remove-iam-policy-binding sj-casino \
     --project <PROJECT_ID> --region <REGION> \
     --member allUsers --role roles/run.invoker
   ```
6. Only now merge the casino repo change that deploys with
   `--no-allow-unauthenticated` (`thejayer/lucky-little-casino` PR #3).
   Merging it earlier would break the portal. If the proxy returns `502`
   after step 5, the invoker binding in step 3 is missing or targets the
   wrong account.

On Vercel (no metadata server) no ID token is sent, so a private `sj-casino`
only works from the Cloud Run deployment.

See [PORTAL.md](../../PORTAL.md) for domain routing and deploy. Vercel pilot
settings (Root Directory, ignored build step, OIDC/WIF env) live in
[VERCEL.md](./VERCEL.md).

## Local

```bash
cd apps/www
cp .env.example .env.local   # set AUTH_DEV_BYPASS=1 locally to skip Google for /bets
npm install
npm run dev                  # http://localhost:3002
```

| Env | Purpose |
|---|---|
| `SITE_URL` | Canonical origin (metadata + Auth.js host) |
| `AUTH_URL` | Auth.js public origin (same as `SITE_URL` in prod) |
| `FANTASY_HUB_URL` | Absolute link to the hub (default production host) |
| `FITNESS_URL` | Absolute link to the fitness log (default production host) |
| `CASINO_URL` | Optional `/casino` proxy upstream (runtime; also a build arg for the nav link; empty = off) |
| `CASINO_USER_ID_SALT` | Optional server-only key for the opaque `x-sj-user-id` forwarded to the casino |
| `DISCORD_INVITE_URL` | Optional Discord CTA override (default baked in) |
| `PALWORLD_INFO_URL` | Optional extra Palworld link on `/palworld` |
| `PALWORLD_STATUS` | Optional public world-status line (never IPs/passwords) |
| `YOUTUBE_PLAYLIST_ID` | Optional override for `/watch` (default baked in) |
| `AUTH_SECRET` | Same secret as sj-hub (`sj-auth-secret`) |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Same Google OAuth client as sj-hub |
| `ALLOWED_EMAILS` | Same env allowlist (`sj-allowed-emails`) |
| `SJ_HUB_DIR` | Read `hub_members.json` (prod: `/app/data/sj`) |
| `SJ_BETS_DIR` | Override `bets.json` directory (local: `fixtures/bets`) |
| `AUTH_DEV_BYPASS` | Local / CI only — skip Google |

```bash
cd apps/www && npm test && npm run build && npm run test:e2e
AUTH_DEV_BYPASS=1 npm run test:e2e:bets
AUTH_DEV_BYPASS=0 npm run test:e2e:auth
```

## Bets ingest

`sj bets` looks up the Drive file's `mimeType` (read-only Drive + Sheets
scopes via ADC) and then:

- native Google Sheet (`application/vnd.google-apps.spreadsheet`) → Sheets API
- uploaded `.xlsx` → `files.get?alt=media` + the same Bets-tab parser as `--from`

The live tracker id is an uploaded `.xlsx` in Drive today — no conversion
needed. Austin shares that file with the reader SA as Viewer. Writes
`bets/bets.json` + `bets/summary.json` + `bets/parlay_legs.json` +
`bets/public_warnings.json` + `bets/record_splits.json` +
`bets/tailing_legs.json` + `bets/options.json` to the store
(`gs://<GCS_BUCKET>/bets/` when `SJ_GCS_BUCKET` is set). The live project,
bucket, and bets-reader SA email are GitHub repository secrets / Austin
(`GCP_PROJECT_ID`, `GCS_BUCKET`, `<BETS_READER_SA_EMAIL>`) — not committed here.
KPI math is from raw Bets / Parlay Legs / Public Warnings rows — never the
formula summary tabs. Options P/L is a separate sidecar (`bets/options.json`)
and never folds into those totals.

Options ingest is off unless `SJ_OPTIONS_SYNC=1`. The Options Tracker sheet
id comes from `SJ_OPTIONS_SHEET_ID` (GitHub secret / job env — never a
literal in the repo). Share that sheet Viewer-only with the same reader SA.
Failures there never fail the bets export.

```bash
# Offline fixture → local JSON (what CI / the fallback UI use)
sj bets --from tests/fixtures/bets/tracker_tabs.xlsx \
  --store-dir apps/www/fixtures

# Simulated options sidecar (does not require SJ_OPTIONS_SYNC)
sj bets --from tests/fixtures/bets/tracker_tabs.xlsx \
  --options-from tests/fixtures/bets/options_simulated.json \
  --store-dir apps/www/fixtures

# Live Drive file (xlsx or native Sheet; share with the job SA as Viewer)
sj bets
```

One-time GCP: `./scripts/setup-bets-infra.sh` (SA, Drive + Sheets APIs,
scheduler `32 9-23/2 * * *` America/Chicago). Image updates ride
**deploy sync job**. Share the file with
`<BETS_READER_SA_EMAIL>` as Viewer.

## Google OAuth (one-time, Austin)

Use the **existing** hub OAuth client. Add:

| Field | Value |
|---|---|
| Authorized JavaScript origin | `https://strictlyjayers.com` |
| Authorized redirect URI | `https://strictlyjayers.com/api/auth/callback/google` |

Keep the Fantasy and Fitness pairs. Also keep the `*.run.app` pair if you
still open the Cloud Run URL directly.

## Cloud Run env (`sj-www`)

Push CD (`.github/workflows/deploy-portal.yml`) now sets the hub auth secrets
and mounts `gs://<GCS_BUCKET>` **read-only** at
`/app/data/sj` (uid/gid `1001`, semicolon `mount-options`). Do not
`mkdir`/`stat` the FUSE mount in the entrypoint.

| Runtime env | Source | Purpose |
|---|---|---|
| `SITE_URL` / `AUTH_URL` | `https://strictlyjayers.com` | Canonical host (keep non-`*.run.app`) |
| `AUTH_TRUST_HOST` | `true` | Cloud Run / custom domain |
| `AUTH_SECRET` | secret `sj-auth-secret:latest` | Same JWT secret as sj-hub |
| `AUTH_GOOGLE_ID` | secret `sj-auth-google-id:latest` | Same Google OAuth client |
| `AUTH_GOOGLE_SECRET` | secret `sj-auth-google-secret:latest` | Same Google OAuth client |
| `ALLOWED_EMAILS` | secret `sj-allowed-emails:latest` | Same env allowlist as Fantasy |
| `SJ_HUB_DIR` | `/app/data/sj` | `hub_members.json` + `bets/` |
| `CASINO_URL` | repo secret `CASINO_URL` (set by `deploy-portal.yml`, never printed) | Optional `/casino` proxy upstream; unset secret leaves the service value unchanged |
| `CASINO_USER_ID_SALT` | optional repo secret (set by `deploy-portal.yml`, never printed) | HMAC key for `x-sj-user-id`; unset = plain SHA-256 of the subject |
| `CASINO_AUTH` | unset | `none` skips the Google ID token (tests only) |
