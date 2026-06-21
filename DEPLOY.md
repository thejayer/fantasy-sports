# Deploying the dashboard to Cloud Run

A guide for hosting the Streamlit dashboard on Google Cloud Run with a
shared-secret password gate -- intended for a fantasy league of ~10-15
people. Once running, it's a single URL anyone in the league can visit.

## Why Cloud Run

- **Cost:** Pay only when the dashboard is in use. For 15 users hitting
  it occasionally during draft season, you stay inside the [free tier]
  (https://cloud.google.com/run#pricing) (~$0/month).
- **Cold start:** ~10s when the container hasn't been used for a while.
  Acceptable for a draft tool. Bump to `--min-instances=1` for
  always-warm (costs ~$5-15/month for a tiny instance).
- **No server management:** Cloud Run scales to zero when idle.

## What's in the container

The `Dockerfile` at the repo root builds an image that:

1. Installs the `ffa` package with the `dashboard` extra.
2. Runs `ffa ingest` at build time to bake the last few seasons of
   nflverse weekly stats into the image. The dashboard reads Parquet
   from `/app/data/raw/` -- no network calls at runtime.
3. Launches `streamlit run src/ffa/dashboard.py` on `$PORT`.

Override what gets ingested:

    docker build --build-arg INGEST_SEASONS="2021 2022 2023 2024" .

## Auth: shared password

The dashboard checks the `DASHBOARD_PASSWORD` environment variable. If
it's set, users see a sign-in screen and must enter the matching value.
If it's unset (e.g. local dev), the dashboard is wide open. Set it on
the Cloud Run service via `--set-env-vars`.

For more than a handful of users, swap this out for Google sign-in via
Identity-Aware Proxy or Firebase Auth. For 15 friends in a group chat,
a shared password is fine.

## One-time GCP setup

```bash
# Install the gcloud CLI from https://cloud.google.com/sdk/docs/install,
# then sign in.
gcloud auth login

# Pick or create a project. Replace YOUR-PROJECT-ID throughout.
gcloud projects create your-project-id            # if new
gcloud config set project your-project-id

# Enable the APIs we use.
gcloud services enable \
    run.googleapis.com \
    cloudbuild.googleapis.com \
    artifactregistry.googleapis.com

# Create an Artifact Registry repo for our container image.
gcloud artifacts repositories create ffa \
    --repository-format=docker \
    --location=us-central1 \
    --description="ffa dashboard images"
```

## Deploy via GitHub Actions (recommended)

`.github/workflows/deploy.yml` builds the image, pushes it to Artifact
Registry, and deploys to Cloud Run for you -- one click from the Actions
tab, reproducible, no local Docker. Set it up once:

```bash
# 1. A service account the workflow authenticates as.
gcloud iam service-accounts create ffa-deployer --project your-project-id

SA="ffa-deployer@your-project-id.iam.gserviceaccount.com"
for role in run.admin iam.serviceAccountUser artifactregistry.admin \
            serviceusage.serviceUsageAdmin; do
  gcloud projects add-iam-policy-binding your-project-id \
      --member "serviceAccount:$SA" --role "roles/$role"
done

# 2. A JSON key for it (this file goes into a GitHub secret, then delete it).
gcloud iam service-accounts keys create key.json --iam-account "$SA"
```

Add two **repository secrets** (Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `GCP_SA_KEY` | the full contents of `key.json` |
| `DASHBOARD_PASSWORD` | the shared league password |

Then **Actions → deploy dashboard → Run workflow**, set your `project_id`
(the defaults bake seasons 2023-2025 and project 2026), and run it. The
final step prints the live URL -- `https://ffa-dashboard-xxx-uc.a.run.app`
-- which is what you send your league. Re-running redeploys with fresh data.

## Deploy manually (alternative)

If you'd rather not use Actions, run from the repo root:

```bash
# 1. Build the image with Cloud Build and push to Artifact Registry.
#    Cloud Build runs the Dockerfile in GCP -- no local Docker required.
gcloud builds submit \
    --tag us-central1-docker.pkg.dev/your-project-id/ffa/dashboard:latest

# 2. Deploy to Cloud Run.
gcloud run deploy ffa-dashboard \
    --image us-central1-docker.pkg.dev/your-project-id/ffa/dashboard:latest \
    --region us-central1 \
    --memory 1Gi \
    --cpu 1 \
    --port 8080 \
    --allow-unauthenticated \
    --set-env-vars="DASHBOARD_PASSWORD=pick-something-random,DASHBOARD_SEASON=2026,DASHBOARD_LEAGUE=ppr"
```

The last command prints a URL like `https://ffa-dashboard-xxx-uc.a.run.app`.
That's what you send to your league.

### What the env vars do

| Variable | Default | Purpose |
|---|---|---|
| `DASHBOARD_PASSWORD` | (empty -> no gate) | Shared password for the sign-in screen. |
| `DASHBOARD_SEASON` | `2026` | Target season the dashboard projects. |
| `DASHBOARD_LEAGUE` | `ppr` | League config file: `configs/{name}.yaml`. |
| `PORT` | `8080` | Set by Cloud Run; don't override. |

## Updating

Re-run the two `gcloud` commands. Cloud Build re-ingests the latest
nflverse data at image build time (the `ffa ingest` step in the
Dockerfile), so a fresh build picks up new games automatically.

For weekly auto-refresh during the season, you can later add a Cloud
Scheduler -> Cloud Build trigger that rebuilds the image on a cron.
Not in scope for this MVP.

## Local testing of the container

```bash
# Build locally (needs Docker installed).
docker build -t ffa-dashboard .

# Run with the same env vars Cloud Run would set.
docker run -p 8080:8080 \
    -e PORT=8080 \
    -e DASHBOARD_PASSWORD=test \
    ffa-dashboard

# Open http://localhost:8080 ; password is "test".
```

## Cost expectations (15-user league)

Cloud Run free tier (resets monthly):
- 2M requests
- 360,000 GB-seconds memory
- 180,000 vCPU-seconds

A league of 15 hitting the dashboard ~10 sessions/week of ~5 minutes
each at 1Gi/1vCPU is roughly 1,200 vCPU-seconds and 1,200 GB-seconds
per week -- well under 1% of the free tier. The only line item you
might see is **Cloud Build minutes** (~120 free build-minutes per day,
each redeploy uses 1-2 minutes), and **Artifact Registry storage**
(~$0.10/GB/month -- the image is ~1 GB).

Expected monthly bill: $0-1.

## Cleanup

If you want to tear everything down:

```bash
gcloud run services delete ffa-dashboard --region us-central1
gcloud artifacts repositories delete ffa --location us-central1
```
