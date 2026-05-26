# Streamlit dashboard for fantasy-sports, deployable to Cloud Run.
#
# Multi-stage isn't worth it for a Streamlit app: the runtime needs the same
# pandas/sklearn/duckdb stack as the build, and the wheels dominate image size.
# Single stage keeps the Dockerfile simple and Cloud Build fast.

FROM python:3.11-slim

# Tools needed for any wheel that compiles (a handful of sklearn/duckdb edge
# cases). Cleared after install to keep the image trim.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps in their own layer so config/data edits don't bust the cache.
COPY pyproject.toml README.md ./
COPY src/ ./src/
COPY configs/ ./configs/
RUN pip install --no-cache-dir -e ".[dashboard]"

# Bake the warehouse into the image. Cloud Build has internet; nfl_data_py
# fetches Parquet from nflverse on GitHub. Override at build time with
#   --build-arg INGEST_SEASONS="2021 2022 2023 2024"
ARG INGEST_SEASONS="2022 2023 2024"
RUN args=""; for s in ${INGEST_SEASONS}; do args="$args --season $s"; done && \
    ffa ingest $args

# Cloud Run injects $PORT (defaults 8080). Streamlit must bind 0.0.0.0.
ENV PORT=8080 \
    STREAMLIT_SERVER_HEADLESS=true \
    STREAMLIT_SERVER_ENABLECORS=false \
    STREAMLIT_SERVER_FILEWATCHERTYPE=none \
    STREAMLIT_BROWSER_GATHERUSAGESTATS=false \
    PYTHONUNBUFFERED=1

EXPOSE 8080

# Env-var defaults are read in the dashboard's argparse fallback. Override per
# deploy with --set-env-vars on `gcloud run deploy`.
CMD ["sh", "-c", "exec streamlit run src/ffa/dashboard.py \
    --server.port=$PORT \
    --server.address=0.0.0.0 \
    -- \
    --league configs/${DASHBOARD_LEAGUE:-ppr}.yaml \
    --season ${DASHBOARD_SEASON:-2024} \
    --db data/ffa.duckdb \
    --raw-dir data/raw"]
