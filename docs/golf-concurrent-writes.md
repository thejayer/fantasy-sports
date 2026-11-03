# Concurrent golf writes

Auction creation, timer polling, and actions use one authoritative document
mutation path. In Cloud Run, it reads the object generation, conditionally reads
that generation's payload, and uploads with `ifGenerationMatch`. A conflict
re-reads current state before computing the transition again. A stale bid gets
409; an unchanged poll does not upload anything. Async authorization and auction
finalization side effects run outside the replayable mutation callback.

Lineup saves read the current `lineups.json` through the same path and merge
only the authorized team/event. Validation runs again against current tee times,
locks, and team lineups on every retry. Saves no longer rewrite the cached whole
season. Initialization/finalization retries explicitly preserve populated lineups
only when their roster and event identities are compatible, before publishing
other replacement concerns. Ordinary explicit league recreation retains its
existing behavior of replacing all concerns consistently, including lineups.
This is not a multi-object snapshot
transaction; standings, draft, and index publication retain their existing model.

## Configuration and rollout

`SJ_HUB_GCS_BUCKET` must name the same bucket mounted at `SJ_HUB_DIR`, with the
same league/season prefix (currently the bucket root). The hub deploy workflow
sets it from its mounted bucket input. Manual hub deploys now require an explicit
bucket; push deploys use the existing repository bucket setting. Cloud Run fails
closed for golf mutations when this setting is missing; it never substitutes
FUSE file locks for GCS generation preconditions.

The attached runtime service account needs existing object read, create, and
overwrite permissions on that bucket. No new IAM grants, keys, or dependencies
are introduced. Validate those permissions and mount/object alignment in an
authorized staging environment before production activation.

Older revisions still write unconditionally. Drain every older golf writer
before claiming protection: a conditional writer cannot fence an older process
that ignores generation checks. Do not run an old CLI or maintenance job that
rewrites populated golf lineups during the rollout. No production activation is
part of this local change.

Locally, writes use exclusive-create file locks across processes plus a unique
temporary filename and rename. Lock waits are bounded. A process killed while
holding a local lock leaves a lock file and future writes fail closed; remove
that lock only after stopping all local writers. This filesystem mode is for
local disks, not shared FUSE mounts.

## Verification limits

`golf-concurrency.test.ts` exercises the actual routes and stores with local
temporary files and an in-memory GCS API emulator. It forces overlapping bids,
delayed polling, timer transitions, and lineup saves, including conditional
upload conflicts and permission failures. These tests do not certify live
identity, IAM, GCS/FUSE consistency, or drainage of deployed revisions.

Storage contract references:
- https://docs.cloud.google.com/storage/docs/json_api/v1/objects/get
- https://docs.cloud.google.com/storage/docs/json_api/v1/objects/insert
- https://docs.cloud.google.com/docs/authentication/rest
