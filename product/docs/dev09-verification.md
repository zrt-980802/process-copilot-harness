# DEV-09 SSTS Draft Vertical Product Closure Verification

- Date: 2026-11-11
- Implementation commit: `cdfc100`
- Scope: local backend product closure only
- Remote deployment: not performed
- Remote Git push: not performed

## Delivered scope

DEV-09 adds:

- `@pc/ssts-draft` as the M10-internal SSTS product aggregate;
- Task Workspace ownership, lifecycle and optimistic versioning;
- required `PRD` and `ARCHITECTURE` input slots plus optional
  `COMMUNICATION_MATRIX`;
- exact `ResourceVersion` reads and immutable `ARTIFACT` creation;
- fixed published `profile:fo-ssts-draft:1` enforcement with
  `enterprise_write=false`;
- durable conversation messages;
- fail-closed input completeness checks;
- idempotent Draft generation backed by C27 `BusinessTask` and C28
  `BusinessOperation`;
- exact Profile Release and ResourceVersion provenance;
- citations and a deterministic Validation Report;
- immutable Draft revisions;
- human reject, regenerate and accept decisions;
- owner-authorized Markdown download;
- SSTS-specific audit records;
- Memory and PostgreSQL repository implementations;
- authenticated API routes for the complete backend workflow.

The generation path uses `READ` plus `REPLAY_SAFE`. It does not call the
Controlled Gateway, EE Claw or any enterprise write path.

## Automated verification

The full repository gate passed:

```text
17 ADR traceability checks
42 contract inventory checks
lint
typecheck
24 test files passed
6 PostgreSQL-dependent files skipped by default
125 tests passed
all package builds passed
```

Focused coverage verifies:

- missing required inputs fail closed;
- one idempotency key does not create duplicate Drafts;
- Drafts bind the fixed Profile Release digest and exact source versions;
- citations and Validation Report are present;
- rejection produces a new immutable revision;
- acceptance makes the Workspace immutable;
- two users cannot read or download each other's Task or Draft;
- API responses never expose `blob_ref` or a server path;
- review has no Gateway or EE Claw write side effect.

## PostgreSQL recovery verification

`postgres-ssts-draft.test.ts` was executed inside
`process-copilot-dev09-test:20261110` against PostgreSQL 17 on the existing
DEV-08 internal network. It passed:

```text
Workspace, Input, Message, Draft, Review and Artifact download restored
after closing and recreating all SSTS/Profile/Resource/Event repositories
```

Test image:

```text
process-copilot-dev09-test:20261110
sha256:d62560ec394f787b84c185653899c811a94ee46b3e09b3af99f96b839234085c
```

## Isolated Compose evidence

Compose file:

```text
deploy/docker-compose.dev09-local.yml
```

Images:

```text
process-copilot-dev09-local-api:dev09-20261111
sha256:68ffe3a5101b01eba31449f194362aeb79ccee56eb2c7c9e2ba5f3c757273847
postgres:17-alpine
```

The control network is internal and no host ports are published:

```text
api      3000/tcp
postgres 5432/tcp
network internal=true
```

Initial verification completed:

```json
{
  "draft_revision": 2,
  "validation_status": "PASSED",
  "citation_count": 2,
  "idempotent_replay": true,
  "accepted": true,
  "downloaded": true
}
```

After API restart, and again after API stop plus PostgreSQL restart plus API
container recreation:

```json
{
  "workspace_state": "ACCEPTED",
  "inputs": 2,
  "messages": 1,
  "drafts": 2,
  "reviews": 2,
  "recovered_download": true
}
```

The PostgreSQL authority contained:

```text
workspace=1
input=2
message=1
generation=2
draft=2
review=2
audit=13
```

## Frontend entry assessment

The backend now supports a minimum frontend workflow test against a
deterministic Draft engine:

```text
sign in
create Task
upload and attach exact inputs
append messages
check inputs
generate Draft
inspect citations and validation
reject and regenerate
accept
download
refresh and recover
```

This is not yet a real AI end-to-end acceptance path. The SSTS engine is a
replaceable deterministic adapter. A real DSH/LLM path still requires:

- Runtime Assignment and active Lease;
- EffectiveProfileSnapshot resolution;
- WorkspaceView and Materialization;
- `START_TURN` orchestration and event-driven completion;
- streaming/cancel/recovery UX.

A frontend batch may start against the deterministic API for workflow,
authorization, recovery and responsive UX testing. It must not be presented
as real AI closure until the Runtime-backed engine is connected.

## Constraints preserved

- no changes or deployment to `192.168.31.95`;
- no connection to shared EE MySQL;
- no host port publication;
- no DSH Core modification;
- no remote Git repository configured or pushed;
- ADR-0018, ADR-0019 and ADR-0020 remain Draft;
- no frontend implementation was included in DEV-09.
