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

### Enforced hold in this PR

`SJ_GOLF_WRITES_ENABLED` defaults to paused and enables mutations only when its
runtime value is exactly `1`. The production Docker image defaults to `0`.
The hub deploy workflow explicitly writes `0` into the service environment on
**every push and manual dispatch**, overriding an inherited value. There is no
activation input, repository-variable switch, or evidence-checkbox shortcut in
this workflow. Merging code can continue to deploy unrelated hub updates, but
cannot automatically activate these writers.

Paused auction GETs only read the existing mounted document; they do not advance
timers, enter the application GCS/metadata client, acquire locks, or persist state.
The FUSE layer can still perform its normal reads. Auction creation,
actions/finalization, lineup submission, and golf-season creation return 503 with
`GOLF_WRITES_PAUSED`. The document and snapshot writers also reject direct calls
before storage work. Other hub features retain their existing behavior.

This hold deliberately supplies **no production activation path**. A subsequent
reviewed activation decision must provide evidence tied to the candidate SHA,
runtime identity, service, bucket/prefix, and revisions: staged permission and
concurrency validation; quiescence/drainage of every older unconditional writer;
then explicit authorization to enable writes. Current workflow dispatches cannot
perform that activation, including dispatches aimed at a staging service. No
staging or production operations are performed by the tests or this PR work.
The workflow rejects commas/line breaks in the resolved auth URL and validates
the resolved bucket so those values cannot inject another environment binding.
The forced pause is also the last binding in the deployed environment argument.

For isolated local fixtures, explicitly set `SJ_GOLF_WRITES_ENABLED=1`; the
Playwright fixture server does this against its disposable local hub directory.
Do not use that fixture setting as deployment approval.

The hold is not a security boundary against an operator able to replace the
image, edit the workflow, or change Cloud Run environment variables directly.
Such an operator can bypass it by setting `1`; those actions require separate
authorization and evidence. Older revisions do not honor this new flag. A paused
new revision does not prove that older writers or in-flight requests are drained.

### Storage configuration for a future activation

`SJ_HUB_GCS_BUCKET` must name the same bucket mounted at `SJ_HUB_DIR`, with the
same league/season prefix (currently the bucket root). Push deploys bind it to
the configured mounted bucket, while keeping writes paused. Blank manual deploys
retain existing mounts and leave this value empty; a later activation must first
configure and verify the exact bucket. Cloud Run fails closed for enabled golf
mutations when this setting is missing; it never substitutes
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
It also proves the paused routes and direct writers reject before storage and
that expired auction polling remains read-only. `golf-rollout-workflow.test.ts`
parses the actual workflow and applies its deployed binding to the runtime gate,
including inherited enablement and configured-bucket bypass attempts. It also
executes the actual deploy step under Bash with a verified local `gcloud` stub,
captures arguments for push/manual paths, and never authenticates or deploys.

Storage contract references:
- https://docs.cloud.google.com/storage/docs/json_api/v1/objects/get
- https://docs.cloud.google.com/storage/docs/json_api/v1/objects/insert
- https://docs.cloud.google.com/docs/authentication/rest
