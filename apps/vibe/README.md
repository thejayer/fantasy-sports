# Vibe Split — `apps/vibe`

How much coding (vibecoding) happened **during a workout**. Designed for
Austin Wiley (`thejayer`) first; any allowlisted member can link their own
Health Auto Export token and GitHub.

| Host | Cloud Run | Data |
|---|---|---|
| `vibe.strictlyjayers.com` | `sj-vibe` | `{SJ_VIBE_DIR}/users/<email-hash>/vibe.json` |

Prod mounts `gs://<GCS_BUCKET>` at `/app/data/sj` and sets
`SJ_HUB_DIR=/app/data/sj` plus `SJ_VIBE_DIR=/app/data/sj/vibe`. Do **not**
`mkdir` / `stat` that FUSE path in the entrypoint. The live project and
bucket are GitHub repository secrets (`GCP_PROJECT_ID`, `GCS_BUCKET`) —
Austin holds them.

## Local

```bash
cd apps/vibe && cp .env.example .env.local
# AUTH_DEV_BYPASS=1 uses SJ_DEV_VIEWER_EMAIL (demo@example.com)
# Empty bypass profiles seed a realistic demo week so Home is not blank.
npm install && npm run dev
# http://localhost:3005

npm test && npm run build && npm run test:e2e
AUTH_DEV_BYPASS=0 npm run test:e2e:auth
```

## Vibe Score

```
commits×1 + PRs opened×2 + PRs merged×3 + reviews×1
+ comments×0.5 + overlapping agent minutes×0.1
```

Each workout window is `[start − buffer, end + buffer]`. Buffer defaults to
15 minutes (0–60). Lines added/removed show when GitHub returns them and do
not change the score.

## GitHub refresh

On-visit refresh if `last_sync_at` is older than 30 minutes, plus Settings →
**Sync now**. Optional Cloud Scheduler can `POST /api/cron/sync` with
`Authorization: Bearer $CRON_SECRET` against the same `sj-vibe` service —
no extra job image.

Sources: authenticated `GET /user/events` (paginated) and
`GET /search/commits?q=author:<login> committer-date:from..to`. Commit
stats are fetched only for commits that already overlap a workout (cap 25).

## Austin setup (ops — not done in this PR)

### 1. DNS + Cloud Run domain

Spaceship → `strictlyjayers.com` → DNS:

| Type | Name | Value |
|---|---|---|
| `CNAME` | `vibe` | `ghs.googlehosted.com` |

Then:

```bash
./scripts/setup-vibe-domain.sh
# after TLS Ready:
./scripts/setup-vibe-domain.sh --cutover
```

### 2. Google OAuth (existing hub client)

Add to the **existing** Google OAuth client (same as Fantasy / Fitness):

| Field | Value |
|---|---|
| Authorized JavaScript origin | `https://vibe.strictlyjayers.com` |
| Authorized redirect URI | `https://vibe.strictlyjayers.com/api/auth/callback/google` |

Keep the Fantasy and Fitness pairs.

### 3. GitHub OAuth app (new)

GitHub → Settings → Developer settings → OAuth Apps → New:

| Field | Value |
|---|---|
| Application name | Strictly Jayers Vibe Split |
| Homepage URL | `https://vibe.strictlyjayers.com` |
| Authorization callback URL | `https://vibe.strictlyjayers.com/api/github/callback` |

Scopes requested: `read:user` and `repo` (private commit metadata). Members
can instead paste a fine-grained PAT (Contents: Read, Metadata: Read).

```bash
printf '%s' 'GITHUB_CLIENT_ID' | gcloud secrets versions add sj-vibe-github-client-id --data-file=-
printf '%s' 'GITHUB_CLIENT_SECRET' | gcloud secrets versions add sj-vibe-github-client-secret --data-file=-
openssl rand -hex 32 | gcloud secrets versions add sj-vibe-token-key --data-file=-
openssl rand -hex 24 | gcloud secrets versions add sj-vibe-cron-secret --data-file=-
```

Deploy CD creates placeholder versions of those four secrets if they are
missing so the first `sj-vibe` deploy does not fail. Replace them before
anyone connects GitHub.

Runtime SA accessor (default Compute Engine SA):

```bash
PROJECT_NUMBER="$(gcloud projects describe <GCP_PROJECT_ID> --format='value(projectNumber)')"
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
for name in sj-vibe-github-client-id sj-vibe-github-client-secret sj-vibe-token-key sj-vibe-cron-secret; do
  gcloud secrets add-iam-policy-binding "$name" \
    --member="serviceAccount:${SA}" \
    --role=roles/secretmanager.secretAccessor
done
```

Or re-run `./scripts/grant-hub-secret-access.sh` (now includes the vibe secrets).

### 4. Health Auto Export (iPhone)

1. Install [Health Auto Export](https://www.healthyapps.dev/health-auto-export).
2. Vibe Split → Settings → **Create token**. Copy it once.
3. Automations → new **REST API** automation:

| Setting | Value |
|---|---|
| Automation type | REST API |
| Data type | Workouts |
| Export format | JSON |
| Export version | Version 2 |
| Include route data | Off |
| Include workout metrics | Off |
| Batch requests | On |
| URL | `https://vibe.strictlyjayers.com/api/ingest/health` |
| Header | `Authorization` = `Bearer <token>` |

The app sets `Content-Type`. `X-Vibe-Token` or `api-key` also work. After
saving, use **Manual Export** for a date range to backfill.

Payload shape is Health Auto Export Workouts v2
(`data.workouts[]` with `id`, `name`, `start`, `end`, `duration`, optional
`activeEnergyBurned` / `heartRate`). The parser also accepts a raw array,
a single object, and v1 `activeEnergy`. See
`src/fixtures/health-auto-export.json`.

Fallback: Settings → upload Apple Health `export.zip` / `export.xml`
(streaming `<Workout>` tags). Optional Hevy-style CSV: `start,end,type`.

### 5. Agent minutes (beta)

`POST /api/ingest/agents` with the same ingest token. Body is
`{ "runs": [{ "start", "end", "label" }] }` or a CSV of those columns.
Overlapping minutes count at ×0.1. Pluggable — do not block on it.

## Identity

Same Auth.js Google client + allowlist as the hub:
`ALLOWED_EMAILS` ∪ `{SJ_HUB_DIR}/hub_members.json`. Cookies stay on the
vibe origin.
