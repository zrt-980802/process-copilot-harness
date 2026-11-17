# Runtime DEV-04 Verification

- Date: 2026-11-10
- Development item: DEV-04
- Scope: Runtime Registry, Assignment, Lease, Fencing and Guard
- Code commit: `7e980eb5eb57e323418fda4c4d6c053390c89ed8`
- DSH: `0.2.1-rc.3`
- API image: `process-copilot-dev04-local-api:dev04-20261110-1050`
- API image digest:
  `sha256:5affc2c915f9ff2d7e22f6c65454edf627add1252f8e8d5c9495dcb4df1b1dd7`
- Runtime Host image:
  `process-copilot-dev04-local-runtime-host:dev04-20261110-1050`
- Runtime Host image digest:
  `sha256:d48b5f5e1909a1019c0f590edea977abddcf0a6c006783681410083c6c216302`

## ADR Trace

This slice implements the first persistent authority path for:

- ADR-0001: Runtime identity, ownership and replacement by monotonic Epoch.
- ADR-0002: Session Assignment, Lease, Generation, Fencing and idempotent
  command admission.
- ADR-0004: persistent Runtime Registry, health/query projection and replacement.
- ADR-0006: stable Runtime Host and private Bridge enforcement without changing
  DSH Core.

## Implemented

- PostgreSQL Runtime Registry with current-record and current-assignment
  constraints.
- Transactional Runtime registration and Session Assignment generation.
- Two-phase `PENDING` to `ACTIVE` Assignment synchronization with Runtime Host.
- Monotonic global fencing tokens and per-Session assignment generations.
- Compare-and-swap Runtime state, heartbeat, Assignment transition and Lease
  renewal.
- Lease expiry sweep and fail-closed guard evaluation.
- Runtime and Session query projections.
- Registry Step Guard and Tool Guard, including authorization revision and
  stable `tool_call_id` checks.
- Runtime Host and private Bridge guard snapshots with monotonic authority
  version checks.
- Single-file API and Runtime Host production bundles that do not execute
  workspace TypeScript from `node_modules`.

## Isolated Docker Environment

The Compose project `process-copilot-dev04-local` used an internal Docker
network and published no host ports. The retained evidence volumes are:

- `process-copilot-dev04-local_registry-data`
- `process-copilot-dev04-local_runtime-data`
- `process-copilot-dev04-runtime-v2-data`

The default Compose database remains `postgres:17-alpine`. The local machine
could not complete the official image pull, so this verification explicitly
overrode `PC_POSTGRES_IMAGE` with the already-present
`sm-bench-postgres:16-alpine`, verified as PostgreSQL `16.14`. Because that
image has a nonstandard entrypoint, the isolated `process_copilot` role and
database were created explicitly before API startup.

## Concurrency And CAS

Two simultaneous requests attempted to create the first Assignment for the
same Session.

The first run exposed a raw PostgreSQL `23505` response for the losing request.
The repository was corrected to acquire transaction-scoped advisory locks by
Runtime ID and Session ID before reading or creating authority rows.

The final result was:

```text
winner: HTTP 201, ACTIVE, generation 1
loser:  HTTP 409, PC_RUNTIME_ASSIGNMENT_CONFLICT
```

A Lease renewal advanced Assignment version `2` to `3`; replaying the previous
coordinates and expected version was rejected with
`PC_RUNTIME_LEASE_RENEWAL_REJECTED`.

## Guard Matrix

Verified results:

| Case | Registry Guard | Host / Bridge Guard |
|---|---|---|
| Current Assignment | `PC_RUNTIME_GUARD_ALLOWED` | `PC_RUNTIME_GUARD_ALLOWED` |
| Stale fencing token | `PC_RUNTIME_FENCE_STALE` | monotonic snapshot rejects stale authority |
| Tool without `tool_call_id` | `PC_RUNTIME_TOOL_CALL_ID_REQUIRED` | Registry blocks before dispatch |
| Expired Lease | `PC_RUNTIME_LEASE_EXPIRED` | `PC_RUNTIME_LEASE_EXPIRED` |
| Replaced Runtime Epoch | `PC_RUNTIME_EPOCH_STALE` | Registry blocks before old Host dispatch |

The Host and Bridge intentionally evaluate their local Assignment snapshot.
Global Runtime replacement is enforced by the Registry before transport. The
Runtime Host therefore remains on the private control network and has no host
port publication.

## Runtime Replacement

A second Runtime Host was started with the same Runtime ID and Epoch `2`, on a
separate retained volume and without host ports.

Observed results:

- Epoch `1` changed to `current_record = false`.
- Epoch `2` became the only current Runtime record.
- A still-live Epoch `1` Assignment received `PC_RUNTIME_EPOCH_STALE`.
- A `START_TURN` carrying the old Epoch and fencing coordinates returned
  `KNOWN_FAILURE` before transport to the old Runtime Host.
- A new Session Assignment activated on Epoch `2`.
- The Epoch `2` Host and Bridge guard returned
  `PC_RUNTIME_GUARD_ALLOWED`.
- The Runtime query projection returned only Epoch `2` Assignments.

## Persistence Recovery

The API was restarted and recovered the current Assignment projection from
PostgreSQL. PostgreSQL and the API were then restarted in sequence; the Epoch
`2` Runtime, Assignment, fencing token and allowed guard projection remained
unchanged.

The retained database contains two Runtime records, exactly one current Runtime
record, and monotonic fencing tokens across five exercised Assignments.

## Automated Verification

`pnpm check` passed:

- 17 ADR traceability entries;
- 42 generated Contract schemas and fixtures;
- architecture, compatibility and dependency checks;
- lint;
- typecheck;
- 11 test files / 81 tests;
- full build.

The PostgreSQL Vitest suite remains opt-in through
`PC_TEST_POSTGRES_URL` so the normal test command does not require a database.
The no-port Docker acceptance exercised the same PostgreSQL repository through
the production API bundle.

## Environment State

No remote source repository was configured or updated. No Docker workload on
`192.168.31.95` was changed. The local verification published no host ports.
